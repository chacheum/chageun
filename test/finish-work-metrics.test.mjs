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
const { extractGates, sumUsage, extractSkillLoads } = require(HOOK);

// ── 순수함수: extractSkillLoads (지연로드 절차 스킬 발동 여부) ──────────
const skillCall = (name) => ({ message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: name } }] } });

test("extractSkillLoads: finish-check 스킬 로드 감지", () => {
  const r = extractSkillLoads([skillCall("chageun:finish-check")]);
  assert.equal(r.finishCheck, true);
  assert.equal(r.specGate, false);
  assert.equal(r.runVerify, false);
});
test("extractSkillLoads: run-verify + spec-gate 동시", () => {
  const r = extractSkillLoads([skillCall("chageun:run-verify"), skillCall("spec-gate")]);
  assert.equal(r.runVerify, true);
  assert.equal(r.specGate, true);
  assert.equal(r.finishCheck, false);
});
test("extractSkillLoads: 무관 스킬은 false", () => {
  assert.deepEqual(extractSkillLoads([skillCall("design-system")]),
    { finishCheck: false, specGate: false, runVerify: false, edited: false, uiEdited: false, planned: false });
});

// ── 미발동 분모 신호: edited / uiEdited / planned ──────────────────────
const editCall = (name, fp) => ({ message: { role: "assistant", content: [{ type: "tool_use", name, input: { file_path: fp } }] } });

test("extractSkillLoads: 파일 편집이 있으면 edited=true(비-UI는 uiEdited=false)", () => {
  const r = extractSkillLoads([editCall("Edit", "src/lib/util.js")]);
  assert.equal(r.edited, true);
  assert.equal(r.uiEdited, false);
});
test("extractSkillLoads: UI 파일 편집이면 uiEdited=true(finish-check/run-verify 분모)", () => {
  const r = extractSkillLoads([editCall("Write", "src/pages/Login.tsx")]);
  assert.equal(r.edited, true);
  assert.equal(r.uiEdited, true);
});
test("extractSkillLoads: brainstorming/writing-plans면 planned=true(spec-gate 분모)", () => {
  assert.equal(extractSkillLoads([skillCall("superpowers:brainstorming")]).planned, true);
  assert.equal(extractSkillLoads([skillCall("superpowers:writing-plans")]).planned, true);
  assert.equal(extractSkillLoads([skillCall("design-system")]).planned, false);
});

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

test("extractGates: 앵커 window에 BLOCK+REQUEST CHANGES 공존 시 더 심각한 BLOCK(순서 버그 회귀)", () => {
  const objs = [gateCall("bx", "pr-reviewer"),
    gateResult("bx", "...\nPR 권고: BLOCK — REQUEST CHANGES가 아니라 BLOCK입니다")];
  assert.equal(extractGates(objs)[0].verdict, "BLOCK");
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

test("verdictOf: '최종 권고:' 앵커도 인식(일부 에이전트 표기 변종)", () => {
  const objs = [gateCall("tf", "plan-validator"), gateResult("tf", "요약...\n최종 권고: GO")];
  assert.equal(extractGates(objs)[0].verdict, "GO");
});

// ── 백그라운드 게이트: tool_result는 스텁, 실제 판정은 <task-notification>에 ──────
const bgStub = (id) => ({ message: { role: "user", content: [{ type: "tool_result", tool_use_id: id,
  content: "Agent started (agentId: x). The agent is working in the background. You will be notified automatically when it completes." }] } });
const notif = (tuid, result) => ({ type: "user", message: { role: "user",
  content: `<task-notification>\n<task-id>abc</task-id>\n<tool-use-id>${tuid}</tool-use-id>\n<status>completed</status>\n<result>${result}</result>\n</task-notification>` } });

test("extractGates: 백그라운드 스텁 tool_result면 task-notification 조인으로 판정 복원", () => {
  const objs = [gateCall("bg1", "chageun:pr-reviewer"), bgStub("bg1"), notif("bg1", "리뷰 완료.\n\nPR 권고: APPROVE")];
  assert.deepEqual(extractGates(objs), [{ tuid: "bg1", agent: "pr-reviewer", verdict: "APPROVE" }]);
});

test("extractGates: 같은 task-id 다중 통지면 판정 잡히는(비-unknown) 통지 우선", () => {
  // 첫 통지엔 권고 줄 없음(unknown), 둘째 통지에 최종 권고 → GO를 취해야.
  const objs = [gateCall("bg2", "plan-validator"), bgStub("bg2"),
    notif("bg2", "중간 경과 보고. 아직 조사 중."), notif("bg2", "검증 완료.\n\n진행 권고: GO")];
  assert.equal(extractGates(objs)[0].verdict, "GO");
});

test("extractGates: 포그라운드(tool_result에 판정 있음)는 통지 없이도 그대로", () => {
  const objs = [gateCall("fg1", "pr-reviewer"), gateResult("fg1", "본문\n\nPR 권고: BLOCK")];
  assert.equal(extractGates(objs)[0].verdict, "BLOCK");
});

test("extractGates: 게이트 아닌 Task의 완료 통지는 판정으로 새지 않음(idToAgent 필터)", () => {
  // code-implementer 통지에 'PR 권고: APPROVE'가 있어도 게이트가 아니므로 목록에 안 나타나야.
  const objs = [gateCall("ci1", "chageun:code-implementer"), bgStub("ci1"),
    notif("ci1", "구현 완료.\n\nPR 권고: APPROVE")];
  assert.deepEqual(extractGates(objs), []);
});

test("sumUsage: id 없는 usage는 그대로 합산(기존 동작)", () => {
  const objs = [
    { message: { role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } } },
    { message: { role: "assistant", content: [], usage: { input_tokens: 20, output_tokens: 7 } } },
  ];
  assert.deepEqual(sumUsage(objs), { input: 30, output: 12, cache_read: 2, cache_creation: 0 });
});

test("sumUsage: 같은 message.id 스트리밍 부분값은 id별 최댓값만(과대집계 방지)", () => {
  // 같은 id가 [부분, 부분, 최종]으로 3줄 → 최종값 하나만 반영돼야(단순 합산=605, dedup=200).
  const stream = (out, inp) => ({ message: { role: "assistant", id: "msg_1", content: [], usage: { input_tokens: inp, output_tokens: out } } });
  const other = { message: { role: "assistant", id: "msg_2", content: [], usage: { input_tokens: 50, output_tokens: 100 } } };
  const objs = [stream(8, 300), stream(8, 300), stream(200, 300), other];
  // msg_1: output max=200, input max=300 · msg_2: output 100, input 50
  assert.deepEqual(sumUsage(objs), { input: 350, output: 300, cache_read: 0, cache_creation: 0 });
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
