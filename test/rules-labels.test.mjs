import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// batch7 영어화 회귀 가드 — 규칙이 영어여도 "정본 한국어 라벨"은 남아야 한다.
// (a) Stop 훅 정규식 seed: finish-work.js가 한국어 출력(끝 점검·자가점검·비전문가 요약·실구동·
//     요약 5필드)으로 갭을 감지한다. 규칙 골격이 이 라벨을 잃으면, 스킬 미로드 세션(=가드의 표적)
//     에서 Claude가 임의 라벨로 렌더해 가드가 조용히 무력화된다(plan-validator HIGH).
// (b) 한국어 스킬 5종이 "코어 '○○' 절"을 한국어 제목으로 참조한다 — 병기 제목 유지(plan-validator medium).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULES = readFileSync(join(ROOT, "src", "rules", "operating-rules.md"), "utf8");

const HOOK_SEEDS = [
  "끝 점검", "자가점검", "비전문가 요약", "실구동 검증", "구동 검증", "LIGHT",
  // 비전문가 요약 5필드 (finish-work SUMMARY_FIELD_RE 어휘)
  "무엇을 했는가", "왜 이렇게 결정했는가", "잘되면", "잘못되면", "다음에 확인할 것",
];

const SECTION_LABELS = [
  "작업 규모 스위치", "작업 시작 카드 · 비전문가 요약", "검증 게이트", "게이트 판정 ↔ 멈춤",
  "스펙 확인 게이트", "최소 구현 우선", "모델·실행 라우팅", "작업 유형별 진행", "제품 지도",
  "멈춤 규칙", "실제 구동 검증", "안전 캡슐", "보안·승인 위생",
];

const MISC_LABELS = ["위험 없음", "달라진 것 N건", "진행 보고", "🙋 확인 필요", "별도 심판 게이트 없음", "동작 검증 안 됨"];

test("훅 seed 한국어 라벨이 규칙에 존재(영어화 후 소실 금지)", () => {
  for (const s of HOOK_SEEDS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("스킬이 참조하는 코어 절 한국어 제목이 병기로 존재", () => {
  for (const s of SECTION_LABELS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("기타 정본 라벨 존재", () => {
  for (const s of MISC_LABELS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("스킬 로드 강제 포인터 5문장 유지(Skill tool + 스킬 ID)", () => {
  for (const id of ["chageun:formats", "chageun:spec-gate", "chageun:routing", "chageun:run-verify", "chageun:finish-check"]) {
    const re = new RegExp(`load(ing)? \\\`${id}\\\` via the Skill tool`);
    assert.ok(re.test(RULES), `포인터 누락: ${id}`);
  }
});
