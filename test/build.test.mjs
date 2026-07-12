import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaude } from "../build/adapters/claude.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("buildClaude는 plugin.json·hooks·콘텐츠를 생성", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bc-")), "claude");
  buildClaude(SRC, out);
  assert.ok(existsSync(join(out, ".claude-plugin/plugin.json")));
  assert.ok(existsSync(join(out, ".claude-plugin/marketplace.json")));
  assert.ok(existsSync(join(out, "hooks/hooks.json")));
  assert.ok(existsSync(join(out, "hooks/activate.js")));
  assert.ok(existsSync(join(out, "hooks/posttooluse.js")), "G7 PostToolUse redaction hook");
  assert.ok(existsSync(join(out, "hooks/secret-scan-core.js")), "G7 shared secret-scan core");
  assert.match(readFileSync(join(out, "hooks/hooks.json"), "utf8"), /PostToolUse[\s\S]*posttooluse\.js/, "hooks.json wires PostToolUse → posttooluse.js");
  assert.ok(existsSync(join(out, "rules/operating-rules.md")));
  for (const s of ["referencing", "product-map", "design-system", "monitoring", "security-scan"])
    assert.ok(existsSync(join(out, "skills", s, "SKILL.md")), s);
  assert.ok(existsSync(join(out, "skills/retrospect/SKILL.md")));
  assert.ok(existsSync(join(out, "skills/retrospect/retrospect-scan.mjs")));
  // hooks.json은 Claude env var를 그대로 유지
  assert.match(readFileSync(join(out, "hooks/hooks.json"), "utf8"), /CLAUDE_PLUGIN_ROOT/);
});
