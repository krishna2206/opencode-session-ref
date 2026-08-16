import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { SessionDb } from "../db/queries.js";
import {
  formatSessionSummary,
  formatSessionTurns,
  formatSessionDiff,
  formatSessionFull,
} from "../format/markdown.js";

const READ_MODES = ["summary", "turns", "diff", "full"] as const;
export type ReadMode = (typeof READ_MODES)[number];

export const sessionReadTool: ToolDefinition = tool({
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

      switch (mode) {
        case "summary":
          return formatSessionSummary(session, messages, parts);
        case "turns":
          return formatSessionTurns(session, messages, parts, args.last_turns);
        case "diff":
          return formatSessionDiff(session, messages, parts);
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
