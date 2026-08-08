// v0.53.0 계획 규모 가드 — **행동층**. 훅을 통째로 돌려 exit code 를 잰다.
// 순수 함수 테스트는 배선을 안 본다: require 목록에서 함수를 빠뜨리면 가드가 조용히 꺼지는데
// 단위 테스트는 전부 초록이다(3회차 게이트 blocker). 이 파일이 그 자리를 덮는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse.js");
// 부모의 CHAGEUN_* 를 씻는다 — 무인 플래그가 켜진 셸에서 결과가 달라지면 안 된다
// (기존 하네스 test/pretooluse-unattended.test.mjs 와 같은 방식).
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHAGEUN_")));
const runHook = (payload, extraEnv) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify(payload), encoding: "utf8", env: { ...CLEAN, ...(extraEnv || {}) },
});

const DIR = mkdtempSync(join(tmpdir(), "chageun-plan-"));
mkdirSync(join(DIR, "docs", "plans"), { recursive: true });
writeFileSync(join(DIR, "docs/plans/big.md"), "a\n".repeat(4020));
writeFileSync(join(DIR, "docs/plans/small.md"), "b\n".repeat(1785));
process.on("exit", () => { try { rmSync(DIR, { recursive: true, force: true }); } catch (_) {} });

const gateCall = (prompt) => ({
  tool_name: "Task", cwd: DIR,
  tool_input: { subagent_type: "plan-validator", prompt },
});

test("큰 계획이면 exit 2 로 막고 승인 키를 화면에 찍는다", () => {
  const r = runHook(gateCall("계획서: docs/plans/big.md"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /계획서가 너무 큽니다/);
  assert.match(r.stderr, /\[chageun-big-plan:big\.md:4k\]/);
});

test("상한 아래 계획은 exit 0 으로 통과한다", () => {
  assert.equal(runHook(gateCall("계획서: docs/plans/small.md")).status, 0);
});

// 이 테스트가 3회차 게이트의 blocker 2건(배선 미정의 · 승인 키 계약 불일치)을 동시에 덮는다.
test("승인이 기록돼 있으면 exit 0 으로 통과한다", () => {
  const key = "[chageun-big-plan:big.md:4k]";
  const question = `계획이 큽니다 ${key}`;
  const records = [
    { message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion",
      input: { questions: [{ question, multiSelect: false,
        options: [{ label: "쪼갠다" }, { label: "이 크기로 진행" }] }] } }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false,
      content: `${JSON.stringify(question)}=${JSON.stringify("이 크기로 진행")}` }] } },
  ];
  const tp = join(DIR, "approved.jsonl");
  writeFileSync(tp, records.map((o) => JSON.stringify(o)).join("\n"));
  const r = runHook({ ...gateCall("계획서: docs/plans/big.md"), transcript_path: tp });
  assert.equal(r.status, 0);
});

test("다른 크기의 승인은 안 통한다(유효 범위가 행동층에서도 산다)", () => {
  const key = "[chageun-big-plan:big.md:9k]";      // 실제 측정은 4k
  const question = `계획이 큽니다 ${key}`;
  const records = [
    { message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion",
      input: { questions: [{ question, multiSelect: false,
        options: [{ label: "쪼갠다" }, { label: "이 크기로 진행" }] }] } }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false,
      content: `${JSON.stringify(question)}=${JSON.stringify("이 크기로 진행")}` }] } },
  ];
  const tp = join(DIR, "stale.jsonl");
  writeFileSync(tp, records.map((o) => JSON.stringify(o)).join("\n"));
  assert.equal(runHook({ ...gateCall("계획서: docs/plans/big.md"), transcript_path: tp }).status, 2);
});

test("무인 모드는 승인 통로를 무시하고 park 한다", () => {
  // 무인은 preflight 통과표가 먼저 걸리므로(§0 fail-closed) 여기까지 오려면 통과표를 만들어 준다.
  mkdirSync(join(DIR, ".chageun"), { recursive: true });
  writeFileSync(join(DIR, ".chageun", "token"), JSON.stringify({ nonce: "t-plan-scale" }));
  const key = "[chageun-big-plan:big.md:4k]";
  const question = `계획이 큽니다 ${key}`;
  const records = [
    { message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion",
      input: { questions: [{ question, multiSelect: false,
        options: [{ label: "쪼갠다" }, { label: "이 크기로 진행" }] }] } }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false,
      content: `${JSON.stringify(question)}=${JSON.stringify("이 크기로 진행")}` }] } },
  ];
  const tp = join(DIR, "unattended.jsonl");
  writeFileSync(tp, records.map((o) => JSON.stringify(o)).join("\n"));
  // 승인이 **있는데도** 막혀야 한다 — 사람이 승인할 수 없는 자리에서 큰 계획을 통과시키지 않는다.
  const r = runHook({ ...gateCall("계획서: docs/plans/big.md"), transcript_path: tp },
    { CHAGEUN_UNATTENDED: "1", CHAGEUN_UNATTENDED_TOKEN: "t-plan-scale", CHAGEUN_ROOT: DIR });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /무인 차단/);
});

// 5회차 medium: `humanCanApprove = !UNATTENDED && !IS_SUBAGENT` 의 서브에이전트 갈래에 테스트가
//   하나도 없었다. 두 조건이 AND 라 **무인 테스트는 이 값을 어느 쪽으로 바꿔도 통과한다** — 즉
//   누가 `!IS_SUBAGENT` 를 지워도 432개가 전부 초록이고, 2회차 high(켤 수 없는 스위치를 안내)가
//   조용히 되살아난다.
test("서브에이전트에는 사람만 쓸 수 있는 승인 키·형식 안내를 안 붙인다", () => {
  const r = runHook({ ...gateCall("계획서: docs/plans/big.md"), agent_type: "chageun:code-implementer" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /서브에이전트는 이 승인을 받을 수 없습니다/);
  assert.doesNotMatch(r.stderr, /\[chageun-big-plan:/);
  assert.doesNotMatch(r.stderr, /형식 요건/);
});

test("게이트가 아닌 에이전트 호출은 안 막는다", () => {
  const r = runHook({ tool_name: "Task", cwd: DIR,
    tool_input: { subagent_type: "general-purpose", prompt: "계획서: docs/plans/big.md" } });
  assert.equal(r.status, 0);
});

test("승인 질문은 있는데 형식이 어긋나면 그 사실을 알려준다", () => {
  const key = "[chageun-big-plan:big.md:4k]";
  const question = `계획이 큽니다 ${key}`;
  // 선택지 3개 = 형식 위반. 질문은 찾히지만 승인으로 인정되지 않아야 한다.
  const records = [{ message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion",
    input: { questions: [{ question, multiSelect: false,
      options: [{ label: "a" }, { label: "b" }, { label: "c" }] }] } }] } }];
  const tp = join(DIR, "malformed.jsonl");
  writeFileSync(tp, records.map((o) => JSON.stringify(o)).join("\n"));
  const r = runHook({ ...gateCall("계획서: docs/plans/big.md"), transcript_path: tp });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /형식이 안 맞아 인정되지 않았습니다/);
});

test("한글 폴더 이름이 앞에 와도 검사 대상이다", () => {
  mkdirSync(join(DIR, "프로젝트문서", "plans"), { recursive: true });
  writeFileSync(join(DIR, "프로젝트문서/plans/한글계획.md"), "a\n".repeat(4020));
  const r = runHook(gateCall("계획서: 프로젝트문서/plans/한글계획.md 검증"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /계획서가 너무 큽니다/);
});

// 3회차 medium: "벗겨서 절대경로가 되면 버린다" 규칙이 굵게 쓴 절대경로를 통째로 놓쳤다.
//   한글 경로와 이 경로가 **동시에** 잡혀야 한다 — 한쪽을 고치다 다른 쪽을 깨뜨린 게 이 결함의 이력이다.
test("굵게 표시한 절대경로도 검사 대상이다", () => {
  const abs = join(DIR, "docs/plans/big.md");
  const r = runHook({ tool_name: "Task", cwd: DIR,
    tool_input: { subagent_type: "plan-validator", prompt: `계획서: **${abs}** 를 검증해줘` } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /계획서가 너무 큽니다/);
});

test("사용자가 두 번째를 안 눌렀으면 형식 오류라고 말하지 않는다", () => {
  const key = "[chageun-big-plan:big.md:4k]";
  const question = `계획이 큽니다 ${key}`;
  // 형식은 완벽한데 응답이 없다(= 거절했거나 아직 안 답함).
  const records = [{ message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion",
    input: { questions: [{ question, multiSelect: false,
      options: [{ label: "쪼갠다" }, { label: "이 크기로 진행" }] }] } }] } }];
  const tp = join(DIR, "unanswered.jsonl");
  writeFileSync(tp, records.map((o) => JSON.stringify(o)).join("\n"));
  const r = runHook({ ...gateCall("계획서: docs/plans/big.md"), transcript_path: tp });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /두 번째 선택지가 눌리지 않았습니다/);
  assert.doesNotMatch(r.stderr, /형식이 안 맞아 인정되지 않았습니다/);
});

// 회차 축은 **만들지 않기로 확정됐다**(2026-08-09) — 실측에서 회차 수가 잘 끝난 작업과 안 끝난
//   작업을 못 갈랐다. 8회·11회차에서**야** blocker 0 에 처음 닿고 **그 회차에 실제 결함을 잡은**
//   계획들이 있어, 문턱을 더 높여도 늦은 회차의 생산적인 검증을 함께 막는다. 회차 표기가 있어도
//   크기만으로 판정해야 한다. 사유 전문 = docs/plans/2026-08-08-plan-rounds-guard-plan.md 머리
//   (docs/ 는 공개 저장소에 안 올라가는 비공개 문서다).
test("회차 표기가 있어도 크기가 상한 아래면 통과한다", () => {
  const r = runHook(gateCall("재검증 회차: 9\n계획서: docs/plans/small.md"));
  assert.equal(r.status, 0);
  // exit code 만 보면 "막지는 않고 경고만 하는" 회차 축이 들어와도 초록이다.
  assert.doesNotMatch(r.stderr, /회차/);
});

// 기각된 1차안은 회차를 **계획서 머리**에서 읽었다. 프롬프트 표기만 검사하면 그 갈래가 되살아나도
//   테스트가 안 잡는다.
test("계획서 머리에 회차 표기가 있어도 크기만으로 판정한다", () => {
  writeFileSync(join(DIR, "docs/plans/marked.md"), "재검증 회차: 9\n" + "b\n".repeat(1785));
  const r = runHook(gateCall("계획서: docs/plans/marked.md"));
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /회차/);
});
