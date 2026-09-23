import { SessionDb } from "../db/queries.js";
import {
  formatSessionSummary,
  formatSessionTurns,
  formatSessionDiff,
  formatSessionFull,
} from "../format/markdown.js";

export const READ_MODES = ["summary", "turns", "diff", "full"] as const;
export type ReadMode = (typeof READ_MODES)[number];

export async function readSession(args: {
  session_id: string;
  mode?: ReadMode;
  last_turns?: number;
}): Promise<string> {
  try {
    const mode = args.mode ?? "summary";
    const { session, messages } = await SessionDb.getSessionMessages(args.session_id);

    if (!session) {
      return `Session not found for identifier "${args.session_id}". Use \`session_search\` or \`session_list\` to find valid sessions.`;
    }

    switch (mode) {
      case "turns":
        return formatSessionTurns(session, messages, args.last_turns);
      case "diff":
        return formatSessionDiff(session, messages);
      case "full":
        return formatSessionFull(session, messages, args.last_turns);
      case "summary":
      default:
        return formatSessionSummary(session, messages);
    }
  } catch (err) {
    return `Error reading session "${args.session_id}": ${err instanceof Error ? err.message : String(err)}`;
  }
}
