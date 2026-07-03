import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "finish-work.js");
const { extractGates, sumUsage } = require(HOOK);

// ── 순수함수: extractGates / sumUsage ──────────────────────────────
const gateCall = (id, sub) => ({ message: { role: "assistant", content: [{ type: "tool_use", id, name: "Task", input: { subagent_type: sub } }] } });
const gateResult = (id, text) => ({ message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } });

test("extractGates: pr-reviewer APPROVE 추출(최종 권고 줄 앵커)", () => {
  const objs = [gateCall("t1", "chageun:pr-reviewer"), gateResult("t1", "...\nPR 권고: APPROVE")];
  assert.deepEqual(extractGates(objs), [{ tuid: "t1", agent: "pr-reviewer", verdict: "APPROVE" }]);
});

test("extractGates: pr-reviewer REQUEST CHANGES / BLOCK 실제 어휘", () => {
  const rc = [gateCall("r1", "pr-reviewer"), gateResult("r1", "본문...\n**PR 권고: REQUEST CHANGES**")];
  assert.equal(extractGates(rc)[0].verdict, "REQUEST_CHANGES");
  const bl = [gateCall("r2", "pr-reviewer"), gateResult("r2", "blocker 있음\n\nPR 권고: BLOCK")];
  assert.equal(extractGates(bl)[0].verdict, "BLOCK");
});

test("extractGates: 본문에 APPROVE가 섞여도 최종 권고가 BLOCK이면 BLOCK(오탐 방지)", () => {
  // 옛 전체-blob 스캔이면 본문의 "APPROVE" 때문에 APPROVE로 역전됐다 → 앵커로 방지.
  const objs = [gateCall("t9", "pr-reviewer"),
    gateResult("t9", "다른 부분은 APPROVE할 만하나 보안 blocker가 있습니다.\n\nPR 권고: BLOCK")];
  assert.equal(extractGates(objs)[0].verdict, "BLOCK");
});

test("extractGates: plan-validator는 NO-GO를 GO보다 우선 매칭(앵커 줄)", () => {
  const objs = [gateCall("t2", "plan-validator"), gateResult("t2", "이유는 GO 조건 미충족\n\n진행 권고: NO-GO")];
  assert.equal(extractGates(objs)[0].verdict, "NO-GO");
});

test("extractGates: plan-validator CONDITIONAL", () => {
  const objs = [gateCall("t5", "plan-validator"), gateResult("t5", "```\n진행 권고: CONDITIONAL\n```")];
  assert.equal(extractGates(objs)[0].verdict, "CONDITIONAL");
});

test("extractGates: 게이트가 아닌 Task는 무시", () => {
  const objs = [gateCall("t3", "general-purpose"), gateResult("t3", "PR 권고: APPROVE")];
  assert.deepEqual(extractGates(objs), []);
});

test("extractGates: 최종 권고 줄이 없으면 unknown(거짓양성 회피)", () => {
  const objs = [gateCall("t4", "pr-reviewer"), gateResult("t4", "리뷰 진행 중... APPROVE 어휘가 본문에 있어도")];
  assert.equal(extractGates(objs)[0].verdict, "unknown");
});

test("sumUsage: assistant usage 합산", () => {
  const objs = [
    { message: { role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } } },
    { message: { role: "assistant", content: [], usage: { input_tokens: 20, output_tokens: 7 } } },
  ];
  assert.deepEqual(sumUsage(objs), { input: 30, output: 12, cache_read: 2, cache_creation: 0 });
});

// ── e2e: run()이 계측 배선 후에도 판정을 안 바꾼다 ──────────────────────
function runFinish(lines, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fw-"));
  const tpath = join(dir, "t.jsonl");
  writeFileSync(tpath, lines.map((o) => JSON.stringify(o)).join("\n"));
  const input = JSON.stringify({ transcript_path: tpath, session_id: "sidfw" });
  try {
    const stdout = execFileSync("node", [HOOK], {
      input, encoding: "utf8",
      env: Object.assign({}, process.env, { CHAGEUN_METRICS_DIR: mkdtempSync(join(tmpdir(), "m-")) }, env),
    });
    return { code: 0, stdout };
  } catch (e) { return { code: e.status, stdout: e.stdout || "" }; }
}

// 불량 metrics dir을 '파일 하위'로 만든다(mkdirSync가 ENOTDIR로 즉시 throw; /proc 류는 hang 위험).
function badMetricsDir() {
  const base = mkdtempSync(join(tmpdir(), "bad-"));
  const asFile = join(base, "file");
  writeFileSync(asFile, "x");
  return join(asFile, "sub");
}

const A = (t) => ({ message: { role: "assistant", content: [{ type: "text", text: t }] } });

test("e2e: 약속만 하고 끝난 응답은 계측 켜져도 block 판정 유지", () => {
  const r = runFinish([A("이제 로그인 폼을 구현하겠습니다.")]);
  assert.match(r.stdout, /"decision":"block"/, "block 판정 stdout 유지");
});

test("e2e: 정상 마무리는 계측 켜져도 통과(exit 0, stdout 없음)", () => {
  // 약속·실행주장 어휘가 없는 순수 요약 마무리(기존 로직상 통과) — 계측 후에도 통과여야.
  const r = runFinish([A("결과를 정리하면 다음과 같습니다: 파일 3개를 수정했습니다.")]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "", "통과 시 stdout 불변");
});

test("e2e: 계측 디렉토리 불량이어도 block 판정 불변(out-of-band)", () => {
  const r = runFinish([A("이제 수정하겠습니다.")], { CHAGEUN_METRICS_DIR: badMetricsDir() });
  assert.match(r.stdout, /"decision":"block"/, "계측 실패해도 block 판정 유지");
});
