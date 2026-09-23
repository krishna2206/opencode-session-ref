import { SessionDb } from "../db/queries.js";
import { formatSearchResults } from "../format/markdown.js";

export async function searchSessions(args: { query: string; limit?: number }): Promise<string> {
  try {
    const results = await SessionDb.searchSessions({
      query: args.query,
      limit: Math.min(args.limit ?? 5, 20),
    });
    return formatSearchResults(results, args.query);
  } catch (err) {
    return `Error searching sessions: ${err instanceof Error ? err.message : String(err)}`;
  }
}
