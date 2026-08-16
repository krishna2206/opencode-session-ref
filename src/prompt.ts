export const SESSION_REF_SYSTEM_PROMPT = `
# Past Session References (OpenCode History)

You have access to historical OpenCode conversation sessions via the following tools:
- \`session_search\`: Search past conversations by keywords, topics, or bug descriptions across all sessions.
- \`session_list\`: List recent sessions for the current project or globally.
- \`session_read\`: Retrieve context, conversational turns, code diffs, or summaries for a specific session ID or slug.

## Guidelines:
1. When the user references a past session (e.g. \`@session(id: ...)\`, \`/ref-session\`, or names a past topic/session), proactively call \`session_read(session_id: ...)\` to inspect the relevant decisions, discussions, or code before answering.
2. When the user mentions prior discussions or previous bugs without providing an explicit session ID, use \`session_search\` to locate the candidate session, then inspect it with \`session_read\`.
3. Start with \`mode: "summary"\` or \`mode: "turns"\` with \`last_turns\` to minimize token overhead unless full detail is needed.
`.trim();
