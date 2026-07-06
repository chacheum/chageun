import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-codex.mjs");
const BASE = { ...process.env };
for (const k of Object.keys(BASE)) if (k.startsWith("CHAGEUN_")) delete BASE[k];
function run(input, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...BASE, ...env }, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

test("codex 하드블록: 위험 4종 → permissionDecision deny (exit 0)", () => {
  for (const cmd of ["git push --force origin main", "rm -rf ~", "vercel --prod"]) {
    const r = run(bash(cmd));
    assert.equal(r.code, 0, cmd);
    assert.match(r.out, /"permissionDecision":"deny"/, cmd);
    assert.match(r.out, /"hookEventName":"PreToolUse"/, cmd);
  }
  const sql = run({ tool_name: "mcp__plugin_supabase_supabase__execute_sql", tool_input: { query: "DROP TABLE users" } });
  assert.equal(sql.code, 0);
  assert.match(sql.out, /"permissionDecision":"deny"/);
});

test("codex 하드블록: 안전 입력·비대상 도구·깨진 stdin은 무출력 통과", () => {
  assert.equal(run(bash("git push origin main")).out, "");
  assert.equal(run({ tool_name: "Read", tool_input: { file_path: "/x" } }).out, "");
  const broken = run("{not json");
  assert.equal(broken.code, 0, "깨진 입력도 안전 통과(fail-open)");
  assert.equal(broken.out, "");
});

test("codex 하드블록: 배포 탈출구 CHAGEUN_ALLOW_DEPLOY=1 (Claude와 동일)", () => {
  assert.equal(run(bash("vercel --prod"), { CHAGEUN_ALLOW_DEPLOY: "1" }).out, "", "탈출구로 통과");
  const r = run(bash("git push --force origin main"), { CHAGEUN_ALLOW_DEPLOY: "1" });
  assert.match(r.out, /deny/, "탈출구는 deploy에만 — force push는 여전히 차단");
});

test("codex 배선: hooks-codex.json에 PreToolUse 추가 + 기존 훅 정의 불변(trust 재승인 방지)", () => {
  const j = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "hooks-codex.json"), "utf8"));
  const pre = j.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length === 1, "PreToolUse 배선 존재");
  assert.equal(pre[0].matcher, "Bash|mcp__.*");
  assert.match(pre[0].hooks[0].command, /pretooluse-codex\.mjs/);
  assert.equal(j.hooks.SessionStart[0].hooks[0].command, 'node "${PLUGIN_ROOT}/hooks/activate-codex.mjs"');
  assert.equal(j.hooks.SessionStart[0].matcher, "startup|resume|clear");
  assert.equal(j.hooks.Stop[0].hooks[0].command, 'node "${PLUGIN_ROOT}/hooks/finish-work-codex.mjs"');
  assert.equal(j.hooks.Stop[0].matcher, "");
});
