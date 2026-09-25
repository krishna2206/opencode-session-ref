# opencode-session-ref

> **Reference and inspect past OpenCode conversation sessions directly from the TUI picker or via autonomous agent tools.**

`opencode-session-ref` is a plugin for [OpenCode](https://opencode.ai) that bridges the gap between sessions. It allows you to quickly search and select past sessions via an interactive TUI modal (`Ctrl+S`), or enables your AI agent to autonomously search and recall past decisions, transcripts, and code diffs without blowing through token limits.

---

## Features

- **Interactive TUI Picker (`Ctrl+S` / `/ref-session`)**:
  - Lists the root sessions of every project updated this month, grouped by date, with fuzzy filtering.
  - Automatically formats and inserts a `@session(id: ...)` reference into your prompt.

- **Autonomous Agent Tools**:
  - `session_search`: Search historical sessions by topic, keyword, or past bug discussion.
  - `session_list`: List recent sessions for the current project or across all directories.
  - `session_read`: Read session details in token-optimized modes (`summary`, `turns`, `diff`; `full` is an alias of `turns`).

- **Token-Efficient & Clean**:
  - Reads the OpenCode 2 database (`session_v2`, `session_message`) directly in read-only mode (the database opencode uses: `OPENCODE_DB`, else `opencode.db` under `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`): the plugin API gives server plugins no full history or text search.
  - Drops reasoning, tool output and synthetic reminders; caps every `session_read` output at ~16 KB.
  - Preserves provider prompt caching with static system prompt injection.

---

## Installation & Setup

### 1. Build the Plugin

```bash
git clone https://github.com/krishna2206/opencode-session-ref.git
cd opencode-session-ref
pnpm install
pnpm build
```

### 2. Configure OpenCode

Requires OpenCode 2. Add the built `dist` directory to `plugins` in `~/.config/opencode/opencode.jsonc`
(the path must point to the directory; OpenCode resolves `dist/index` for the tools and `dist/tui` for the picker):

```jsonc
{
  "plugins": [
    { "package": "file:///path/to/opencode-session-ref/dist" }
  ]
}
```

---

## Usage

### 1. Interactive Picker (User-Driven)
- Press **`Ctrl+S`** anywhere in the TUI (or type `/ref-session` or `/ref`).
- Filter sessions with live fuzzy search.
- Press **`Enter`** to inject the reference into your prompt:
  ```text
  @session(id: "ses_ff3da9736ffePl2EkoFO1HbVHm", title: "Refactor auth middleware")
  [Context: Past session referenced. Use `session_read(session_id: "ses_ff3da9736ffePl2EkoFO1HbVHm")` to inspect context before responding.]
  ```

### 2. Autonomous Recall (Agent-Driven)
You can also ask the agent open-ended questions about past work without knowing the session ID:
> *"How did we resolve the emulator startup crash in yesterday's session?"*

The agent will automatically:
1. Call `session_search(query: "emulator startup crash")`
2. Call `session_read(session_id: "ses_...", mode: "summary")`
3. Provide an accurate answer based on past conversation history and diffs.

---

## Tool Reference

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`session_search`** | `query` (string), `limit?` (number) | Search sessions by keyword and return matching snippets. |
| **`session_list`** | `limit?` (number), `current_project_only?` (boolean) | List recent sessions with timestamps and directories. |
| **`session_read`** | `session_id` (string), `mode?` (`summary` \| `turns` \| `diff` \| `full`), `last_turns?` (number) | Retrieve sanitized transcript, diffs, or summary. |

---

## Development & Testing

Unit tests (V1 and V2 message shapes, no database needed):

```bash
pnpm test
```

Smoke test against your live opencode database (needs `dist` built):

```bash
bun test/test-runner.mjs
```

Build for production:

```bash
pnpm build
```

---

## License

MIT
