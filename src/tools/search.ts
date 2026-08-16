import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { SessionDb } from "../db/queries.js";
import { formatSearchResults } from "../format/markdown.js";

export const sessionSearchTool: ToolDefinition = tool({
  description:
    "Search historical OpenCode sessions across titles, slugs, and conversation message contents. " +
    "Use this when the user asks about past work, previous bug fixes, decisions, or unspecific prior conversations.",
  args: {
    query: tool.schema
      .string()
      .describe("Keyword, topic, or search terms to locate in past sessions"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of matching sessions to return (default: 5, max: 20)"),
  },
  async execute(args) {
    try {
      const results = await SessionDb.searchSessions({
        query: args.query,
        limit: args.limit ?? 5,
      });

      return formatSearchResults(results, args.query);
    } catch (err) {
      return `Error searching sessions: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});
