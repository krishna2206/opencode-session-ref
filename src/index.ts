import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import { searchSessions } from "./tools/search.js";
import { listSessions } from "./tools/list.js";
import { readSession, READ_MODES } from "./tools/read.js";
import { SESSION_REF_SYSTEM_PROMPT } from "./prompt.js";
import { SessionDb } from "./db/queries.js";

const Limit = (description: string) => Schema.optional(Schema.Number.annotate({ description }));

export default Plugin.define({
  id: "opencode-session-ref",
  setup: async (ctx) => {
    const currentDirectory = ctx.location.directory;

    // Static text, identical on every turn: keeps the system prompt prefix cacheable.
    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: SESSION_REF_SYSTEM_PROMPT });
    });

    await ctx.tool.transform((tools) => {
      tools.add({
        name: "session_search",
        options: { codemode: false },
        description:
          "Search historical OpenCode sessions across titles, slugs, and conversation message contents. " +
          "Use this when the user asks about past work, previous bug fixes, decisions, or unspecific prior conversations.",
        input: Schema.Struct({
          query: Schema.String.annotate({
            description: "Keyword, topic, or search terms to locate in past sessions",
          }),
          limit: Limit("Maximum number of matching sessions to return (default: 5, max: 20)"),
        }),
        execute: async (input) => ({ content: await searchSessions(input) }),
      });

      tools.add({
        name: "session_list",
        options: { codemode: false },
        description:
          "List recent OpenCode sessions with titles, slugs, creation dates, and directories. " +
          "Use this to find candidate sessions when you need to inspect recent work.",
        input: Schema.Struct({
          limit: Limit("Number of recent sessions to retrieve (default: 10, max: 50)"),
          current_project_only: Schema.optional(
            Schema.Boolean.annotate({
              description:
                "If true, filters sessions to the current project directory only (default: false)",
            }),
          ),
        }),
        execute: async (input) => ({ content: await listSessions({ ...input, currentDirectory }) }),
      });

      tools.add({
        name: "session_read",
        options: { codemode: false },
        description:
          "Read messages, summary, or code diffs from a past OpenCode session. " +
          "Use this when a session is referenced (e.g. `@session(id: ...)`), or after finding a relevant session via `session_search`.",
        input: Schema.Struct({
          session_id: Schema.String.annotate({
            description: "Session ID (e.g. 'ses_...') or human-readable slug (e.g. 'curious-rocket')",
          }),
          mode: Schema.optional(
            Schema.Literals(READ_MODES).annotate({
              description:
                "summary: High-level overview of conversation + files touched (default, low tokens)\n" +
                "turns: Clean User <-> Assistant conversational transcript (excluding heavy tool dumps)\n" +
                "diff: File edits made by the session's editing tools\n" +
                "full: Same as turns (kept as an alias)",
            }),
          ),
          last_turns: Limit("If specified, returns only the last N turns of the session"),
        }),
        execute: async (input) => ({ content: await readSession(input) }),
      });
    });

    // The read-only database handle would otherwise outlive a plugin reload.
    return () => SessionDb.close();
  },
});
