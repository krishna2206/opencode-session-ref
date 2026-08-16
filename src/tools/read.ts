import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin";
import { SessionDb } from "../db/queries.js";
import {
  formatSessionSummary,
  formatSessionTurns,
  formatSessionDiff,
  formatSessionFull,
} from "../format/markdown.js";
import { formatFileDiffs } from "../format/diff.js";

const READ_MODES = ["summary", "turns", "diff", "full"] as const;
export type ReadMode = (typeof READ_MODES)[number];

type Client = PluginInput["client"];

export function createSessionReadTool(client: Client): ToolDefinition {
  return tool({
    description:
      "Read messages, summary, or code diffs from a past OpenCode session. " +
      "Use this when a session is referenced (e.g. `@session(id: ...)`), or after finding a relevant session via `session_search`.",
    args: {
      session_id: tool.schema
        .string()
        .describe("Session ID (e.g. 'ses_...') or human-readable slug (e.g. 'curious-rocket')"),
      mode: tool.schema
        .enum(READ_MODES)
        .optional()
        .describe(
          "summary: High-level overview of conversation + files touched (default, low tokens)\n" +
          "turns: Clean User <-> Assistant conversational transcript (excluding heavy tool dumps)\n" +
          "diff: Git diffs of code modified during that session\n" +
          "full: Full transcript with actions",
        ),
      last_turns: tool.schema
        .number()
        .optional()
        .describe("If specified, returns only the last N turns of the session"),
    },
    async execute(args) {
      try {
        const mode = args.mode ?? "summary";
        const { session, messages, parts } =
          await SessionDb.getSessionMessagesAndParts(args.session_id);

        if (!session) {
          return `Session not found for identifier "${args.session_id}". Use \`session_search\` or \`session_list\` to find valid sessions.`;
        }

        if (mode === "diff") {
          return await readDiff(client, session.id, messages, parts);
        }

        switch (mode) {
          case "summary":
            return formatSessionSummary(session, messages, parts);
          case "turns":
            return formatSessionTurns(session, messages, parts, args.last_turns);
          case "full":
            return formatSessionFull(session, messages, parts, args.last_turns);
          default:
            return formatSessionSummary(session, messages, parts);
        }
      } catch (err) {
        return `Error reading session "${args.session_id}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

async function readDiff(
  client: Client,
  sessionId: string,
  messages: Parameters<typeof formatSessionDiff>[1],
  parts: Parameters<typeof formatSessionDiff>[2],
): Promise<string> {
  try {
    const result = await client.session.diff({ path: { id: sessionId } });
    if (result.data && result.data.length > 0) {
      return formatFileDiffs(result.data);
    }
    return formatSessionDiff(
      await SessionDb.findSession(sessionId) ?? {
        id: sessionId,
        project_id: "",
        parent_id: null,
        slug: "",
        directory: "",
        title: sessionId,
        version: "",
        share_url: null,
        summary_additions: 0,
        summary_deletions: 0,
        summary_files: 0,
        summary_diffs: null,
        time_created: 0,
        time_updated: 0,
        agent: null,
        model: null,
        cost: 0,
        tokens_input: 0,
        tokens_output: 0,
      },
      messages,
      parts,
    );
  } catch (cause) {
    // Fall back to the DB-derived file list if the SDK diff is unavailable.
    const session = await SessionDb.findSession(sessionId);
    return session
      ? formatSessionDiff(session, messages, parts)
      : `No diffs available for session ${sessionId}.`;
  }
}