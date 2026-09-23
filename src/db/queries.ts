import { getOpenCodeDbPath } from "./paths.js";
import { openOpenCodeSqliteReadOnly, type SqliteConn } from "./sqlite.js";

// OpenCode 2 stores sessions in `session_v2` and every message, whatever its
// kind, in `session_message` (typed by the `type` column, payload in `data`).
// A server plugin cannot list sessions nor read a full history through the
// plugin API (only the context window after the last compaction), and nothing
// searches message text, so this reads the database directly, read-only.

export interface SessionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string | null;
  version: string;
  share_url: string | null;
  time_created: number;
  time_updated: number;
  agent: string | null;
  /** JSON `{ id, providerID, variant? }` in V2 sessions. */
  model: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
}

export type MessageType =
  | "user"
  | "assistant"
  | "synthetic"
  | "system"
  | "skill"
  | "shell"
  | "compaction"
  | "agent-switched"
  | "model-switched"
  | "location-switched"
  | "idle"
  | (string & {});

export interface MessageRow {
  id: string;
  session_id: string;
  type: MessageType;
  seq: number;
  time_created: number;
  /** JSON payload of the message, without its `id` and `type`. */
  data: string;
}

export interface SessionSearchResult {
  id: string;
  slug: string;
  title: string | null;
  directory: string;
  time_created: number;
  snippets: string[];
}

const SESSION_COLUMNS = `id, project_id, parent_id, slug, directory, title, version,
       share_url, time_created, time_updated, agent, model, cost,
       tokens_input, tokens_output`;

export class SessionDb {
  private static conn: SqliteConn | null = null;

  static async getConn(): Promise<SqliteConn> {
    if (!this.conn) {
      const dbPath = getOpenCodeDbPath();
      this.conn = await openOpenCodeSqliteReadOnly(dbPath);
    }
    return this.conn;
  }

  /**
   * List recent sessions, optionally filtered by directory/project and by a
   * minimum `time_updated` threshold (`since`, epoch ms).
   */
  static async listRecentSessions(options: {
    limit?: number;
    directory?: string;
    since?: number;
  } = {}): Promise<SessionRow[]> {
    const conn = await this.getConn();
    const limit = Math.min(options.limit ?? 20, 200);

    const where: string[] = [];
    const params: unknown[] = [];
    if (options.directory) {
      where.push("(directory = ? OR directory LIKE ?)");
      params.push(options.directory, `${options.directory}%`);
    }
    if (options.since !== undefined) {
      where.push("time_updated >= ?");
      params.push(options.since);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    return conn.all<SessionRow>(
      `SELECT ${SESSION_COLUMNS}
       FROM session_v2
       ${whereClause}
       ORDER BY time_updated DESC
       LIMIT ?`,
      [...params, limit],
    );
  }

  /**
   * Find a session by full ID or slug. Slugs are not guaranteed unique across
   * projects, so slug lookups return the most recently updated match.
   */
  static async findSession(idOrSlug: string): Promise<SessionRow | null> {
    const conn = await this.getConn();
    const isId = idOrSlug.startsWith("ses_");
    const row = conn.get<SessionRow>(
      `SELECT ${SESSION_COLUMNS}
       FROM session_v2
       WHERE ${isId ? "id = ?" : "slug = ?"}
       ${isId ? "" : "ORDER BY time_updated DESC "}
       LIMIT 1`,
      [idOrSlug],
    );
    return row ?? null;
  }

  /**
   * Search sessions by query across titles, slugs, user prompts and assistant
   * replies. Synthetic reminders are separate message types and never match.
   */
  static async searchSessions(options: {
    query: string;
    limit?: number;
  }): Promise<SessionSearchResult[]> {
    const conn = await this.getConn();
    const limit = Math.min(options.limit ?? 10, 50);
    const q = options.query.trim();
    if (!q) return [];
    const pattern = `%${q}%`;

    // 1. Direct match on title or slug
    const matchingSessions = conn.all<SessionRow>(
      `SELECT ${SESSION_COLUMNS}
       FROM session_v2
       WHERE title LIKE ? OR slug LIKE ?
       ORDER BY time_updated DESC
       LIMIT ?`,
      [pattern, pattern, limit],
    );

    // 2. Message text. `m.data LIKE` is a cheap pre-filter so json_each only
    //    expands the assistant messages that can match.
    const textMatches = conn.all<{
      session_id: string;
      title: string | null;
      slug: string;
      directory: string;
      time_created: number;
      text: string;
    }>(
      `SELECT s.id AS session_id, s.title, s.slug, s.directory, s.time_created, hit.text
       FROM (
         SELECT m.session_id, m.time_created AS at, json_extract(m.data, '$.text') AS text
         FROM session_message m
         WHERE m.type = 'user' AND json_extract(m.data, '$.text') LIKE ?
         UNION ALL
         SELECT m.session_id, m.time_created AS at, json_extract(j.value, '$.text') AS text
         FROM session_message m, json_each(json_extract(m.data, '$.content')) j
         WHERE m.type = 'assistant' AND m.data LIKE ?
           AND json_extract(j.value, '$.type') = 'text'
           AND json_extract(j.value, '$.text') LIKE ?
       ) hit
       JOIN session_v2 s ON s.id = hit.session_id
       ORDER BY hit.at DESC
       LIMIT ?`,
      [pattern, pattern, pattern, limit * 3],
    );

    const resultsMap = new Map<string, SessionSearchResult>();

    for (const s of matchingSessions) {
      resultsMap.set(s.id, {
        id: s.id,
        slug: s.slug,
        title: s.title,
        directory: s.directory,
        time_created: s.time_created,
        snippets: [],
      });
    }

    for (const row of textMatches) {
      let entry = resultsMap.get(row.session_id);
      if (!entry) {
        if (resultsMap.size >= limit) continue;
        entry = {
          id: row.session_id,
          slug: row.slug,
          title: row.title,
          directory: row.directory,
          time_created: row.time_created,
          snippets: [],
        };
        resultsMap.set(row.session_id, entry);
      }

      if (entry.snippets.length < 3 && row.text) {
        const text = row.text;
        const idx = text.toLowerCase().indexOf(q.toLowerCase());
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + q.length + 80);
        const snippet = (start > 0 ? "..." : "") + text.slice(start, end).replace(/\n+/g, " ") + (end < text.length ? "..." : "");
        if (!entry.snippets.includes(snippet)) {
          entry.snippets.push(snippet);
        }
      }
    }

    return Array.from(resultsMap.values()).slice(0, limit);
  }

  /**
   * Fetch a session and its messages in conversation order.
   */
  static async getSessionMessages(idOrSlug: string): Promise<{
    session: SessionRow | null;
    messages: MessageRow[];
  }> {
    const conn = await this.getConn();
    const session = await this.findSession(idOrSlug);
    if (!session) {
      return { session: null, messages: [] };
    }

    const messages = conn.all<MessageRow>(
      `SELECT id, session_id, type, seq, time_created, data
       FROM session_message
       WHERE session_id = ? AND type IN ('user', 'assistant', 'shell')
       ORDER BY seq ASC`,
      [session.id],
    );

    return { session, messages };
  }
}
