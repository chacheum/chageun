import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P5 clarify식 보강의 load-bearing 앵커 — 삭제 회귀 바닥이지 행동 준수 증거 아님(실제 반영은 사람 검토+실사용).
// 정확 워딩이 아니라 안전-핵심 문구만 잡는다(브리틀·무력 마커 회귀 방지).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(ROOT, "src", "skills", "spec-gate", "SKILL.md"), "utf8");
const codexSkill = readFileSync(join(ROOT, "dist", "codex", "skills", "spec-gate", "SKILL.md"), "utf8");

const ANCHORS = [
  "취향 결정 — AI 추천 없음",   // 추천답 취향 예외
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

test("Codex 산출물에도 동일 앵커가 인라인됨(듀얼 플랫폼)", () => {
  for (const a of ANCHORS) {
    assert.ok(codexSkill.includes(a), `dist/codex spec-gate SKILL.md에 누락: ${a}`);
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
