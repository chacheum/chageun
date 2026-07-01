import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// relay check-template.sh의 차근 내부판 — 승격된 템플릿이 표준 요소를 담고,
// 공개 플러그인에 브랜드(relay/다우밸브) 흔적이 새지 않았는지 영구 검증한다.
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "design-system");
const TPL = readFileSync(join(SKILL_DIR, "design-system.template.md"), "utf8");

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
