import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "src", "hooks", "activate-codex.mjs");

function ctx() {
  const out = execFileSync("node", [HOOK], { encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: join(ROOT, "src") } });
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

test("Codex 주입에 절차 본문이 인라인된다(procSkills 전부)", () => {
  const c = ctx();
  assert.match(c, /끝 점검 상세 절차/, "finish-check 본문");
  assert.match(c, /스펙 확인 게이트 상세/, "spec-gate 본문");
  assert.match(c, /실제 구동 검증 상세/, "run-verify 본문");
  assert.match(c, /모델·실행 라우팅 \(상세\)/, "routing 본문");
});

test("스킬 frontmatter(name/description)는 인라인에서 제거된다(전부)", () => {
  const c = ctx();
  assert.doesNotMatch(c, /^description:\s*기술 작업을 마칠 때/m, "finish-check frontmatter 새면 안 됨");
  assert.doesNotMatch(c, /^description:\s*브레인스토밍→스펙/m, "spec-gate frontmatter 새면 안 됨");
  assert.doesNotMatch(c, /^description:\s*화면·앱을 "다 됐다"/m, "run-verify frontmatter 새면 안 됨");
  assert.doesNotMatch(c, /^description:\s*모델·실행 라우팅 상세/m, "routing frontmatter 새면 안 됨");
});
