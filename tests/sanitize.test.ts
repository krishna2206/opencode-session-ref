import { describe, expect, it } from "bun:test";
import type { MessageRow } from "../src/db/queries.js";
import { buildConversationTurns, collectFileEdits } from "../src/format/sanitize.js";

let seq = 0;
const row = (type: string, data: unknown): MessageRow => ({
  id: `msg_${++seq}`,
  session_id: "ses_test",
  type,
  seq,
  time_created: seq,
  data: JSON.stringify(data),
});

const tool = (name: string, input: Record<string, unknown>, status = "completed") => ({
  type: "tool",
  name,
  state: { status, input },
});

const PATCH = "*** Begin Patch\n*** Update File: /repo/c.ts\n@@\n-a\n+b\n*** End Patch";

// One session mixing both shapes: V2 tools (`path`, `patch`, `shell`) and
// tools migrated from V1 (`filePath`, `apply_patch`, `bash`).
const messages = [
  row("user", { text: "change things" }),
  row("assistant", {
    content: [
      tool("edit", { path: "/repo/a.ts", oldString: "old", newString: "new" }),
      tool("write", { path: "/repo/b.ts", content: "x" }),
      tool("patch", { patchText: PATCH }),
      tool("read", { path: "/repo/readme.md" }),
      tool("shell", { command: "ls" }),
      tool("edit", { filePath: "/repo/v1.ts", oldString: "1", newString: "2" }),
      tool("apply_patch", { patchText: PATCH.replace("c.ts", "v1-patch.ts") }),
      tool("bash", { command: "pwd" }),
      tool("edit", { path: "/repo/failed.ts", oldString: "a", newString: "b" }, "error"),
      { type: "text", text: "done" },
    ],
  }),
];

describe("V1 and V2 tool shapes", () => {
  it("lists files modified by V2 and V1 editing tools, skipping failed calls", () => {
    const [turn] = buildConversationTurns(messages);
    expect(turn.filesModified).toEqual(["/repo/a.ts", "/repo/b.ts", "/repo/c.ts", "/repo/v1.ts", "/repo/v1-patch.ts"]);
  });

  it("traces reads and shell commands under both names", () => {
    const [turn] = buildConversationTurns(messages);
    expect(turn.toolsUsed.find((t) => t.tool === "read")?.filePath).toBe("/repo/readme.md");
    expect(turn.toolsUsed.filter((t) => t.tool === "bash").map((t) => t.command)).toEqual(["ls", "pwd"]);
  });

  it("collects completed edits for diff mode", () => {
    const edits = collectFileEdits(messages);
    expect(edits.map((e) => e.file)).toEqual(["/repo/a.ts", "/repo/b.ts", "/repo/c.ts", "/repo/v1.ts", "/repo/v1-patch.ts"]);
    expect(edits[0]).toMatchObject({ before: "old", after: "new" });
    expect(edits[2].patch).toContain("+b");
  });
});
