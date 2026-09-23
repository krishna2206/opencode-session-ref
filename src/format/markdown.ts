import type { SessionRow, SessionSearchResult, MessageRow } from "../db/queries.js";
import { buildConversationTurns, collectFileEdits, truncateText } from "./sanitize.js";
import { formatFileEdits } from "./diff.js";

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toISOString().replace("T", " ").replace(/\..+/, "");
}

function timeAgo(timestamp: number): string {
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

/** V2 sessions may have no title yet; the slug always exists. */
function sessionTitle(session: { title: string | null; slug: string }): string {
  return session.title || session.slug;
}

/** `model` is stored as JSON `{ id, providerID, variant? }`. */
function formatModel(model: string | null): string | undefined {
  if (!model) return undefined;
  try {
    const parsed = JSON.parse(model) as { id?: string; providerID?: string; variant?: string };
    if (!parsed.id) return model;
    const name = parsed.providerID ? `${parsed.providerID}/${parsed.id}` : parsed.id;
    return parsed.variant ? `${name}#${parsed.variant}` : name;
  } catch {
    return model;
  }
}

/**
 * High-level summary of the session: metadata, files touched, turns overview.
 */
export function formatSessionSummary(
  session: SessionRow,
  messages: MessageRow[],
): string {
  const turns = buildConversationTurns(messages);
  const allFilesModified = Array.from(
    new Set(turns.flatMap((t) => t.filesModified)),
  );

  const lines: string[] = [];
  lines.push(`# Session: ${sessionTitle(session)}`);
  lines.push(`- **ID**: \`${session.id}\``);
  lines.push(`- **Slug**: \`${session.slug}\``);
  lines.push(`- **Directory**: \`${session.directory}\``);
  lines.push(`- **Created**: ${formatDate(session.time_created)} (${timeAgo(session.time_created)})`);
  if (session.agent) lines.push(`- **Agent**: \`${session.agent}\``);
  const model = formatModel(session.model);
  if (model) lines.push(`- **Model**: \`${model}\``);
  lines.push(`- **Total Turns**: ${turns.length}`);

  if (allFilesModified.length > 0) {
    lines.push("\n### Files Modified:");
    for (const f of allFilesModified) {
      lines.push(`- \`${f}\``);
    }
  }

  if (turns.length > 0) {
    lines.push("\n### Turn Summary (Chronological):");
    for (const turn of turns) {
      const promptSnippet = truncateText(turn.userPrompt.replace(/\n+/g, " "), 120);
      const answerSnippet = turn.assistantAnswers.length > 0
        ? truncateText(turn.assistantAnswers[turn.assistantAnswers.length - 1].replace(/\n+/g, " "), 150)
        : "(No text response)";
      const toolsCount = turn.toolsUsed.length > 0 ? ` [Used ${turn.toolsUsed.length} tool(s)]` : "";

      lines.push(
        `**Turn ${turn.turnIndex}**:\n` +
        `  - **User**: "${promptSnippet}"\n` +
        `  - **Assistant**${toolsCount}: "${answerSnippet}"`,
      );
    }
  }

  lines.push("\n*(Tip: Use `session_read` with `mode: \"turns\"` to view the full dialogue, or `mode: \"diff\"` to view the file edits)*");

  return capBytes(lines.join("\n"));
}

export const MAX_SESSION_READ_BYTES = 16_000;

/**
 * Formats user and assistant message exchanges.
 */
export function formatSessionTurns(
  session: SessionRow,
  messages: MessageRow[],
  lastTurns?: number,
): string {
  const turns = buildConversationTurns(messages);
  const selectedTurns = lastTurns && lastTurns > 0 ? turns.slice(-lastTurns) : turns;

  const lines: string[] = [];
  lines.push(`# Transcript: ${sessionTitle(session)} (${session.slug})`);
  lines.push(`*Directory: \`${session.directory}\` | ${formatDate(session.time_created)}*`);
  if (lastTurns && lastTurns < turns.length) {
    lines.push(`*(Showing last ${lastTurns} of ${turns.length} total turns)*`);
  }
  lines.push("\n---");

  let accumulatedBytes = Buffer.byteLength(lines.join("\n"), "utf-8");
  let includedCount = 0;

  for (const turn of selectedTurns) {
    const turnLines: string[] = [];
    turnLines.push(`\n## [Turn ${turn.turnIndex}] User:`);
    turnLines.push(turn.userPrompt);

    if (turn.toolsUsed.length > 0) {
      turnLines.push("\n> **Actions performed**:");
      for (const t of turn.toolsUsed) {
        if (t.tool === "bash" && t.command) {
          turnLines.push(`> - Run command: \`${truncateText(t.command, 80)}\``);
        } else if ((t.tool === "write" || t.tool === "edit") && t.filePath) {
          turnLines.push(`> - Edit file: \`${t.filePath}\``);
        } else if (t.tool === "read" && t.filePath) {
          turnLines.push(`> - Read file: \`${t.filePath}\``);
        } else {
          turnLines.push(`> - Tool: \`${t.tool}\`${t.description ? ` (${t.description})` : ""}`);
        }
      }
    }

    turnLines.push(`\n## [Turn ${turn.turnIndex}] Assistant:`);
    if (turn.assistantAnswers.length > 0) {
      turnLines.push(turn.assistantAnswers.join("\n\n"));
    } else {
      turnLines.push("*(Completed actions without extra text commentary)*");
    }

    turnLines.push("\n---");

    const turnChunk = turnLines.join("\n");
    const turnBytes = Buffer.byteLength(turnChunk, "utf-8");

    if (accumulatedBytes + turnBytes > MAX_SESSION_READ_BYTES) {
      // A single oversized turn is shown cut rather than dropped, so the output
      // is never an empty transcript.
      if (includedCount === 0) {
        const room = Math.max(0, MAX_SESSION_READ_BYTES - accumulatedBytes);
        lines.push(Buffer.from(turnChunk, "utf-8").subarray(0, room).toString("utf-8"));
        includedCount++;
      }
      lines.push(
        `\n*(Output capped at ~16 KB to protect context. Showing ${includedCount} of ${selectedTurns.length} requested turns. Call session_read with smaller last_turns or mode: "summary")*`,
      );
      break;
    }

    lines.push(turnChunk);
    accumulatedBytes += turnBytes;
    includedCount++;
  }

  return lines.join("\n");
}

/**
 * Formats the file edits made by the session's tools.
 */
export function formatSessionDiff(
  session: SessionRow,
  messages: MessageRow[],
): string {
  const lines: string[] = [];
  lines.push(`# Changes in Session: ${sessionTitle(session)}`);
  lines.push(`- **ID**: \`${session.id}\` | **Slug**: \`${session.slug}\``);
  lines.push(`- **Directory**: \`${session.directory}\``);
  lines.push("");
  lines.push(formatFileEdits(collectFileEdits(messages)));
  return capBytes(lines.join("\n"));
}

/** Hard cap shared by every `session_read` mode that can grow unbounded. */
function capBytes(text: string): string {
  if (Buffer.byteLength(text, "utf-8") <= MAX_SESSION_READ_BYTES) return text;
  const cut = Buffer.from(text, "utf-8").subarray(0, MAX_SESSION_READ_BYTES).toString("utf-8");
  return `${cut}\n\n*(Output capped at ~16 KB to protect context.)*`;
}

/**
 * Full transcript including tool inputs and outputs.
 */
export function formatSessionFull(
  session: SessionRow,
  messages: MessageRow[],
  lastTurns?: number,
): string {
  return formatSessionTurns(session, messages, lastTurns);
}

/**
 * Formats a list of sessions into a concise markdown table.
 */
export function formatSessionList(sessions: SessionRow[]): string {
  if (sessions.length === 0) {
    return "No past sessions found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${sessions.length} session(s):\n`);
  lines.push("| Title / Slug | ID | Date | Directory |");
  lines.push("| :--- | :--- | :--- | :--- |");

  for (const s of sessions) {
    const title = sessionTitle(s).replace(/\|/g, "-");
    const ago = timeAgo(s.time_created);
    lines.push(`| **${title}** (\`${s.slug}\`) | \`${s.id}\` | ${ago} | \`${s.directory}\` |`);
  }

  lines.push("\n*(Use `session_read(session_id: \"<id>\")` to inspect any session)*");
  return lines.join("\n");
}

/**
 * Formats search results with highlighted snippets.
 */
export function formatSearchResults(
  results: SessionSearchResult[],
  query: string,
): string {
  if (results.length === 0) {
    return `No past sessions matched the query "${query}".`;
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} session(s) matching "${query}":\n`);

  for (const r of results) {
    lines.push(`### ${sessionTitle(r)} (\`${r.slug}\`)`);
    lines.push(`- **ID**: \`${r.id}\``);
    lines.push(`- **Date**: ${formatDate(r.time_created)} (${timeAgo(r.time_created)})`);
    lines.push(`- **Directory**: \`${r.directory}\``);

    if (r.snippets.length > 0) {
      lines.push("- **Relevant Matches**:");
      for (const snip of r.snippets) {
        lines.push(`  > "${snip}"`);
      }
    }
    lines.push("");
  }

  lines.push("*(Use `session_read(session_id: \"<id>\")` to read the full context of a match)*");
  return lines.join("\n");
}
