import type { FileEdit } from "./sanitize.js";

const MAX_DP_CELLS = 200_000;
const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_LINES_PER_FILE = 120;

function diffLines(a: string[], b: string[]): string[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_DP_CELLS) return null;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(" " + a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push("-" + a[i]);
      i++;
    } else {
      out.push("+" + b[j]);
      j++;
    }
  }
  while (i < n) out.push("-" + a[i++]);
  while (j < m) out.push("+" + b[j++]);
  return out;
}

function capLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more diff lines truncated)`];
}

function formatFileEdit(edit: FileEdit, maxLinesPerFile: number): string {
  let lines: string[];
  if (edit.patch !== undefined) {
    lines = edit.patch.split("\n").filter((l) => !/^\*\*\* (Begin|End) Patch$/.test(l));
  } else {
    const beforeLines = edit.before ? edit.before.split("\n") : [];
    const afterLines = edit.after ? edit.after.split("\n") : [];
    lines =
      diffLines(beforeLines, afterLines) ??
      // Too large for line diff: fall back to a compact before/after summary
      [
        `-${beforeLines.length} ${beforeLines.slice(0, 10).map((l) => l.trim()).join(" | ")}`.slice(0, 400),
        `+${afterLines.length} ${afterLines.slice(0, 10).map((l) => l.trim()).join(" | ")}`.slice(0, 400),
      ];
  }

  const additions = lines.filter((l) => l.startsWith("+")).length;
  const deletions = lines.filter((l) => l.startsWith("-")).length;
  return [
    `### ${edit.file} (+${additions}/-${deletions})`,
    "",
    "```diff",
    ...capLines(lines, maxLinesPerFile),
    "```",
  ].join("\n");
}

/**
 * Renders the session's file edits, one block per editing tool call, most
 * recent last. `edit` calls show only the replaced region, not the whole file.
 */
export function formatFileEdits(
  edits: FileEdit[],
  options: { maxFiles?: number; maxLinesPerFile?: number } = {},
): string {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxLinesPerFile = options.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE;

  if (edits.length === 0) {
    return "No file edits were recorded in this session.";
  }

  // Keep the most recent edits when capping: they reflect the final state.
  const selected = edits.slice(-maxFiles);
  const out: string[] = [];
  out.push(`# Edits (${edits.length} tool call${edits.length > 1 ? "s" : ""}):`);
  if (selected.length < edits.length) {
    out.push(`\n*(${edits.length - selected.length} earlier edits omitted)*`);
  }
  out.push("");
  for (const edit of selected) out.push(formatFileEdit(edit, maxLinesPerFile));
  return out.join("\n");
}
