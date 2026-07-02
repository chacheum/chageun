import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse.js");
// 부모 env의 CHAGEUN_* 제거 후 케이스별로 주입(격리).
const BASE = { ...process.env };
delete BASE.CHAGEUN_UNATTENDED; delete BASE.CHAGEUN_ALLOW_DEPLOY; delete BASE.CHAGEUN_SKIP_GATE_CHECK;
function run(input, env) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...BASE, ...env }, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr || "" };
}
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

test("무인: 평범한 git push 차단(유인은 통과)", () => {
  assert.equal(run(bash("git push origin main"), { CHAGEUN_UNATTENDED: "1" }).code, 2);
  assert.equal(run(bash("git push origin main"), {}).code, 0, "유인 모드 회귀: 평범한 push는 통과");
});

test("무인: 배포 탈출구(CHAGEUN_ALLOW_DEPLOY) 무시", () => {
  const r = run(bash("vercel --prod"), { CHAGEUN_UNATTENDED: "1", CHAGEUN_ALLOW_DEPLOY: "1" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /무인 모드 차단/);
  assert.equal(run(bash("vercel --prod"), { CHAGEUN_ALLOW_DEPLOY: "1" }).code, 0, "유인 회귀: 탈출구 있으면 통과");
});

test("무인: DB 쓰기 차단(무인 사유문)", () => {
  const r = run({ tool_name: "mcp__x_execute_sql", tool_input: { query: "INSERT INTO t VALUES(1)" } }, { CHAGEUN_UNATTENDED: "1" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /DB 쓰기/);
});

test("무인: PR 생성 차단", () => {
  assert.equal(run(bash("gh pr create --fill"), { CHAGEUN_UNATTENDED: "1" }).code, 2);
});

test("무인: 무관한 명령은 통과", () => {
  assert.equal(run(bash("npm test"), { CHAGEUN_UNATTENDED: "1" }).code, 0);
});
