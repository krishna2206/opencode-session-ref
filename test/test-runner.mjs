import assert from "node:assert";
import { SessionDb } from "../dist/db/queries.js";
import { sessionSearchTool } from "../dist/tools/search.js";
import { createSessionListTool } from "../dist/tools/list.js";
import { sessionReadTool } from "../dist/tools/read.js";

async function runTests() {
  console.log("--- Starting opencode-session-ref tests ---\n");

  // 1. Test listing sessions from DB
  console.log("1. Testing SessionDb.listRecentSessions...");
  const recentSessions = await SessionDb.listRecentSessions({ limit: 5 });
  assert(Array.isArray(recentSessions), "listRecentSessions should return an array");
  assert(recentSessions.length > 0, "Should have at least 1 session in local DB");
  console.log(`✓ Retrieved ${recentSessions.length} sessions. First: "${recentSessions[0].title}" (${recentSessions[0].id})`);

  const targetSession = recentSessions[0];

  // 2. Test finding session by ID and Slug
  console.log("\n2. Testing SessionDb.findSession...");
  const byId = await SessionDb.findSession(targetSession.id);
  assert(byId !== null, "Should find session by ID");
  assert.strictEqual(byId.id, targetSession.id);

  const bySlug = await SessionDb.findSession(targetSession.slug);
  assert(bySlug !== null, "Should find session by slug");
  assert.strictEqual(bySlug.id, targetSession.id);
  console.log(`✓ Found session by ID and slug: ${targetSession.slug}`);

  // 3. Test searching sessions with query
  console.log("\n3. Testing SessionDb.searchSessions...");
  const searchResults = await SessionDb.searchSessions({ query: "opencode", limit: 3 });
  assert(Array.isArray(searchResults), "Search results should be an array");
  console.log(`✓ Search for 'opencode' returned ${searchResults.length} matches.`);

  // 4. Test tool session_list
  console.log("\n4. Testing session_list tool execution...");
  const listTool = createSessionListTool(process.cwd());
  const listOutput = await listTool.execute({ limit: 3 }, {});
  assert(typeof listOutput === "string" && listOutput.includes("|"), "Output should be markdown table");
  console.log("✓ session_list output snippet:\n" + listOutput.slice(0, 150) + "...\n");

  // 5. Test tool session_search
  console.log("5. Testing session_search tool execution...");
  const searchOutput = await sessionSearchTool.execute({ query: "prompt" }, {});
  assert(typeof searchOutput === "string", "Output should be string");
  console.log("✓ session_search output snippet:\n" + searchOutput.slice(0, 150) + "...\n");

  // 6. Test tool session_read (mode: summary)
  console.log("6. Testing session_read tool execution (mode: summary)...");
  const readSummary = await sessionReadTool.execute({ session_id: targetSession.id, mode: "summary" }, {});
  assert(typeof readSummary === "string" && readSummary.includes(targetSession.title), "Summary should contain title");
  console.log("✓ session_read (summary) output snippet:\n" + readSummary.slice(0, 200) + "...\n");

  // 7. Test tool session_read (mode: turns)
  console.log("7. Testing session_read tool execution (mode: turns)...");
  const readTurns = await sessionReadTool.execute({ session_id: targetSession.id, mode: "turns", last_turns: 2 }, {});
  assert(typeof readTurns === "string", "Turns should return string");
  console.log("✓ session_read (turns) output snippet:\n" + readTurns.slice(0, 200) + "...\n");

  // 8. Test tool session_read (mode: diff)
  console.log("8. Testing session_read tool execution (mode: diff)...");
  const readDiff = await sessionReadTool.execute({ session_id: targetSession.id, mode: "diff" }, {});
  assert(typeof readDiff === "string", "Diff should return string");
  console.log("✓ session_read (diff) output snippet:\n" + readDiff.slice(0, 150) + "...\n");

  console.log(" All tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
