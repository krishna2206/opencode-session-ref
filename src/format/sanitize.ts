import type { MessageRow } from "../db/queries.js";

export interface ToolUse {
  tool: string;
  description?: string;
  status?: string;
  filePath?: string;
  command?: string;
}

export interface ConversationTurn {
  turnIndex: number;
  userPrompt: string;
  userTime: number;
  assistantAnswers: string[];
  toolsUsed: ToolUse[];
  filesModified: string[];
  assistantTime?: number;
}

/**
 * One file change as recorded by an editing tool call. `patch` is set for
 * `apply_patch` calls (already a patch), `before`/`after` for the others.
 */
export interface FileEdit {
  file: string;
  before?: string;
  after?: string;
  patch?: string;
}

/** An assistant content item of type `tool` (V2 `SessionMessage.AssistantTool`). */
interface ToolItem {
  type: "tool";
  name?: string;
  state?: {
    status?: string;
    input?: unknown;
  };
}

/** Shell tool name: `bash` in sessions migrated from V1, `shell` in V2. */
const SHELL_TOOLS = new Set(["bash", "shell"]);
const EDIT_TOOLS = new Set(["edit", "write", "multiedit"]);
const PATCH_TOOL = "apply_patch";

export function parseMessageData(dataStr: string): Record<string, unknown> {
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

function contentItems(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.content)
    ? data.content.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function toolInput(item: ToolItem): Record<string, unknown> {
  // A tool still streaming carries its raw input as a string.
  const input = item.state?.input;
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** Files named by an `apply_patch` patch (`*** Update|Add|Delete File: <path>`). */
function patchFiles(patchText: string): string[] {
  const files: string[] = [];
  for (const match of patchText.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) {
    const file = match[1].trim();
    if (!files.includes(file)) files.push(file);
  }
  return files;
}

function toolUse(item: ToolItem): ToolUse {
  const input = toolInput(item);
  const name = item.name ?? "unknown";
  return {
    tool: SHELL_TOOLS.has(name) ? "bash" : name,
    description: stringField(input, "description"),
    status: item.state?.status,
    filePath: stringField(input, "filePath"),
    command: stringField(input, "command"),
  };
}

function filesTouched(item: ToolItem): string[] {
  if (item.state?.status === "error") return [];
  const input = toolInput(item);
  if (item.name === PATCH_TOOL) {
    const patchText = stringField(input, "patchText");
    return patchText ? patchFiles(patchText) : [];
  }
  const filePath = stringField(input, "filePath");
  return item.name && EDIT_TOOLS.has(item.name) && filePath ? [filePath] : [];
}

function pushUnique(list: string[], values: string[]): void {
  for (const value of values) if (!list.includes(value)) list.push(value);
}

/**
 * Builds user <-> assistant turns from V2 session messages, keeping the text
 * exchanged and a one-line trace of each tool call. Reasoning and tool output
 * are dropped; synthetic reminders are separate message types and never loaded.
 */
export function buildConversationTurns(messages: MessageRow[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let turnCounter = 1;

  for (const msg of messages) {
    const data = parseMessageData(msg.data);

    if (msg.type === "user") {
      if (currentTurn) turns.push(currentTurn);
      const text = typeof data.text === "string" ? data.text.trim() : "";
      currentTurn = {
        turnIndex: turnCounter++,
        userPrompt: text || "(Empty or file attachment prompt)",
        userTime: msg.time_created,
        assistantAnswers: [],
        toolsUsed: [],
        filesModified: [],
      };
      continue;
    }

    if (!currentTurn) continue;

    if (msg.type === "shell") {
      // A `!command` the user ran from the prompt.
      const command = typeof data.command === "string" ? data.command : undefined;
      currentTurn.toolsUsed.push({ tool: "bash", command, status: typeof data.status === "string" ? data.status : undefined });
      continue;
    }

    if (msg.type !== "assistant") continue;
    currentTurn.assistantTime = msg.time_created;

    for (const item of contentItems(data)) {
      if (item.type === "text" && typeof item.text === "string") {
        const trimmed = item.text.trim();
        if (trimmed) {
          // Truncate overly long assistant replies to max 700 chars in transcripts
          // to keep session recall compact and prevent prompt pollution
          const truncatedAnswer = truncateText(trimmed, 700);
          if (!currentTurn.assistantAnswers.includes(truncatedAnswer)) {
            currentTurn.assistantAnswers.push(truncatedAnswer);
          }
        }
      } else if (item.type === "tool") {
        const tool = item as unknown as ToolItem;
        currentTurn.toolsUsed.push(toolUse(tool));
        pushUnique(currentTurn.filesModified, filesTouched(tool));
      }
    }
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}

/**
 * File changes made by the session's editing tools, in call order. The
 * session's own diff is not reachable from a server plugin and V2 no longer
 * fills `summary_diffs`, so the tool inputs are the record of what changed.
 */
export function collectFileEdits(messages: MessageRow[]): FileEdit[] {
  const edits: FileEdit[] = [];
  for (const msg of messages) {
    if (msg.type !== "assistant") continue;
    for (const item of contentItems(parseMessageData(msg.data))) {
      if (item.type !== "tool") continue;
      const tool = item as unknown as ToolItem;
      if (tool.state?.status !== "completed") continue;
      const input = toolInput(tool);

      if (tool.name === PATCH_TOOL) {
        const patch = stringField(input, "patchText");
        if (patch) edits.push({ file: patchFiles(patch).join(", ") || "(patch)", patch });
      } else if (tool.name === "write") {
        const file = stringField(input, "filePath");
        if (file) edits.push({ file, before: "", after: stringField(input, "content") ?? "" });
      } else if (tool.name === "edit") {
        const file = stringField(input, "filePath");
        if (file) {
          edits.push({
            file,
            before: stringField(input, "oldString") ?? "",
            after: stringField(input, "newString") ?? "",
          });
        }
      }
    }
  }
  return edits;
}
