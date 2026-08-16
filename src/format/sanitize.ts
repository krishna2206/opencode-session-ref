import type { MessageRow, PartRow } from "../db/queries.js";

export interface ParsedPart {
  id: string;
  type: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  callID?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolStatus?: string;
  files?: string[];
  raw: Record<string, unknown>;
}

export interface ParsedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  timeCreated: number;
  agent?: string;
  model?: string;
  parts: ParsedPart[];
}

export interface ConversationTurn {
  turnIndex: number;
  userPrompt: string;
  userTime: number;
  assistantAnswers: string[];
  toolsUsed: {
    tool: string;
    description?: string;
    status?: string;
    filePath?: string;
    command?: string;
  }[];
  filesModified: string[];
  assistantTime?: number;
}

export function parseMessageData(dataStr: string): Record<string, unknown> {
  try {
    return JSON.parse(dataStr);
  } catch {
    return {};
  }
}

export function parsePartData(dataStr: string): Record<string, unknown> {
  try {
    return JSON.parse(dataStr);
  } catch {
    return {};
  }
}

export function truncateText(text: string, maxLen = 300): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `... [truncated ${text.length - maxLen} chars]`;
}

/**
 * Parses raw SQLite messages and parts into structured turns,
 * stripping internal noise (step-start, step-finish, reasoning)
 * and extracting key actions.
 */
export function buildConversationTurns(
  messages: MessageRow[],
  parts: PartRow[],
): ConversationTurn[] {
  const partsByMessage = new Map<string, ParsedPart[]>();

  for (const part of parts) {
    const raw = parsePartData(part.data);
    const type = (raw.type as string) || "unknown";

    // Ignore internal step markers
    if (type === "step-start" || type === "step-finish") {
      continue;
    }

    const parsed: ParsedPart = {
      id: part.id,
      type,
      synthetic: Boolean(raw.synthetic),
      raw,
    };

    if (type === "text" && typeof raw.text === "string") {
      parsed.text = raw.text;
    } else if (type === "tool") {
      parsed.tool = typeof raw.tool === "string" ? raw.tool : undefined;
      parsed.callID = typeof raw.callID === "string" ? raw.callID : undefined;
      const state = (raw.state as Record<string, unknown>) || {};
      parsed.toolStatus = typeof state.status === "string" ? state.status : undefined;
      parsed.toolInput = (state.input as Record<string, unknown>) || {};
      if (typeof state.output === "string") {
        parsed.toolOutput = state.output;
      }
    } else if (type === "patch" && Array.isArray(raw.files)) {
      parsed.files = raw.files.filter((f): f is string => typeof f === "string");
    }

    const list = partsByMessage.get(part.message_id) || [];
    list.push(parsed);
    partsByMessage.set(part.message_id, list);
  }

  const parsedMessages: ParsedMessage[] = messages.map((m) => {
    const mData = parseMessageData(m.data);
    const role = (mData.role as "user" | "assistant" | "system") || "user";
    const model = typeof mData.model === "object" && mData.model !== null
      ? (mData.model as { modelID?: string }).modelID
      : undefined;

    return {
      id: m.id,
      role,
      timeCreated: m.time_created,
      agent: typeof mData.agent === "string" ? mData.agent : undefined,
      model,
      parts: partsByMessage.get(m.id) || [],
    };
  });

  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let turnCounter = 1;

  for (const msg of parsedMessages) {
    if (msg.role === "user") {
      if (currentTurn) {
        turns.push(currentTurn);
      }

      // Extract user text (prefer non-synthetic user text)
      const userTextParts = msg.parts
        .filter((p) => p.type === "text" && !p.synthetic && p.text)
        .map((p) => p.text as string);

      const promptText = userTextParts.join("\n").trim() ||
        msg.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text as string).join("\n").trim() ||
        "(Empty or file attachment prompt)";

      currentTurn = {
        turnIndex: turnCounter++,
        userPrompt: promptText,
        userTime: msg.timeCreated,
        assistantAnswers: [],
        toolsUsed: [],
        filesModified: [],
      };
    } else if (msg.role === "assistant" && currentTurn) {
      currentTurn.assistantTime = msg.timeCreated;

      for (const part of msg.parts) {
        if (part.type === "text" && part.text) {
          const trimmed = part.text.trim();
          if (trimmed && !currentTurn.assistantAnswers.includes(trimmed)) {
            currentTurn.assistantAnswers.push(trimmed);
          }
        } else if (part.type === "tool" && part.tool) {
          const input = part.toolInput || {};
          const toolDesc = typeof input.description === "string"
            ? input.description
            : undefined;
          const filePath = typeof input.filePath === "string"
            ? input.filePath
            : undefined;
          const command = typeof input.command === "string"
            ? input.command
            : undefined;

          currentTurn.toolsUsed.push({
            tool: part.tool,
            description: toolDesc,
            status: part.toolStatus,
            filePath,
            command,
          });

          if ((part.tool === "write" || part.tool === "edit") && filePath) {
            if (!currentTurn.filesModified.includes(filePath)) {
              currentTurn.filesModified.push(filePath);
            }
          }
        } else if (part.type === "patch" && part.files) {
          for (const f of part.files) {
            if (!currentTurn.filesModified.includes(f)) {
              currentTurn.filesModified.push(f);
            }
          }
        }
      }
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns;
}
