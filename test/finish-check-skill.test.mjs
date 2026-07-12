import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P8 되돌리기 안내 앵커(삭제 회귀 바닥) — /rewind의 bash 미추적 주의가 정확히 남아 있는지.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const finishCheck = readFileSync(join(ROOT, "src", "skills", "finish-check", "SKILL.md"), "utf8");
const formats = readFileSync(join(ROOT, "src", "skills", "formats", "SKILL.md"), "utf8");

test("P8: 되돌리기 안내 + /rewind bash 미추적 주의(false confidence 방지)", () => {
  assert.ok(finishCheck.includes("되돌리기 안내"), "되돌리기 안내 절 부재");
  assert.ok(finishCheck.includes("/rewind"), "/rewind 안내 부재");
  assert.ok(finishCheck.includes("git 대체가 아니다"), "bash 미추적 주의 부재(false confidence 위험)");
});

// 예시로 확인 커버리지(정직 고지) 앵커 — Fable 리뷰 지적6 헛안심 방어. 콘텐츠·formats 양쪽 가드.
test("finish-check에 예시-테스트 통과 확인 + 정밀 커버리지(헛안심 방지)", () => {
  assert.ok(finishCheck.includes("예시-테스트"), "예시-테스트 통과 확인 부재");
  assert.ok(finishCheck.includes("예시 안 준 계산·규칙은 미확인"), "정밀 커버리지(미확인 명시) 부재");
  assert.ok(finishCheck.includes("자동 확인 못 함"), "테스트 틀 없음 정직 표기 부재");
});

test("formats 비전문가 요약에 '예시로 확인 커버리지' 조건부 칸 정의", () => {
  assert.ok(formats.includes("예시로 확인 커버리지"), "커버리지 칸 정의 부재");
  assert.ok(formats.includes("예시 안 준 계산·규칙은 미확인"), "미확인 명시 부재");
});
