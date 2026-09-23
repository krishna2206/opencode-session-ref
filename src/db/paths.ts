import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The database opencode itself uses, resolved the same way: `OPENCODE_DB`
 * (absolute, or relative to the data directory), else `opencode.db`, in
 * `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`.
 */
export function getOpenCodeDbPath(): string {
  const data = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode");
  return resolve(data, process.env.OPENCODE_DB ?? "opencode.db");
}
