import type { SessionRow, SessionSearchResult, MessageRow, PartRow } from "../db/queries.js";
import { buildConversationTurns, truncateText } from "./sanitize.js";

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

/**
 * High-level summary of the session: metadata, files touched, turns overview.
 */
export function formatSessionSummary(
  session: SessionRow,
  messages: MessageRow[],
  parts: PartRow[],
): string {
  const turns = buildConversationTurns(messages, parts);
  const allFilesModified = Array.from(
    new Set(turns.flatMap((t) => t.filesModified)),
  );

  const lines: string[] = [];
  lines.push(`# Session: ${session.title}`);
  lines.push(`- **ID**: \`${session.id}\``);
  lines.push(`- **Slug**: \`${session.slug}\``);
  lines.push(`- **Directory**: \`${session.directory}\``);
  lines.push(`- **Created**: ${formatDate(session.time_created)} (${timeAgo(session.time_created)})`);
  if (session.agent) lines.push(`- **Agent**: \`${session.agent}\``);
  if (session.model) lines.push(`- **Model**: \`${session.model}\``);
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

  lines.push("\n*(Tip: Use `session_read` with `mode: \"turns\"` to view the full dialogue, or `mode: \"diff\"` to view git diffs)*");

  return lines.join("\n");
}

/**
 * Formats user and assistant message exchanges.
 */
export function formatSessionTurns(
  session: SessionRow,
  messages: MessageRow[],
  parts: PartRow[],
  lastTurns?: number,
): string {
  const turns = buildConversationTurns(messages, parts);
  const selectedTurns = lastTurns && lastTurns > 0 ? turns.slice(-lastTurns) : turns;

  const lines: string[] = [];
  lines.push(`# Transcript: ${session.title} (${session.slug})`);
  lines.push(`*Directory: \`${session.directory}\` | ${formatDate(session.time_created)}*`);
  if (lastTurns && lastTurns < turns.length) {
    lines.push(`*(Showing last ${lastTurns} of ${turns.length} total turns)*`);
  }
  lines.push("\n---");

  for (const turn of selectedTurns) {
    lines.push(`\n## [Turn ${turn.turnIndex}] User:`);
    lines.push(turn.userPrompt);

    if (turn.toolsUsed.length > 0) {
      lines.push("\n> **Actions performed**:");
      for (const t of turn.toolsUsed) {
        if (t.tool === "bash" && t.command) {
          lines.push(`> - Run command: \`${truncateText(t.command, 80)}\``);
        } else if ((t.tool === "write" || t.tool === "edit") && t.filePath) {
          lines.push(`> - Edit file: \`${t.filePath}\``);
        } else if (t.tool === "read" && t.filePath) {
          lines.push(`> - Read file: \`${t.filePath}\``);
        } else {
          lines.push(`> - Tool: \`${t.tool}\`${t.description ? ` (${t.description})` : ""}`);
        }
      }
    }

    lines.push(`\n## [Turn ${turn.turnIndex}] Assistant:`);
    if (turn.assistantAnswers.length > 0) {
      lines.push(turn.assistantAnswers.join("\n\n"));
    } else {
      lines.push("*(Completed actions without extra text commentary)*");
    }

    lines.push("\n---");
  }

  return lines.join("\n");
}

/**
 * Formats git diffs or file modifications made in the session.
 */
export function formatSessionDiff(
  session: SessionRow,
  messages: MessageRow[],
  parts: PartRow[],
): string {
  const lines: string[] = [];
  lines.push(`# Changes in Session: ${session.title}`);
  lines.push(`- **ID**: \`${session.id}\` | **Slug**: \`${session.slug}\``);
  lines.push(`- **Directory**: \`${session.directory}\``);

  if (session.summary_diffs) {
    lines.push("\n```diff");
    lines.push(session.summary_diffs);
    lines.push("```");
    return lines.join("\n");
  }

  const turns = buildConversationTurns(messages, parts);
  const allFiles = Array.from(new Set(turns.flatMap((t) => t.filesModified)));

  if (allFiles.length === 0) {
    lines.push("\nNo file modifications were recorded in this session.");
    return lines.join("\n");
  }

  lines.push(`\n### Modified Files (${allFiles.length}):`);
  for (const f of allFiles) {
    lines.push(`- \`${f}\``);
  }

  return lines.join("\n");
}

/**
 * Full transcript including tool inputs and outputs.
 */
export function formatSessionFull(
  session: SessionRow,
  messages: MessageRow[],
  parts: PartRow[],
  lastTurns?: number,
): string {
  return formatSessionTurns(session, messages, parts, lastTurns);
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
    const title = s.title.replace(/\|/g, "-");
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
    lines.push(`### ${r.title} (\`${r.slug}\`)`);
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
