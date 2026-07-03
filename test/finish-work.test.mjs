import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { shouldBlock, shouldBlockNoEvidence } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "finish-work.js"));

const U = (t) => ({ message: { role: "user", content: [{ type: "text", text: t }] } });
const A = (t) => ({ message: { role: "assistant", content: [{ type: "text", text: t }] } });
const ATool = () => ({ message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] } });
const UResult = () => ({ message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });

// 막아야 하는 것 — 작업을 하겠다 약속만 하고 끝냄(도구 실행 없이).
test("약속만 하고 끝난 응답은 차단", () => {
  assert.equal(shouldBlock("이제 로그인 폼을 구현하겠습니다. 완료되면 알려드리겠습니다"), true);
  assert.equal(shouldBlock("이제 코드를 검토하겠습니다"), true, "검토 약속(Fable 지적 사례)");
  assert.equal(shouldBlock("완료되면 알려드리겠습니다"), true, "보고 약속만 남기고 끝");
  assert.equal(shouldBlock("바로 수정하겠습니다"), true);
  assert.equal(shouldBlock("Now I will implement the login form."), true);
  assert.equal(shouldBlock("Let me review the changes."), true);
});

// 통과해야 하는 것 — 정상적으로 묻거나, 이미 했거나, 마무리 보고.
test("질문·완료·정상 마무리는 통과(false-block 방지)", () => {
  assert.equal(shouldBlock("저장하시겠어요?"), false, "질문");
  assert.equal(shouldBlock("다르게 할까요?"), false, "선택 질문");
  assert.equal(shouldBlock("확인해 주세요"), false, "사용자에게 요청");
  assert.equal(shouldBlock("코드를 검토했습니다. 문제 없습니다."), false, "과거형(이미 함)");
  assert.equal(shouldBlock("테스트 3개 전부 통과했습니다."), false, "완료 보고");
  assert.equal(shouldBlock("결과를 정리하면 다음과 같습니다."), false, "요약 도입부");
  assert.equal(shouldBlock("다음과 같이 정리합니다: 파일 3개 수정."), false, "현재형 요약(보고성 동사 오차단 방지)");
  assert.equal(shouldBlock("이제 결과를 공유합니다."), false, "현재형 공유");
  assert.equal(shouldBlock("이제 변경 내용을 설명합니다."), false, "현재형 설명");
  assert.equal(shouldBlock("승인해 주시면 진행하겠습니다."), false, "승인 대기");
  assert.equal(shouldBlock(""), false, "빈 텍스트");
});

// 증거 없는 성공 선언 가드 (W3+W5). F-1: tool_result(user)를 진짜 user로 착각하면 안 됨.
test("증거가드: 도구 없이 '돌려봤다'만 하면 차단", () => {
  assert.equal(shouldBlockNoEvidence([U("로그인 만들어줘"), A("돌려보니 테스트 통과했습니다.")]), true);
});
test("증거가드[F-1]: 이번 요청에 도구 썼으면(도구결과 user 사이에 껴도) 통과", () => {
  const objs = [U("로그인 만들어줘"), ATool(), UResult(), A("돌려보니 테스트 통과했습니다.")];
  assert.equal(shouldBlockNoEvidence(objs), false, "이전 턴 도구 실행 → 정상 끝 점검, 오차단 금지");
});
test("증거가드: 보고어휘(✅·성공기준)만으론 안 걸림(정상 끝 점검)", () => {
  assert.equal(shouldBlockNoEvidence([U("요약해줘"), A("성공 기준 3개 ✅ 모두 충족했습니다.")]), false);
});
test("증거가드: 질문으로 끝나면 통과", () => {
  assert.equal(shouldBlockNoEvidence([U("만들어줘"), A("돌려볼까요?")]), false);
});
test("증거가드: 실행 증거 0인데 '아까 돌려봤다'는 조작 → 차단", () => {
  // 세션에 도구 실행이 전혀 없음 → 과거참조여도 fail-open 안 함(신선도 백스톱).
  assert.equal(shouldBlockNoEvidence([U("좋아"), A("아까 돌려보니 테스트 통과했으니 마무리합니다.")]), true);
});
test("증거가드: '아까 돌려봤다' + 앞선 실행 증거(Bash) → 정당 재보고로 통과", () => {
  // 앞 턴에 실제 Bash 실행 → 후속턴 재보고는 오차단하지 않는다.
  const objs = [U("만들어줘"), ATool(), UResult(), U("좋아"), A("아까 돌려보니 통과했으니 마무리합니다.")];
  assert.equal(shouldBlockNoEvidence(objs), false, "정당한 재보고 오차단 금지");
});
// hasExecEvidence 분기 회귀 방어(pr-reviewer low): MCP 실행은 증거, 읽기전용 MCP는 증거 아님.
const AMcp = (name) => ({ message: { role: "assistant", content: [{ type: "tool_use", name, input: {} }] } });
test("증거가드: '아까' + MCP 실행(execute_sql) 증거 → 통과(Supabase-헤비 오차단 방지)", () => {
  const objs = [U("데이터 넣어줘"), AMcp("mcp__plugin_supabase_supabase__execute_sql"), UResult(), U("좋아"), A("아까 넣어보니 잘 됐으니 마무리합니다.")];
  assert.equal(shouldBlockNoEvidence(objs), false, "MCP 실행도 실행 증거");
});
test("증거가드: '아까' + 읽기전용 MCP(list_tables)만 → 실행 증거 아님 → 차단", () => {
  const objs = [U("확인해"), AMcp("mcp__plugin_supabase_supabase__list_tables"), UResult(), U("좋아"), A("아까 돌려보니 테스트 통과했으니 마무리합니다.")];
  assert.equal(shouldBlockNoEvidence(objs), true, "읽기전용 MCP는 실행 증거로 안 침");
});
