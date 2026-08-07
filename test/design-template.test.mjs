import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// relay check-template.sh의 차근 내부판 — 승격된 템플릿이 표준 요소를 담고,
// 공개 플러그인에 브랜드(relay/다우밸브) 흔적이 새지 않았는지 영구 검증한다.
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "design-system");
const TPL = readFileSync(join(SKILL_DIR, "design-system.template.md"), "utf8");
const SKILL = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const RUN_VERIFY = readFileSync(join(SKILL_DIR, "..", "run-verify", "SKILL.md"), "utf8");
const REGISTRY_TEMPLATE = readFileSync(join(SKILL_DIR, "component-registry.template.json"), "utf8");

function readComponentChoices(text) {
  const marker = "**컴포넌트 선택지(정확히 2개):**";
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, "컴포넌트 2택 표식 누락");
  return text.slice(start + marker.length).split("\n").slice(1, 3)
    .map((line) => line.replace(/^\d+\.\s+/, ""));
}

const REQUIRED_SECTIONS = [
  "## Project Profile", "## Overview", "## Colors", "## Typography",
  "## Layout", "## Elevation & Depth", "## Shapes", "## Components",
  "## Accessibility", "## Do's and Don'ts",
];

test("템플릿은 표준 섹션 10종을 담는다", () => {
  for (const s of REQUIRED_SECTIONS) assert.ok(TPL.includes(s), `섹션 누락: ${s}`);
});

test("템플릿은 보편/성격 규칙 구분과 lint 표준을 담는다", () => {
  assert.ok(TPL.includes("보편 규칙"), "'보편 규칙' 설명 누락");
  assert.ok(TPL.includes("성격 규칙"), "'성격 규칙' 설명 누락");
  assert.match(TPL, /lint|자동강제/, "lint 표준 설명 누락");
});

test("템플릿은 토큰 정합 검사용 css-path 칸을 담는다", () => {
  assert.match(TPL, /css-path:/, "css-path 키 누락(토큰 정합 검사기가 읽는 경로)");
});

test("템플릿은 색 예외용 lint-allow-colors 칸을 담는다", () => {
  assert.match(TPL, /lint-allow-colors:/, "lint-allow-colors 키 누락(직접색상 예외 선언)");
});

test("UI 설명문 기본값은 반복 억제와 필요한 정보 보존을 함께 담는다", () => {
  const preserved = ["입력 형식", "조건", "결과", "위험", "다음 행동", "접근성"];
  for (const [name, text] of [["스킬", SKILL], ["템플릿", TPL]]) {
    const rule = text.split("\n").find((line) => /같은 뜻[^\n]*(부제|도움말|설명)/.test(line));
    assert.ok(rule, `${name}: UI 설명문 규칙 누락`);
    assert.match(rule, /기본값으로 붙이지 않는다|기본 생성하지 않는다/, `${name}: 반복 설명 억제 방향 누락`);
    assert.match(rule, /사용자가 명시적으로 요청/, `${name}: 사용자 요청 예외 누락`);
    for (const item of preserved) assert.ok(rule.includes(item), `${name}: 필요한 정보 보존 누락: ${item}`);
  }
});

test("찍어낼 검사기 3종은 스킬에 번들되고, check-template은 배포하지 않는다", () => {
  for (const f of ["check-design-violations.sh", "check-profile.sh", "check-token-parity.sh"])
    assert.ok(existsSync(join(SKILL_DIR, f)), `번들 누락: ${f}`);
  assert.ok(!existsSync(join(SKILL_DIR, "check-template.sh")), "check-template.sh는 배포 대상이 아님(내부 테스트로 대체)");
});

test("공개 플러그인 — 브랜드/프로젝트 흔적 누수 없음", () => {
  // relay/다우밸브 고유값이 승격물에 남으면 안 된다(브랜드 중립 골격이어야 함).
  for (const leak of [/cobalt/i, /1474b8/i, /1456f0/i, /pretendard/i, /dow.?valve/i, /다우밸브/, /relay\s+scripts\//i]) {
    assert.doesNotMatch(TPL, leak, `브랜드/프로젝트 흔적 누수: ${leak}`);
  }
});

// ── P2 자라나는 레지스트리(부품+변형) ────────────────────────────────────────

test("템플릿은 v1 부품+변형 슬롯(페이지 폭·모달)을 담는다", () => {
  assert.match(TPL, /page-width:/, "page-width 슬롯 누락");
  assert.match(TPL, /modal:/, "modal 슬롯 누락");
  assert.match(TPL, /sizes:\s*\[/, "모달 크기 변형 목록 누락");
});

test("템플릿은 공용 컴포넌트와 변형 레지스트리 개념을 담는다(원본=코드·조회후재사용)", () => {
  assert.match(TPL, /공용 컴포넌트와 변형|부품과 변형|부품 ?\+ ?이름/, "컴포넌트+변형 개념 누락");
  assert.match(TPL, /원본은[^\n]*코드|코드[^\n]*원본/, "'원본=코드' 원칙 누락");
  assert.match(TPL, /조회[\s\S]{0,200}기존 컴포넌트와 변형 사용/, "조회 후 기존 변형 사용 규율 누락");
});

test("SKILL은 레지스트리 동작 루프와 v1 범위(페이지폭·모달)를 담는다", () => {
  assert.match(SKILL, /레지스트리|부품 ?\+ ?변형/, "레지스트리 개념 누락");
  assert.match(SKILL, /페이지 폭/, "v1 범위 '페이지 폭' 누락");
  // '모달'은 기존 §0·§1 본문에도 있어 bare /모달/이면 무력(plan-validator medium) →
  // 레지스트리 절 안(레지스트리 다음)의 모달만 인정.
  assert.match(SKILL, /레지스트리[\s\S]*모달/, "v1 범위 '모달'이 레지스트리 절에 없음");
});

test("공용 컴포넌트 경계 검사 자산과 프로젝트 검사 안내를 제공한다", () => {
  for (const file of [
    "component-registry.template.json",
    "component-boundary-core.cjs",
    "check-component-boundaries.cjs",
  ]) assert.ok(existsSync(join(SKILL_DIR, file)), `공용 component 자산 누락: ${file}`);

  for (const anchor of [
    "node scripts/check-component-boundaries.cjs",
    "--all",
    "--range <base> <head>",
    "lint ignore·env로 우회되지 않는다",
    "편집 순간",
    "chageun-design-variant:<component-id>:<variant-id>",
    "기존 변형 사용",
    "새 공용 변형 등록",
  ]) assert.ok(SKILL.includes(anchor), `component 검사 안내 누락: ${anchor}`);
});

test("공용 컴포넌트 흐름은 정확한 2택과 빈 v1 레지스트리를 제공한다", () => {
  const expectedChoices = [
    "기존 컴포넌트와 변형 사용",
    "기존 컴포넌트에 새 공용 변형 등록",
  ];

  for (const text of [SKILL, TPL, RUN_VERIFY]) {
    assert.deepEqual(readComponentChoices(text), expectedChoices);
    assert.doesNotMatch(text, /^\s*3\.\s+.*(?:일회성|예외|임시)/m);
  }

  assert.deepEqual(JSON.parse(REGISTRY_TEMPLATE), {
    version: 1,
    components: {},
    decisions: [],
  });

  for (const key of [
    "component-registry-path:",
    "component-roots:",
    "page-patterns:",
  ]) assert.ok(TPL.includes(key), `템플릿 설정 누락: ${key}`);

  assert.match(SKILL, /\[chageun-design-variant:<component-id>:<variant-id>\]/);
  assert.match(
    SKILL,
    /"label": "기존 변형 사용"[\s\S]*"label": "새 공용 변형 등록"/,
  );
});
