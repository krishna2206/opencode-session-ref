/** @jsxImportSource @opentui/solid */

import type {
  TuiDialogSelectOption,
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { SessionDb, type SessionRow } from "./db/queries.js";

const id = "opencode-session-ref";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function shortenPath(fullPath: string): string {
  const home = process.env.HOME || "";
  if (home && fullPath.startsWith(home)) {
    return `~${fullPath.slice(home.length)}`;
  }
  return fullPath;
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

    // 2. Build options for DialogSelect
    const options: TuiDialogSelectOption<SessionRow>[] = sessions.map((s) => ({
      title: s.title || s.slug,
      value: s,
      description: `${s.slug} • ${formatRelativeTime(s.time_created)} • ${shortenPath(s.directory)}`,
      category: shortenPath(s.directory),
    }));

    // 3. Render DialogSelect
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
