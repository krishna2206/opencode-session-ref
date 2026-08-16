export interface DiffsInput {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

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

function formatFileDiff(file: DiffsInput, maxLinesPerFile: number): string {
  const beforeLines = file.before.split("\n");
  const afterLines = file.after.split("\n");

  const lines =
    diffLines(beforeLines, afterLines) ??
    // Too large for line diff: fall back to a compact before/after summary
    [
      `-${beforeLines.length} ${beforeLines.slice(0, 10).map((l) => l.trim()).join(" | ")}`.slice(0, 400),
      `+${afterLines.length} ${afterLines.slice(0, 10).map((l) => l.trim()).join(" | ")}`.slice(0, 400),
    ];

  let truncated = false;
  let body = lines;
  if (lines.length > maxLinesPerFile) {
    body = lines.slice(0, maxLinesPerFile);
    truncated = true;
  }

  const out: string[] = [];
  out.push(`### ${file.file} (+${file.additions}/-${file.deletions})`);
  out.push("");
  out.push("```diff");
  for (const line of body) out.push(line);
  if (truncated) out.push(`... (${lines.length - maxLinesPerFile} more diff lines truncated)`);
  out.push("```");
  return out.join("\n");
}

export function formatFileDiffs(
  diffs: DiffsInput[],
  options: { maxFiles?: number; maxLinesPerFile?: number } = {},
): string {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxLinesPerFile = options.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE;

  if (diffs.length === 0) {
    return "No file diffs available for this session.";
  }

  const selected = diffs.slice(0, maxFiles);
  const out: string[] = [];
  out.push(`# Diffs (${diffs.length} file${diffs.length > 1 ? "s" : ""}):`);
  out.push("");
  for (const file of selected) out.push(formatFileDiff(file, maxLinesPerFile));
  if (selected.length < diffs.length) {
    out.push(`\n*(+${diffs.length - selected.length} more files truncated)*`);
  }
  return out.join("\n");
}