import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { shouldBlock, shouldBlockNoEvidence, shouldBlockSkillGap, assistantTextSinceLastUser, assistantTurnSegments, alreadyBounced, leakBlockReason } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "finish-work.js"));

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
// v0.42(3번 어휘 맞추기): "끝 점검"이라는 말을 안 써도 완료 어휘 + 채점표면 잡는다.
// 회고 탐지기는 이미 이 형태를 갭으로 세는데 훅만 못 잡아 실측 10건 중 7건이 어휘로 샜다.
test("스킬갭: 완료 어휘 + 채점표면 '끝 점검'이라 안 써도 차단(v0.42)", () => {
  const objs = [U("요약해줘"), A("성공 기준 3개 ✅✅✅ 모두 충족했습니다.")];
  assert.equal(shouldBlockSkillGap(objs), "finish-check");
  assert.equal(shouldBlockSkillGap([U("해줘"), A("작업 완료했습니다. 기준1 ✅ 기준2 ✅")]), "finish-check");
});
test("스킬갭: 채점표만 있고 끝 점검·완료 어휘가 전혀 없으면 여전히 침묵(과차단 방지)", () => {
  const objs = [U("표 그려줘"), A("비교표입니다. A안 ✅ 지원, B안 ✅ 지원.")];
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
// ── v0.42: 창을 직전 턴까지 넓힘 (1번 진단의 실제 처방) ──────────────────────
// **왜 뒤집혔나:** Stop 훅은 그 턴의 마지막 assistant 메시지가 파일에 반영되기 전에 돈다. 끝 점검
// 채점표는 항상 마지막 메시지라 "요청 구간만" 보면 **영원히 못 본다**(실측: 훅 실행 2,941회 중 끝 점검
// 스킬갭 발동 0회). 그래서 직전 턴까지 본다 — 한 턴 늦게 잡는 대신 0회를 벗어난다.
test("스킬갭(v0.42): 직전 턴의 끝 점검을 이번 턴 Stop에서 잡는다 — 창 2턴", () => {
  const objs = [U("마무리해줘"), A("끝 점검 — 자가점검 ✅✅"), U("고마워, 다른 질문"), A("네, 답변입니다.")];
  assert.equal(shouldBlockSkillGap(objs), "finish-check", "마지막 메시지 미반영 때문에 한 턴 늦게 잡는 것이 설계");
});
test("스킬갭(v0.42): 세 턴 전 것은 창 밖 — 무한 소급 안 함", () => {
  const objs = [U("마무리해줘"), A("끝 점검 — 자가점검 ✅✅"), U("질문1"), A("답1"), U("질문2"), A("답2")];
  assert.equal(shouldBlockSkillGap(objs), null);
});
// F-3: 두 턴을 이어붙여 매칭하면 신호가 턴을 넘어 합성돼 오차단이 된다. 판정은 턴별 독립이어야 한다.
test("스킬갭(v0.42): 어휘는 직전 턴·채점표는 이번 턴이면 합성하지 않는다(F-3 오차단 방지)", () => {
  const objs = [U("설명해줘"), A("다음 단계는 끝 점검입니다."), U("표 보여줘"), A("비교표: A ✅ B ✅")];
  assert.equal(shouldBlockSkillGap(objs), null, "각 턴 단독으로는 조건 미성립 → 침묵");
});
// L-2: 세그먼트는 **턴** 단위지 메시지 단위가 아니다. 같은 턴 안에서 나뉜 신호는 계속 잡아야 한다.
test("스킬갭(v0.42): 같은 턴 두 메시지에 어휘·채점표가 나뉘어도 잡는다(L-2 미탐 회귀 방지)", () => {
  const objs = [U("마무리해줘"), A("끝 점검을 보고합니다."), ATool(), UResult(), A("기준1 ✅ 기준2 ✅")];
  assert.equal(shouldBlockSkillGap(objs), "finish-check");
});
test("스킬갭(v0.42): 세션 첫 턴(진짜 user 1개)도 정상 판정", () => {
  assert.equal(shouldBlockSkillGap([U("해줘"), A("끝 점검 ✅✅ 완료")]), "finish-check");
  assert.deepEqual(assistantTurnSegments([], 2), []);
});

// ── v0.42: 무한차단 방지 (게이트당 세션 1회) ─────────────────────────────────
const UStop = (reasonPrefix) => ({ message: { role: "user", content: [{ type: "text", text: "Stop hook feedback: " + reasonPrefix }] } });
const FINISH_REASON_HEAD = "FULL 끝 점검을 chageun:finish-check 스킬 로드 없이 마쳤습니다.";
test("무한차단 방지: 같은 게이트로 이미 되돌렸으면 두 번째 Stop은 통과", () => {
  const objs = [U("마무리해줘"), A("끝 점검 ✅✅"), UStop(FINISH_REASON_HEAD), A("다시 보고합니다. 끝 점검 ✅✅")];
  assert.equal(alreadyBounced(objs, "finish-check"), true);
  assert.equal(shouldBlockSkillGap(objs), null, "지난 글은 고칠 수 없어 반복 차단은 영구 루프가 된다");
});
test("무한차단 방지: 다른 게이트는 여전히 잡는다", () => {
  const objs = [U("화면"), UStop(FINISH_REASON_HEAD), ATool(), UResult(), A("실구동 검증 완료했습니다.")];
  assert.equal(shouldBlockSkillGap(objs), "run-verify");
});
// F-2: 이 저장소는 차단 사유 문구를 소스·테스트에 담고 있다. 순진한 부분문자열 검색이면
// 그 파일을 Read한 세션에서 가드가 **영구 침묵**한다. 구조 앵커(text 블록만·접두)로 막는다.
test("무한차단 방지: 소스 파일 Read 결과(tool_result)에 같은 문구가 있어도 침묵하지 않는다(F-2)", () => {
  const leaked = 'Stop hook feedback: ' + FINISH_REASON_HEAD + ' // 이건 소스 안의 문자열이다';
  const readResult = { message: { role: "user", content: [{ type: "tool_result", content: leaked }] } };
  const objs = [U("훅 소스 보여줘"), ATool(), readResult, U("이제 마무리"), A("끝 점검 ✅✅")];
  assert.equal(alreadyBounced(objs, "finish-check"), false, "tool_result 블록은 대상 아님");
  assert.equal(shouldBlockSkillGap(objs), "finish-check");
});
test("무한차단 방지: 채팅에 사유를 인용만 해도 침묵하지 않는다(접두 앵커)", () => {
  const quoted = { message: { role: "user", content: [{ type: "text", text: '예전에 "' + FINISH_REASON_HEAD + '" 라고 떴었지' }] } };
  const objs = [quoted, A("끝 점검 ✅✅")];
  assert.equal(alreadyBounced(objs, "finish-check"), false, "접두가 'Stop hook feedback:'이 아니면 탈락");
  assert.equal(shouldBlockSkillGap(objs), "finish-check");
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

// ── v0.42 (F-1): endedWithTool 조기 종료가 스킬갭 판정을 삼키지 않는지 — 훅 전체 경로로 확인 ──
// 실측 근거: 마지막 메시지가 아직 반영되지 않은 탓에 파일의 마지막 assistant 레코드가 tool_use로
// 끝나는 Stop 지점이 25%(311 중 78)였고, 그때마다 스킬갭 검사에 도달조차 못 했다.
import { execFileSync } from "node:child_process";
const HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "finish-work.js");
function runHook(objs, { stopHookActive = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "fwrun-"));
  const tpath = join(cwd, "t.jsonl");
  writeFileSync(tpath, objs.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const out = execFileSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: tpath, cwd, stop_hook_active: stopHookActive }),
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

test("훅 경로(F-1): 마지막 레코드가 도구로 끝나도 스킬갭은 판정된다", () => {
  const objs = [U("마무리해줘"), A("끝 점검 ✅✅ 자가점검 완료"), U("이제 커밋해"), ATool()];
  const r = runHook(objs);
  assert.ok(r && r.decision === "block", "조기 종료로 삼켜지면 안 됨");
  assert.ok(r.reason.includes("finish-check"));
});
test("훅 경로(F-1): 약속·무증거 검사는 도구로 끝나면 종전대로 침묵(회귀 방지)", () => {
  const objs = [U("해줘"), A("이제 로그인 폼을 구현하겠습니다"), ATool()];
  assert.equal(runHook(objs), null, "약속 검사 경로는 endedWithTool 조기 종료를 유지");
});
test("훅 경로: 정상 대화는 통과(오차단 방지)", () => {
  assert.equal(runHook([U("안녕"), A("안녕하세요. 무엇을 도와드릴까요?")]), null);
});
test("훅 경로: 차단 문구가 지적 대상 위치를 밝힌다(L-7)", () => {
  const r = runHook([U("마무리해줘"), A("끝 점검 ✅✅")]);
  assert.ok(r.reason.includes("직전 턴 또는 이번 턴 앞부분"), "어디를 고쳐야 하는지 알려야 함");
});
