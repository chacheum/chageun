import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse.js");
// 부모 env의 CHAGEUN_* 제거 후 케이스별로 주입(격리).
const BASE = { ...process.env };
delete BASE.CHAGEUN_UNATTENDED; delete BASE.CHAGEUN_ALLOW_DEPLOY; delete BASE.CHAGEUN_SKIP_GATE_CHECK;

// 임시 작업트리에 유효 통과표를 심고 cwd·env를 맞춰 훅을 spawn. token=null이면 통과표 없음(게이트 테스트용).
function runIn(input, env, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "unatt-"));
  mkdirSync(join(dir, ".chageun"), { recursive: true });
  const nonce = opts.nonce === undefined ? "abc123" : opts.nonce;
  if (opts.writeToken !== false) writeFileSync(join(dir, ".chageun", "token"), JSON.stringify({ nonce }));
  if (opts.stop) writeFileSync(join(dir, ".chageun", "STOP"), "");
  if (opts.runtime) writeFileSync(join(dir, ".chageun", "runtime.json"), JSON.stringify(opts.runtime));
  if (opts.runtimeRaw !== undefined) writeFileSync(join(dir, ".chageun", "runtime.json"), opts.runtimeRaw);
  const fullEnv = { ...BASE, ...env };
  if (opts.tokenEnv !== null && (env.CHAGEUN_UNATTENDED === "1")) fullEnv.CHAGEUN_UNATTENDED_TOKEN = opts.tokenEnv || nonce;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: fullEnv, cwd: dir, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, stderr: r.stderr || "" };
}
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

test("무인: 평범한 git push 차단(유인은 통과)", () => {
  assert.equal(runIn(bash("git push origin main"), { CHAGEUN_UNATTENDED: "1" }).code, 2);
  assert.equal(runIn(bash("git push origin main"), {}).code, 0, "유인 모드 회귀: 평범한 push는 통과");
});

test("무인: 배포 탈출구(CHAGEUN_ALLOW_DEPLOY) 무시", () => {
  const r = runIn(bash("vercel --prod"), { CHAGEUN_UNATTENDED: "1", CHAGEUN_ALLOW_DEPLOY: "1" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /무인 모드 차단/);
  assert.equal(runIn(bash("vercel --prod"), { CHAGEUN_ALLOW_DEPLOY: "1" }).code, 0, "유인 회귀: 탈출구 있으면 통과");
});

test("무인: DB 쓰기 차단(무인 사유문)", () => {
  const r = runIn({ tool_name: "mcp__x_execute_sql", tool_input: { query: "INSERT INTO t VALUES(1)" } }, { CHAGEUN_UNATTENDED: "1" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /DB 쓰기/);
});

test("무인: PR 생성 차단", () => {
  assert.equal(runIn(bash("gh pr create --fill"), { CHAGEUN_UNATTENDED: "1" }).code, 2);
});

test("무인: 무관한 명령은 통과", () => {
  assert.equal(runIn(bash("npm test"), { CHAGEUN_UNATTENDED: "1" }).code, 0);
});

test("무인: 판정 중 예외는 fail-closed(park), 유인은 fail-open 불변", () => {
  assert.equal(runIn({ tool_name: "Write", tool_input: { file_path: 12345 } }, { CHAGEUN_UNATTENDED: "1" }).code, 2, "무인: 예외 시 차단");
  assert.equal(runIn({ tool_name: "Write", tool_input: { file_path: 12345 } }, {}).code, 0, "유인: 예외 시 기존대로 통과");
});

test("무인 게이트: 통과표 없으면 모든 도구 park(게을러도 안전)", () => {
  // 통과표 파일 없음
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { writeToken: false }).code, 2);
  // 통과표 파일은 있으나 env nonce 불일치
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { nonce: "aaa", tokenEnv: "bbb" }).code, 2);
  // 통과표 있고 무해한 명령 → 통과
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }).code, 0);
  // 유인은 통과표 무관하게 통과
  assert.equal(runIn(bash("ls"), {}, { writeToken: false }).code, 0);
});

test("무인 게이트: .chageun/STOP 있으면 모든 도구 park", () => {
  const r = runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { stop: true });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /정지/);
});
test("STOP/통과표는 CHAGEUN_ROOT에 고정 — cwd가 딴 폴더여도 확실히 멈춘다", () => {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  mkdirSync(join(root, ".chageun"), { recursive: true });
  writeFileSync(join(root, ".chageun", "token"), JSON.stringify({ nonce: "n1" }));
  const sub = join(root, "deep", "sub");
  mkdirSync(sub, { recursive: true });
  const env = { ...BASE, CHAGEUN_UNATTENDED: "1", CHAGEUN_UNATTENDED_TOKEN: "n1", CHAGEUN_ROOT: root };
  const spawn = () => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(bash("ls")), env, cwd: sub, encoding: "utf8" });
  // (1) cwd에 .chageun이 없어도 CHAGEUN_ROOT의 통과표로 정상 통과
  assert.equal(spawn().status, 0, "루트 통과표를 cwd 밖(하위폴더)에서도 인식");
  // (2) 사람이 루트에 STOP을 두면 cwd가 딴 폴더여도 멈춘다
  writeFileSync(join(root, ".chageun", "STOP"), "");
  const r = spawn();
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr || "", /정지/);
});

test("STOP: CHAGEUN_ROOT 없으면 상위 폴더로 .chageun을 찾아 멈춘다(find-up 안전망)", () => {
  const root = mkdtempSync(join(tmpdir(), "root2-"));
  mkdirSync(join(root, ".chageun"), { recursive: true });
  writeFileSync(join(root, ".chageun", "token"), JSON.stringify({ nonce: "n2" }));
  writeFileSync(join(root, ".chageun", "STOP"), "");
  const sub = join(root, "a", "b");
  mkdirSync(sub, { recursive: true });
  const env = { ...BASE, CHAGEUN_UNATTENDED: "1", CHAGEUN_UNATTENDED_TOKEN: "n2" }; // CHAGEUN_ROOT 없음
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(bash("ls")), env, cwd: sub, encoding: "utf8" });
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr || "", /정지/);
});

test("PreToolUse matcher가 MultiEdit 등 편집 도구 포함(훅 우회 방지)", () => {
  const cfg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "hooks.claude.json"), "utf8"));
  const m = cfg.hooks.PreToolUse[0].matcher;
  for (const t of ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "execute_sql", "apply_migration"]) assert.ok(m.includes(t), `matcher에 ${t} 포함`);
});

test("무인 예산: 시간/횟수 초과 시 park, 정상은 통과", () => {
  const now = Date.now();
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { runtime: { startedAt: now - 9 * 3600e3, calls: 5, lastProgressAt: now } }).code, 2);
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { runtime: { startedAt: now, calls: 2000, lastProgressAt: now } }).code, 2);
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { runtime: { startedAt: now, calls: 1, lastProgressAt: now } }).code, 0);
});

test("무인 워치독: 30분 무진전 park, 단 이번이 commit이면 통과", () => {
  const now = Date.now();
  const stale = { startedAt: now - 60e3, calls: 5, lastProgressAt: now - 31 * 60e3 };
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { runtime: stale }).code, 2);
  assert.equal(runIn(bash('git commit -m x'), { CHAGEUN_UNATTENDED: "1" }, { runtime: stale }).code, 0);
});

test("유인 회귀: 예산 상태가 있어도 유인은 영향 없음", () => {
  const now = Date.now();
  assert.equal(runIn(bash("ls"), {}, { runtime: { startedAt: now - 9 * 3600e3, calls: 9999, lastProgressAt: now - 9 * 3600e3 } }).code, 0);
});

test("무인 예산: runtime.json이 있는데 손상(파싱 실패)이면 리셋 말고 park", () => {
  assert.equal(runIn(bash("ls"), { CHAGEUN_UNATTENDED: "1" }, { runtimeRaw: "{broken" }).code, 2);
});
