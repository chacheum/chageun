import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { decide } = require("../src/hooks/posttooluse.js");

function tmpEnv(line) {
  const d = mkdtempSync(join(tmpdir(), "g7p-"));
  writeFileSync(join(d, ".env"), line + "\n");
  return d;
}

test("redacts secret in nested tool_response, preserves structure", () => {
  const cwd = tmpEnv("API_KEY=sk-secret12345678");
  const out = decide({ cwd, tool_name:"Read", tool_input:{file_path:".env"},
    tool_response:{ type:"text", content:"API_KEY=sk-secret12345678" } });
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  const red = JSON.stringify(out.hookSpecificOutput.updatedToolOutput);
  assert.ok(!red.includes("sk-secret12345678"));
  assert.ok(red.includes("(API_KEY)"));
});
test("no secret in output → passthrough null", () => {
  const cwd = tmpEnv("API_KEY=sk-secret12345678");
  assert.equal(decide({ cwd, tool_response:{ content:"nothing sensitive" } }), null);
});
test("no .env → passthrough null", () => {
  assert.equal(decide({ cwd: mkdtempSync(join(tmpdir(),"g7p-")), tool_response:{content:"x"} }), null);
});
test("malformed / missing tool_response → null", () => {
  assert.equal(decide({ cwd:"/nonexistent-xyz", tool_response:null }), null);
});
