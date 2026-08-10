import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaude } from "../build/adapters/claude.mjs";
import { tmpDir } from "./support-tmpdir.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("buildClaude는 plugin.json·hooks·콘텐츠를 생성", () => {
  const out = join(tmpDir("bc-"), "claude");
  buildClaude(SRC, out);
  assert.ok(existsSync(join(out, ".claude-plugin/plugin.json")));
  assert.ok(existsSync(join(out, ".claude-plugin/marketplace.json")));
  assert.ok(existsSync(join(out, "hooks/hooks.json")));
  assert.ok(existsSync(join(out, "hooks/activate.js")));
  assert.ok(existsSync(join(out, "hooks/posttooluse.js")), "G7 PostToolUse redaction hook");
  assert.ok(existsSync(join(out, "hooks/secret-scan-core.js")), "G7 shared secret-scan core");
  assert.match(readFileSync(join(out, "hooks/hooks.json"), "utf8"), /PostToolUse[\s\S]*posttooluse\.js/, "hooks.json wires PostToolUse → posttooluse.js");
  assert.ok(existsSync(join(out, "rules/operating-rules.md")));
  // 골든과 **독립**인 축(fresh build를 직접 본다). golden↔dist 대조만 남으면, 복사 목록에서 파일이
  // 빠졌을 때 문서화된 절차대로 골든을 재생성하는 순간 경보가 같이 사라진다 — 게이트 에이전트가
  // 통째로 빠진 배포물도 전 테스트 초록이 된다(v0.49.0 pr-reviewer medium).
  for (const a of ["plan-validator", "pr-reviewer", "code-implementer"])
    assert.ok(existsSync(join(out, "agents", a + ".md")), "게이트/일꾼 에이전트 누락: " + a);
  assert.ok(existsSync(join(out, "hooks/finish-work.js")), "Stop 훅 누락");
  assert.ok(existsSync(join(out, "hooks/pretooluse.js")), "PreToolUse 하드블록 누락");
  for (const s of ["referencing", "product-map", "design-system", "monitoring", "security-scan"])
    assert.ok(existsSync(join(out, "skills", s, "SKILL.md")), s);
  assert.ok(existsSync(join(out, "skills/retrospect/SKILL.md")));
  assert.ok(existsSync(join(out, "skills/retrospect/retrospect-scan.mjs")));
  // 스킬이 본문에서 부르는 스크립트는 빌드가 함께 옮겨야 한다(안 옮기면 스킬이 없는 파일을 부른다).
  assert.ok(existsSync(join(out, "skills/product-map/table-to-yaml.mjs")));
  // hooks.json은 Claude env var를 그대로 유지
  assert.match(readFileSync(join(out, "hooks/hooks.json"), "utf8"), /CLAUDE_PLUGIN_ROOT/);
});
