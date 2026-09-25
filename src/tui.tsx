/** @jsxImportSource @opentui/solid */

import { basename } from "node:path";
import { Plugin } from "@opencode/plugin/tui";

type Ctx = Plugin.Context;
type SessionInfo = Awaited<ReturnType<Ctx["client"]["session"]["list"]>>["data"][number];

const id = "opencode-session-ref";

/** Upper bound on sessions shown, so a very active month cannot stall the picker. */
const MAX_SESSIONS = 100;
const PAGE_SIZE = 50;

function dateGroupLabel(timestamp: number): string {
  const today = new Date().toDateString();
  const label = new Date(timestamp).toDateString();
  return label === today ? "Today" : label;
}

function truncateTitle(title: string, maxLen = 40): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + "...";
}

/**
 * Root sessions of every project updated since the start of the current month,
 * most recent first. The list endpoint has no date filter, so this pages
 * through it (newest first) and stops at the first older session.
 */
async function listMonthSessions(ctx: Ctx): Promise<SessionInfo[]> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sessions: SessionInfo[] = [];
  let cursor: string | undefined;

  while (sessions.length < MAX_SESSIONS) {
    const page = await ctx.client.session.list({ limit: PAGE_SIZE, order: "desc", parentID: null, cursor });
    for (const session of page.data) {
      if (session.time.updated < startOfMonth) return sessions;
      sessions.push(session);
      if (sessions.length >= MAX_SESSIONS) return sessions;
    }
    cursor = page.cursor.next ?? undefined;
    if (!cursor || page.data.length === 0) return sessions;
  }
  return sessions;
}

/**
 * Inserts text at the end of the prompt. OpenCode 2 gives TUI plugins no
 * prompt-append call, so this writes into the focused editor. A closing dialog
 * hands focus back after 1 ms, hence the wait: focus is read only then, not
 * before the picker opened (from the command palette, the palette input still
 * holds it at that point and is destroyed right after).
 */
async function insertIntoPrompt(ctx: Ctx, text: string): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  const editor = ctx.renderer.currentFocusedEditor;
  if (!editor || editor.isDestroyed) return false;
  editor.gotoBufferEnd();
  editor.insertText(text);
  ctx.renderer.requestRender();
  return true;
}

async function openSessionPicker(ctx: Ctx): Promise<void> {
  let sessions: SessionInfo[];
  try {
    sessions = await listMonthSessions(ctx);
  } catch (err) {
    ctx.ui.toast.show({
      title: "Error",
      message: `Failed to load sessions: ${err instanceof Error ? err.message : String(err)}`,
      variant: "error",
    });
    return;
  }

  if (sessions.length === 0) {
    ctx.ui.toast.show({
      title: "Session Reference",
      message: "No sessions updated this month.",
      variant: "warning",
    });
    return;
  }

  // Grouped by date like /sessions; folder basename shown as muted footer.
  const selection = ctx.ui.dialog.select<SessionInfo>({
    title: "Reference Past Session",
    placeholder: "Search sessions by title or date...",
    options: sessions.map((s) => ({
      title: truncateTitle(s.title || s.id),
      value: s,
      category: dateGroupLabel(s.time.updated),
      footer: basename(s.location.directory).slice(0, 20),
    })),
  });
  ctx.ui.dialog.set({ size: "large" });

  const session = await selection;
  if (!session) return;

  const title = session.title || session.id;
  // JSON quoting keeps a title with quotes or newlines on one valid line.
  const instruction = `@session(id: "${session.id}", title: ${JSON.stringify(title)})\n[Context: Past session referenced. Use \`session_read(session_id: "${session.id}")\` to inspect context before responding.]\n`;

  if (await insertIntoPrompt(ctx, instruction)) {
    ctx.ui.toast.show({
      title: "Session Referenced",
      message: `Injected reference to "${title}"`,
      variant: "success",
    });
  } else {
    ctx.ui.toast.show({
      title: "Session Reference",
      message: "Open the prompt before referencing a session.",
      variant: "warning",
    });
  }
}

export default Plugin.define({
  id,
  setup(ctx) {
    // Keymap layers need a component owner: register from an `app` slot.
    ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.reference",
              title: "Reference Past Session",
              group: "Session",
              palette: true,
              bind: "ctrl+s",
              slash: { name: "ref-session", aliases: ["ref"] },
              run: () => openSessionPicker(ctx),
            },
          ],
        }));
        return null;
      },
    });
  },
});
