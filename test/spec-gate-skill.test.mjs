import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P5 clarify식 보강의 load-bearing 앵커 — 삭제 회귀 바닥이지 행동 준수 증거 아님(실제 반영은 사람 검토+실사용).
// 정확 워딩이 아니라 안전-핵심 문구만 잡는다(브리틀·무력 마커 회귀 방지).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(ROOT, "src", "skills", "spec-gate", "SKILL.md"), "utf8");

const ANCHORS = [
  "취향 결정 - AI 추천 없음",   // 추천답 취향 예외 (v0.67.0 T7-나: 긴 줄표를 하이픈으로 · 소스와 한 벌)
  "각각 이렇게 됨",             // 안전 클래스 추천답 carve-out(고무도장 방지 — F1 안전-핵심)
  "WAIVED로 넘기지 않는다",     // WAIVED fail-safe 대칭(안전 클래스 애매하면 위임 금지)
  "WAIVED",                     // 위임 기록(정직회계)
  "[확인 필요: 무엇]",          // 인라인 마커
];

test("spec-gate 스킬에 P5 clarify식 보강 앵커가 존재(삭제 회귀 바닥)", () => {
  for (const a of ANCHORS) {
    assert.ok(skill.includes(a), `src spec-gate SKILL.md에 누락: ${a}`);
  }
});

test("안전 클래스 추천답 carve-out이 WAIVED carve-out과 대칭(F1 — 고무도장 방지)", () => {
  // 두 안전 제외가 같은 클래스(안전·권한·데이터 노출·삭제)를 가리키는지 — 문구 공존 확인.
  assert.ok(skill.includes("안전·권한·데이터 노출·삭제 방식 결정은 추천 답을 미리 채우지 않고") ||
            skill.includes("안전·권한·데이터 노출·삭제 방식 결정(🙋 최우선 클래스)은 추천 답을 미리 채우지 않고"),
    "추천답 안전 carve-out 문구 부재");
  assert.ok(skill.includes("안전·권한·데이터 노출·삭제 방식 결정은 WAIVED로 넘기지 말고"),
    "WAIVED 안전 carve-out 문구 부재");
});

// 🛑 `:13`(🙋 정의) 자체를 지키는 앵커. v0.66.0 이전에는 이 파일의 앵커가 `:14`·`:17`·`:39` 만
//    잡았고 **`:13` 에는 하나도 없었다** — 그 줄이 통째로 사라져도 전 테스트가 초록이었다.
//    🙋 정의는 이 저장소가 꼽은 최대 위험(상한이 무너져 확인 질문이 넘치고 사용자가 "알아서 해"로
//    답하게 되는 것)이 사는 자리라, 다시 쓸 때 그물을 먼저 친다.
//    ⚠ 앵커는 **`:13` 에만 있는 문자열**로 골랐다(실측). `스펙을 잠그` 는 `:40` 에도 있고
//    `안전·권한·데이터 노출·삭제 방식 결정` 은 `:14`·`:39` 에도 있어, 그 문자열로 걸면
//    `:13` 을 통째로 지워도 초록이다.
const INTENT_ANCHORS = [
  "최대 4개",                       // 🙋 상한. 이 숫자가 빠지면 질문이 넘쳐 사용자가 지친다
  "`chageun:planning` 으로 되돌린다", // 되짚을 **목적지**. 옛 문장은 "되짚는다"로 끝나 목적지가 암시였다
  "스펙을 잠그지 않는다",             // 되짚기의 나머지 반쪽. 없으면 넘친 채로 스펙이 굳는다
  "구조·범위급으로 취급",             // 안전·권한·데이터 노출·삭제 결정의 최우선 규칙(`:13` 유일 문자열).
                                    // 에이전트 쪽 쌍둥이는 test/agent-anchors.test.mjs 의 PV_MARKERS 가 잡는다
                                    // — 한쪽만 고쳐 형제가 남는 것이 이 저장소 단골 사고다
];

test("spec-gate `:13`(🙋 정의)의 상한·되짚기·안전 최우선이 살아 있다", () => {
  for (const a of INTENT_ANCHORS) assert.ok(skill.includes(a), `src spec-gate SKILL.md에 누락: ${a}`);
});

// 예시로 확인(계산·규칙 오라클) 앵커 — Fable 리뷰 지적6 "그럴듯하게 틀린 도메인 로직" 방어.
// 삭제 회귀 바닥이지 발동 증거 아님(발동은 사람 도그푸드).
const EXAMPLE_ANCHORS = [
  "예시로 확인",               // 블록 이름(오라클 캡처)
  "정답이 얼마여야 하나",      // 🙋(의도)와 구분되는 오라클 칸
  "먼저 자동 테스트",          // TDD 오라클로 굳힘
  "사용자만 아는 도메인 규칙", // 추정 금지 carve-out
];

test("spec-gate에 '예시로 확인'(계산·규칙 오라클) 앵커 존재", () => {
  for (const a of EXAMPLE_ANCHORS) assert.ok(skill.includes(a), `src spec-gate SKILL.md 누락: ${a}`);
});

// 회고 4번(2026-07-30) 앵커 — 제품 판단 🙋에 타사 근거를 붙이는 규칙. 다음 다이어트에서 조용히
// 사라지는 것을 막는 회귀 바닥이다(발동 증거는 아님). 실측 사고의 실제 원인이 "조사 부재"가 아니라
// "가진 근거를 삭제 쪽 항목에 안 대봄"이었으므로 그 단서까지 함께 못박는다.
const VENDOR_ANCHORS = [
  "여쭙기 전에",                        // 조사 시점(결정 후가 아니라 전)
  "없애자\"는 쪽 항목에도 대본다",      // 사고의 실제 원인 — 선택적 적용 금지
];

test("spec-gate에 '제품 판단은 타사 근거' 앵커 존재(회고 4번)", () => {
  for (const a of VENDOR_ANCHORS) assert.ok(skill.includes(a), `src spec-gate SKILL.md 누락: ${a}`);
});

