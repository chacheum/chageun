import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const C = join(ROOT, "dist/claude"), X = join(ROOT, "dist/codex");
before(() => execFileSync("node", ["build/build.mjs"], { cwd: ROOT }));

const SKILLS = ["referencing","product-map","design-system","monitoring","security-scan"];

test("스킬 5종은 두 플랫폼에 동일 경로·동일 내용", () => {
  for (const s of SKILLS) {
    const rc = join("skills", s, "SKILL.md");
    assert.ok(existsSync(join(C, rc)) && existsSync(join(X, rc)), s);
    assert.equal(readFileSync(join(C, rc), "utf8"), readFileSync(join(X, rc), "utf8"), s);
  }
});
test("operating-rules는 두 플랫폼 공유(내용 동일)", () => {
  assert.equal(readFileSync(join(C,"rules/operating-rules.md"),"utf8"), readFileSync(join(X,"rules/operating-rules.md"),"utf8"));
});
test("플랫폼별 매니페스트·훅·게이트 산출물 존재", () => {
  // Claude platform
  assert.ok(existsSync(join(C,".claude-plugin/plugin.json")), ".claude-plugin/plugin.json");
  assert.ok(existsSync(join(C,"hooks/hooks.json")), "hooks/hooks.json");
  assert.ok(existsSync(join(C,"hooks/finish-work.js")), "hooks/finish-work.js");
  assert.ok(existsSync(join(C,"agents/plan-validator.md")), "agents/plan-validator.md");
  // Codex platform
  assert.ok(existsSync(join(X,".codex-plugin/plugin.json")), ".codex-plugin/plugin.json");
  assert.ok(existsSync(join(X,"hooks/hooks-codex.json")), "hooks/hooks-codex.json");
  assert.ok(existsSync(join(X,"hooks/finish-work-codex.mjs")), "hooks/finish-work-codex.mjs");
  assert.ok(existsSync(join(X,"codex/gate-agents.md")), "codex/gate-agents.md");
});
test("dependencies: claude 있음 / codex 없음", () => {
  const cj = JSON.parse(readFileSync(join(C,".claude-plugin/plugin.json"),"utf8"));
  const xj = JSON.parse(readFileSync(join(X,".codex-plugin/plugin.json"),"utf8"));
  assert.ok(Array.isArray(cj.dependencies) && cj.dependencies[0].name === "superpowers");
  assert.ok(!("dependencies" in xj));
});
test("codex plugin.json의 skills/hooks 포인터가 실제 파일/디렉터리를 가리킨다", () => {
  const xj = JSON.parse(readFileSync(join(X,".codex-plugin/plugin.json"),"utf8"));
  assert.ok(existsSync(join(X, xj.skills.replace(/^\.\//,""))));
  assert.ok(existsSync(join(X, xj.hooks.replace(/^\.\//,""))));
});
