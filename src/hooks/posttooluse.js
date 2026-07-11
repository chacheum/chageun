// chageun G7 — Claude PostToolUse guard: redact .env secret values from tool output before the model sees it.
// Task-0 spike (CC 2.1.207) confirmed: updatedToolOutput takes the full (redacted) tool_response value directly,
// it replaces the persisted transcript entry (no raw leak on --resume), and is honored above the 10K stdout cap.
"use strict";
const { collectSecrets, redact } = require("./secret-scan-core.js");

function redactDeep(node, secrets, stats) {
  if (typeof node === "string") { const r = redact(node, secrets); stats.count += r.count; return r.text; }
  if (Array.isArray(node)) return node.map((n) => redactDeep(n, secrets, stats));
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) out[k] = redactDeep(node[k], secrets, stats);
    return out;
  }
  return node;
}
function touchesEnv(input) {
  try {
    const fp = input && (input.file_path || input.path);
    if (typeof fp === "string" && /\.env(\.|\b)/.test(fp)) return true;
    const cmd = input && input.command;
    if (typeof cmd === "string" && /\.env(\.|\b)/.test(cmd)) return true;
  } catch (_) {}
  return false;
}
const SUPPRESS = { hookSpecificOutput: { hookEventName: "PostToolUse",
  updatedToolOutput: "[chageun: .env output suppressed — redaction failed]" } };

const MAX_SCAN = 5 * 1024 * 1024; // 5MB — beyond this, skip to avoid 10s timeout → fail-open
function decide(input) {
  if (!input || input.tool_response == null) return null;
  const cwd = input.cwd || process.cwd();
  let secrets;
  try { secrets = collectSecrets(cwd); }
  catch (_) { return touchesEnv(input.tool_input) ? SUPPRESS : null; }
  if (!secrets.length) return null;
  let serialized;
  try { serialized = typeof input.tool_response === "string" ? input.tool_response : JSON.stringify(input.tool_response); }
  catch (_) { serialized = ""; }
  if (serialized.length > MAX_SCAN) return touchesEnv(input.tool_input) ? SUPPRESS : null; // fail-closed on .env, else pass
  const stats = { count: 0 };
  let updated;
  try { updated = redactDeep(input.tool_response, secrets, stats); }
  catch (_) { return touchesEnv(input.tool_input) ? SUPPRESS : null; }
  if (stats.count === 0) return null;
  return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } };
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const out = decide(JSON.parse(raw));
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (_) { /* fail-open */ }
    process.exit(0);
  });
}
module.exports = { decide };
