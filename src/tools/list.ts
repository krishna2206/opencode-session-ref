import { SessionDb } from "../db/queries.js";
import { formatSessionList } from "../format/markdown.js";

export async function listSessions(args: {
  limit?: number;
  current_project_only?: boolean;
  currentDirectory: string;
}): Promise<string> {
  try {
    const directory = args.current_project_only ? args.currentDirectory : undefined;
    const sessions = await SessionDb.listRecentSessions({
      limit: Math.min(args.limit ?? 10, 50),
      directory,
    });
    return formatSessionList(sessions);
  } catch (err) {
    return `Error listing sessions: ${err instanceof Error ? err.message : String(err)}`;
  }
}
