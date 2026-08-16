# opencode-session-ref

> **Reference and inspect past OpenCode conversation sessions directly from the TUI picker or via autonomous agent tools.**

`opencode-session-ref` is a plugin for [OpenCode](https://opencode.ai) that bridges the gap between sessions. It allows you to quickly search and select past sessions via an interactive TUI modal (`Ctrl+S`), or enables your AI agent to autonomously search and recall past decisions, transcripts, and code diffs without blowing through token limits.

---

## ✨ Features

- **🎯 Interactive TUI Picker (`Ctrl+S` / `/ref-session`)**:
  - Search past sessions in real time by title, slug, or working directory.
  - Automatically formats and inserts a `@session(id: ...)` reference into your prompt.

- **🤖 Autonomous Agent Tools**:
  - `session_search`: Search historical sessions by topic, keyword, or past bug discussion.
  - `session_list`: List recent sessions for the current project or across all directories.
  - `session_read`: Read session details in 4 token-optimized modes (`summary`, `turns`, `diff`, `full`).

- **⚡ Token-Efficient & Clean**:
  - Parses SQLite data directly in read-only mode (`~/.local/share/opencode/opencode.db`).
  - Strips noisy runtime tokens (`reasoning`, `step-start`, `step-finish`) and truncates excessive tool outputs.
  - Preserves provider prompt caching with static system prompt injection.

---

## 🚀 Installation & Setup

### 1. Build the Plugin

```bash
git clone https://github.com/krishna/opencode-session-ref.git
cd opencode-session-ref
pnpm install
pnpm build
```

### 2. Configure OpenCode

#### A. Server Plugin (Tools & System Awareness)
Create a symlink in your OpenCode plugins folder:

```bash
ln -sf /path/to/opencode-session-ref/dist/index.js ~/.config/opencode/plugins/opencode-session-ref.js
```

#### B. TUI Plugin (Interactive Picker & Shortcuts)
Add the plugin path to your `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/path/to/opencode-session-ref"
  ]
}
```

---

## ⌨️ Usage

### 1. Interactive Picker (User-Driven)
- Press **`Ctrl+S`** anywhere in the TUI (or type `/ref-session`, `/ref`, `/session`).
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

## 🛠️ Tool Reference

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`session_search`** | `query` (string), `limit?` (number) | Search sessions by keyword and return matching snippets. |
| **`session_list`** | `limit?` (number), `current_project_only?` (boolean) | List recent sessions with timestamps and directories. |
| **`session_read`** | `session_id` (string), `mode?` (`summary` \| `turns` \| `diff` \| `full`), `last_turns?` (number) | Retrieve sanitized transcript, diffs, or summary. |

---

## 🧪 Development & Testing

Run unit & database integration tests:

```bash
node test/test-runner.mjs
```

Build for production:

```bash
pnpm build
```

---

## 📄 License

MIT
