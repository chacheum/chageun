import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse.js");

// 훅을 자식 프로세스로 실행하고 {code, stdout, stderr} 반환.
function runHook(input, env = {}) {
  try {
    const stdout = execFileSync("node", [HOOK], {
      input: JSON.stringify(input),
      env: Object.assign({}, process.env, { CHAGEUN_METRICS_DIR: mkdtempSync(join(tmpdir(), "m-")) }, env),
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

function metricsRows(dir) {
  const f = readdirSync(dir).find((n) => n.endsWith(".jsonl"));
  if (!f) return [];
  return readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── 행동 불변(계측이 판정을 바꾸지 않는다) ──────────────────────────────
test("차단 명령은 계측 켜져도 여전히 exit 2 + stderr 사유", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "git push --force origin main" } });
  assert.equal(r.code, 2, "차단은 exit 2 유지");
  assert.ok(r.stderr.length > 0, "stderr 사유 유지");
});

test("안전 명령은 계측 켜져도 여전히 exit 0 + stdout 없음", () => {
  const r = runHook({ tool_name: "Read", tool_input: { file_path: "/tmp/x" } });
  assert.equal(r.code, 0, "통과는 exit 0 유지");
  assert.equal(r.stdout, "", "통과 시 stdout 불변(빈 값)");
});

test("계측 디렉토리가 불량이어도 차단 판정 불변(log 부르는 경로에서 out-of-band 증명)", () => {
  // 통과 경로는 log()를 안 부르므로 out-of-band를 증명 못 한다 → 차단 경로(log 호출됨)로 검증.
  // 불량 metrics dir이라 log가 내부에서 mkdir/append에 실패(ENOTDIR)해도 여전히 exit 2 + stderr 유지여야 한다.
  // 불량 경로는 '파일 하위'로 만든다(mkdirSync가 ENOTDIR로 즉시 throw). /proc 류 경로는 일부 커널에서
  // mkdirSync가 hang하므로 쓰지 않는다(throw는 log의 try/catch가 잡지만 hang은 못 잡음).
  const base = mkdtempSync(join(tmpdir(), "bad-"));
  const asFile = join(base, "file");
  writeFileSync(asFile, "x");
  const r = runHook({ tool_name: "Bash", tool_input: { command: "git push --force origin main" } },
    { CHAGEUN_METRICS_DIR: join(asFile, "sub") });
  assert.equal(r.code, 2, "계측 실패해도 차단 exit 2 유지");
  assert.ok(r.stderr.length > 0, "계측 실패해도 stderr 사유 유지");
});

// ── 로그가 실제로 남는다 ────────────────────────────────────────────
test("차단 시 hook_block 이벤트가 기록된다", () => {
  const dir = mkdtempSync(join(tmpdir(), "m-"));
  const root = mkdtempSync(join(tmpdir(), "root-"));
  try {
    execFileSync("node", [HOOK], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" }, session_id: "sid9" }),
      env: Object.assign({}, process.env, { CHAGEUN_METRICS_DIR: dir, CHAGEUN_UNATTENDED: "1", CHAGEUN_UNATTENDED_TOKEN: "", CHAGEUN_ROOT: root }),
      encoding: "utf8",
    });
  } catch (_) { /* exit 2 예상 */ }
  const rows = metricsRows(dir);
  const blk = rows.find((r) => r.ev === "hook_block");
  assert.ok(blk, "hook_block 기록됨");
  assert.equal(blk.sid, "sid9");
  assert.ok(blk.reason, "reason 존재");
});

test("ALLOW_DEPLOY로 배포 통과 시 escape_used 기록", () => {
  // NOTE: base DEPLOY 정규식(pretooluse-core.js line 17)은 vercel/netlify를 --prod가 붙어야만 잡고,
  // npm/yarn/pnpm publish는 그대로 잡는다. 통과(escape)를 유발하려면 실제 매칭되는 명령을 써야 한다.
  const dir = mkdtempSync(join(tmpdir(), "m-"));
  execFileSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm publish" }, session_id: "sid8" }),
    env: Object.assign({}, process.env, { CHAGEUN_METRICS_DIR: dir, CHAGEUN_ALLOW_DEPLOY: "1" }),
    encoding: "utf8",
  });
  const esc = metricsRows(dir).find((r) => r.ev === "escape_used");
  assert.ok(esc, "escape_used 기록됨");
  assert.equal(esc.hatch, "ALLOW_DEPLOY");
});
