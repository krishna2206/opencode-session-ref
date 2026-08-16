import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export function getOpenCodeDbPath(): string {
  if (process.env.OPENCODE_DB_PATH && existsSync(process.env.OPENCODE_DB_PATH)) {
    return process.env.OPENCODE_DB_PATH;
  }

  // Standard OpenCode database path
  const standardPath = join(homedir(), ".local", "share", "opencode", "opencode.db");
  if (existsSync(standardPath)) {
    return standardPath;
  }

  // Fallback check under XDG_DATA_HOME if set
  if (process.env.XDG_DATA_HOME) {
    const xdgPath = join(process.env.XDG_DATA_HOME, "opencode", "opencode.db");
    if (existsSync(xdgPath)) {
      return xdgPath;
    }
  }

  return standardPath;
}
