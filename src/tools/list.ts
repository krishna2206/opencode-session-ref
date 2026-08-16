import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { SessionDb } from "../db/queries.js";
import { formatSessionList } from "../format/markdown.js";

export function createSessionListTool(currentDirectory?: string): ToolDefinition {
  return tool({
    description:
      "List recent OpenCode sessions with titles, slugs, creation dates, and directories. " +
      "Use this to find candidate sessions when you need to inspect recent work.",
    args: {
      limit: tool.schema
        .number()
        .optional()
        .describe("Number of recent sessions to retrieve (default: 10, max: 50)"),
      current_project_only: tool.schema
        .boolean()
        .optional()
        .describe("If true, filters sessions to the current project directory only (default: false)"),
    },
    async execute(args) {
      try {
        const directory = args.current_project_only ? currentDirectory : undefined;
        const sessions = await SessionDb.listRecentSessions({
          limit: args.limit ?? 10,
          directory,
        });

        return formatSessionList(sessions);
      } catch (err) {
        return `Error listing sessions: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
