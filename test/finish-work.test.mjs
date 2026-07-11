import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { shouldBlock, shouldBlockNoEvidence, shouldBlockSkillGap, assistantTextSinceLastUser, leakBlockReason } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "finish-work.js"));

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

// P1 스킬갭 가드: FULL 끝 점검/실구동 주장이 절차 스킬 로드 없이 끝나면 1회 차단.
// 실제 transcript 형식 검증됨(2026-07-06): {"name":"Skill","input":{"skill":"chageun:spec-gate"}}
const ASkill = (skill) => ({ message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill } }] } });

test("스킬갭: FULL 끝 점검 텍스트(✅ 2개) + finish-check 미로드 → 차단", () => {
  const objs = [U("기능 마무리해줘"), A("끝 점검 — 자가점검: 성공 기준 1 ✅ 충족, 2 ✅ 충족.")];
  assert.equal(shouldBlockSkillGap(objs), "finish-check");
});
test("스킬갭: finish-check 로드했으면(세션 내 1회) 통과", () => {
  const objs = [U("마무리해줘"), ASkill("chageun:finish-check"), UResult(), A("끝 점검 — 자가점검: 성공 기준 1 ✅, 2 ✅ 충족.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("스킬갭: LIGHT 끝 점검은 로드 불요 → 통과", () => {
  const objs = [U("오타 고쳐줘"), A("끝 점검(LIGHT): 성공 기준 충족 ✅✅ — 오타 2건 수정.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("스킬갭: 끝 점검 어휘 없으면(✅만) 침묵", () => {
  const objs = [U("요약해줘"), A("성공 기준 3개 ✅✅✅ 모두 충족했습니다.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("스킬갭: 끝 점검 언급만 있고 채점(✅/❌) 없으면 침묵", () => {
  const objs = [U("설명해줘"), A("다음 단계는 끝 점검입니다.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("스킬갭: 끝 점검 설명(✅ 1개)은 침묵 — 채점 표시 2개부터 채점으로 간주(오탐 축소)", () => {
  const objs = [U("끝 점검이 뭐야"), A("끝 점검은 성공 기준을 항목마다 ✅로 채점하는 절차입니다.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("스킬갭: 실구동 주장 + run-verify 미로드 → 차단", () => {
  const objs = [U("화면 고쳐줘"), ATool(), UResult(), A("실제로 띄워서 확인했습니다. 실구동 검증 완료.")];
  assert.equal(shouldBlockSkillGap(objs), "run-verify");
});
test("스킬갭: 실구동 주장 + run-verify 로드 → 통과", () => {
  const objs = [U("화면 고쳐줘"), ASkill("chageun:run-verify"), UResult(), ATool(), UResult(), A("실구동 검증 완료했습니다.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("스킬갭: 이전 요청의 끝 점검은 이번 요청과 무관(요청 구간만 검사)", () => {
  const objs = [U("마무리해줘"), A("끝 점검 — 자가점검 ✅✅"), U("고마워, 다른 질문"), A("네, 답변입니다.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});

// ── formats 갭(batch6): FULL 비전문가 요약만 반응 — 카드 턴·LIGHT는 절대 미차단 ──
const FULL_SUMMARY = "비전문가 요약 — 지금 무엇을 했는가: 로그인 폼 구현. 왜 이렇게 결정했는가: 표준 방식. 잘되면: 손님이 로그인 가능. 잘못되면: 위험 없음. 다음에 확인할 것: 직접 로그인해보기.";

test("formats 갭: FULL 비전문가 요약 + formats 미로드 → 차단", () => {
  const objs = [U("기능 만들어줘"), A(FULL_SUMMARY)];
  assert.equal(shouldBlockSkillGap(objs), "formats");
});
test("formats 갭: chageun:formats 로드 후엔 통과", () => {
  const objs = [U("기능 만들어줘"), ASkill("chageun:formats"), UResult(), A(FULL_SUMMARY)];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("formats 갭: 작업 시작 카드 턴은 절대 안 걸림(카드는 매 FULL 작업 첫 턴 — plan-validator HIGH)", () => {
  const objs = [U("기능 만들어줘"), A("📋 작업 시작 카드 — 목표: 로그인 폼. 범위: 폼만. 성공 기준: 1) 로그인 성공 2) 오류 표시. 길의 종류: 정해진 길. 멈춤 규칙: 적용. 진행할까요?")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("formats 갭: LIGHT 한 줄 요약은 로드 불요 → 통과", () => {
  const objs = [U("오타 고쳐줘"), A("비전문가 요약(LIGHT): 오타 2건 수정, 위험 없음 — 잘되면 문구가 바로 보입니다. 다음에 확인할 것 없음.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
test("formats 갭: '비전문가 요약' 언급만(필드 어휘 2개 미만)이면 침묵", () => {
  const objs = [U("설명해줘"), A("비전문가 요약은 작업 끝에 붙는 보고 형식입니다.")];
  assert.equal(shouldBlockSkillGap(objs), null);
});

// ── G7 Stop 백스톱: .env 시크릿 값이 최종답에 인용되면 차단(값 빼고 이름/존재만) ──
function envCwd(line) { const d = mkdtempSync(join(tmpdir(), "g7fw-")); writeFileSync(join(d, ".env"), line + "\n"); return d; }

test("assistantTextSinceLastUser: tool-result-only user 건너뜀 + latestOnly=최종 메시지만(F7·F1)", () => {
  const objs = [U("real"), A("first"), UResult(), A("second")];
  assert.equal(assistantTextSinceLastUser(objs, false), "first\nsecond", "도구결과 user는 경계 아님 → 둘 다 창 안(H4)");
  assert.equal(assistantTextSinceLastUser(objs, true), "second", "재작성: 마지막 assistant 메시지만");
  assert.equal(assistantTextSinceLastUser([], false), "");
});

test("G7 백스톱 (a): 중간 누출이 도구결과 user 뒤에도 창에 남아 차단(H4) · reason은 키만(M7)", () => {
  const cwd = envCwd("API_KEY=sk-secret12345678");
  const objs = [U("show me"), A("the key is sk-secret12345678"), UResult(), A("done")];
  const r = leakBlockReason(objs, cwd, false);
  assert.ok(r && r.includes("API_KEY"), "누출 키 이름 포함");
  assert.ok(!r.includes("sk-secret12345678"), "reason에 값 절대 금지(M7)");
});

test("G7 백스톱 (b): 시크릿 미인용 → null", () => {
  const cwd = envCwd("API_KEY=sk-secret12345678");
  assert.equal(leakBlockReason([U("hi"), A("all good, API_KEY is set")], cwd, false), null);
});

test("G7 백스톱 (c) BLOCKER회귀: 재작성 시 옛 누출은 창 밖 → 무한루프 안 됨(N1)", () => {
  const cwd = envCwd("API_KEY=sk-secret12345678");
  // 스파이크 실측 구조: [user][asst 누출][user 'Stop hook feedback'][asst 깨끗한 최종]
  const objs = [U("show"), A("leak: sk-secret12345678"),
    U("Stop hook feedback: 값 빼고 다시"), A("API_KEY는 설정돼 있습니다(값은 안 찍습니다)")];
  assert.equal(leakBlockReason(objs, cwd, true), null, "stop_hook_active=true + 깨끗한 최종 → 차단 안 함(루프 끊김)");
});

test("G7 백스톱 (d): 재작성에서 값 재인용하면 여전히 차단(H3)", () => {
  const cwd = envCwd("API_KEY=sk-secret12345678");
  const objs = [U("show"), A("leak: sk-secret12345678"),
    U("Stop hook feedback: 다시"), A("네, sk-secret12345678 입니다")];
  const r = leakBlockReason(objs, cwd, true);
  assert.ok(r && r.includes("API_KEY"), "재범은 최신 메시지에서 잡힘");
});

test("G7 백스톱: .env 없으면 null(fail-open) · 빈 objs null", () => {
  const cwd = mkdtempSync(join(tmpdir(), "g7fw-"));
  assert.equal(leakBlockReason([U("x"), A("sk-secret12345678")], cwd, false), null, "cwd에 .env 없음 → no-op");
  assert.equal(leakBlockReason([], envCwd("API_KEY=sk-secret12345678"), false), null, "빈 대화");
});
