/** @jsxImportSource @opentui/solid */

import { basename } from "node:path";
import type {
  TuiDialogSelectOption,
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { SessionDb, type SessionRow } from "./db/queries.js";

const id = "opencode-session-ref";

function dateGroupLabel(timestamp: number): string {
  const today = new Date().toDateString();
  const label = new Date(timestamp).toDateString();
  return label === today ? "Today" : label;
}

function truncateTitle(title: string, maxLen = 40): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + "...";
}

async function openSessionPicker(api: TuiPluginApi): Promise<void> {
  try {
    // 1. Fetch recent sessions
    const sessions = await SessionDb.listRecentSessions({ limit: 40 });

    if (sessions.length === 0) {
      api.ui?.toast?.({
        title: "Session Reference",
        message: "No previous sessions found in database.",
        variant: "warning",
      });
      return;
    }

    // 2. Sort by last update (most recent first), group by date like /sessions.
    //    Date group label is the group header; folder basename shown as muted footer.
    const sessionsSorted = [...sessions].sort((a, b) => b.time_updated - a.time_updated);
    const options: TuiDialogSelectOption<SessionRow>[] = sessionsSorted.map((s) => ({
      title: truncateTitle(s.title || s.slug),
      value: s,
      category: dateGroupLabel(s.time_updated),
      footer: basename(s.directory).slice(0, 20),
    }));

    // 3. Render DialogSelect, widened to match the /sessions dialog
    api.ui.dialog.replace(
      () => (
        <api.ui.DialogSelect<SessionRow>
          title="Reference Past Session"
          placeholder="Search sessions by title, slug, or folder..."
          options={options}
          onSelect={(selected) => {
            const session = selected.value;
            const instruction = `@session(id: "${session.id}", title: "${session.title}")\n[Context: Past session referenced. Use \`session_read(session_id: "${session.id}")\` to inspect context before responding.]\n`;

            if (api.client?.tui?.appendPrompt) {
              void api.client.tui.appendPrompt({
                text: instruction,
              });
            }

            api.ui.dialog.clear();
            api.ui?.toast?.({
              title: "Session Referenced",
              message: `Injected reference to "${session.title}" (${session.slug})`,
              variant: "success",
            });
          }}
        />
      ),
      () => {
        // on close
      },
    );
    api.ui.dialog.setSize("large");
  } catch (err) {
    api.ui?.toast?.({
      title: "Error",
      message: `Failed to load sessions: ${err instanceof Error ? err.message : String(err)}`,
      variant: "error",
    });
  }
}

export const SessionRefTuiPlugin: TuiPlugin = async (api) => {
  if (api.command?.register) {
    api.command.register(() => [
      {
        title: "Reference Past Session",
        value: "session.reference",
        category: "Session Reference",
        slash: {
          name: "ref-session",
          aliases: ["ref", "session-ref"],
        },
        keybind: "ctrl+s",
        onSelect: () => {
          void openSessionPicker(api);
        },
      },
    ]);
  }
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui: SessionRefTuiPlugin,
};

export default pluginModule;
