import { getOpenCodeDbPath } from "./paths.js";
import { openOpenCodeSqliteReadOnly, type SqliteConn } from "./sqlite.js";

export interface SessionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  share_url: string | null;
  summary_additions: number;
  summary_deletions: number;
  summary_files: number;
  summary_diffs: string | null;
  time_created: number;
  time_updated: number;
  agent: string | null;
  model: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface PartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface SessionSearchResult {
  id: string;
  slug: string;
  title: string;
  directory: string;
  time_created: number;
  snippets: string[];
}

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
   * List recent sessions, optionally filtered by directory/project.
   */
  static async listRecentSessions(options: {
    limit?: number;
    directory?: string;
  } = {}): Promise<SessionRow[]> {
    const conn = await this.getConn();
    const limit = Math.min(options.limit ?? 20, 100);

    if (options.directory) {
      return conn.all<SessionRow>(
        `SELECT id, project_id, parent_id, slug, directory, title, version,
                share_url, summary_additions, summary_deletions, summary_files,
                summary_diffs, time_created, time_updated, agent, model, cost,
                tokens_input, tokens_output
         FROM session
         WHERE directory = ? OR directory LIKE ?
         ORDER BY time_created DESC
         LIMIT ?`,
        [options.directory, `${options.directory}%`, limit],
      );
    }

    return conn.all<SessionRow>(
      `SELECT id, project_id, parent_id, slug, directory, title, version,
              share_url, summary_additions, summary_deletions, summary_files,
              summary_diffs, time_created, time_updated, agent, model, cost,
              tokens_input, tokens_output
       FROM session
       ORDER BY time_created DESC
       LIMIT ?`,
      [limit],
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
      `SELECT id, project_id, parent_id, slug, directory, title, version,
              share_url, summary_additions, summary_deletions, summary_files,
              summary_diffs, time_created, time_updated, agent, model, cost,
              tokens_input, tokens_output
       FROM session
       WHERE ${isId ? "id = ?" : "slug = ?"}
       ${isId ? "" : "ORDER BY time_updated DESC "}
       LIMIT 1`,
      [idOrSlug],
    );
    return row ?? null;
  }

  /**
   * Search sessions by query across titles, slugs, and text parts.
   */
  static async searchSessions(options: {
    query: string;
    limit?: number;
    directory?: string;
  }): Promise<SessionSearchResult[]> {
    const conn = await this.getConn();
    const limit = Math.min(options.limit ?? 10, 50);
    const q = options.query.trim();
    if (!q) return [];

    // 1. Direct match on title or slug
    const matchingSessions = conn.all<SessionRow>(
      `SELECT id, project_id, parent_id, slug, directory, title, version,
              share_url, summary_additions, summary_deletions, summary_files,
              summary_diffs, time_created, time_updated, agent, model, cost,
              tokens_input, tokens_output
       FROM session
       WHERE title LIKE '%' || ? || '%' OR slug LIKE '%' || ? || '%'
       ORDER BY time_created DESC
       LIMIT ?`,
      [q, q, limit],
    );

    // 2. Search in text parts for message snippets
    const partMatches = conn.all<{
      session_id: string;
      title: string;
      slug: string;
      directory: string;
      time_created: number;
      part_text: string;
    }>(
      `SELECT s.id as session_id, s.title, s.slug, s.directory, s.time_created,
              json_extract(p.data, '$.text') as part_text
       FROM part p
       JOIN session s ON s.id = p.session_id
       WHERE json_extract(p.data, '$.type') = 'text'
         AND json_extract(p.data, '$.synthetic') IS NOT 1
         AND json_extract(p.data, '$.text') LIKE '%' || ? || '%'
       ORDER BY p.time_created DESC
       LIMIT ?`,
      [q, limit * 3],
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

    for (const row of partMatches) {
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

      if (entry.snippets.length < 3 && row.part_text) {
        const text = row.part_text;
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
   * Fetch all messages and parts for a given session ID.
   */
  static async getSessionMessagesAndParts(sessionId: string): Promise<{
    session: SessionRow | null;
    messages: MessageRow[];
    parts: PartRow[];
  }> {
    const conn = await this.getConn();
    const session = await this.findSession(sessionId);
    if (!session) {
      return { session: null, messages: [], parts: [] };
    }

    const messages = conn.all<MessageRow>(
      `SELECT id, session_id, time_created, time_updated, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created ASC, id ASC`,
      [session.id],
    );

    const parts = conn.all<PartRow>(
      `SELECT id, message_id, session_id, time_created, time_updated, data
       FROM part
       WHERE session_id = ?
       ORDER BY time_created ASC, id ASC`,
      [session.id],
    );

    return { session, messages, parts };
  }
}
