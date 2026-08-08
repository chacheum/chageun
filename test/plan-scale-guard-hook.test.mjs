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
writeFileSync(join(DIR, "docs/plans/round9.md"), "재검증 회차: 9\n" + "c\n".repeat(50));
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

test("재검증 5회째면 exit 2 로 막는다", () => {
  const r = runHook(gateCall("재검증 회차: 5\n계획서: docs/plans/small.md"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /5회째 재검증/);
});

test("계획서 머리의 회차도 읽어 막는다", () => {
  assert.equal(runHook(gateCall("계획서: docs/plans/round9.md")).status, 2);
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

test("게이트가 아닌 에이전트 호출은 안 막는다", () => {
  const r = runHook({ tool_name: "Task", cwd: DIR,
    tool_input: { subagent_type: "general-purpose", prompt: "계획서: docs/plans/big.md" } });
  assert.equal(r.status, 0);
});

// 2회차 medium: 래퍼의 **축별 승인 루프**를 덮는다. 단위 테스트는 배열 반환만 보므로,
//   루프를 `every` 같은 형태로 "정리"하면 크기 승인 하나가 회차까지 여는 1회차 결함이 재발한다.
test("크기 승인이 있어도 회차는 따로 막힌다", () => {
  const key = "[chageun-big-plan:big.md:4k]";
  const question = `계획이 큽니다 ${key}`;
  const records = [
    { message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion",
      input: { questions: [{ question, multiSelect: false,
        options: [{ label: "쪼갠다" }, { label: "이 크기로 진행" }] }] } }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false,
      content: `${JSON.stringify(question)}=${JSON.stringify("이 크기로 진행")}` }] } },
  ];
  const tp = join(DIR, "size-only.jsonl");
  writeFileSync(tp, records.map((o) => JSON.stringify(o)).join("\n"));
  const r = runHook({ ...gateCall("재검증 회차: 9\n계획서: docs/plans/big.md"), transcript_path: tp });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /5회째 재검증/);
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

test("회차 차단은 회차를 읽은 출처를 찍는다", () => {
  const r = runHook(gateCall("재검증 회차: 6\n계획서: docs/plans/small.md"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /출처 호출 프롬프트/);
});
