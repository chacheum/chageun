import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "unattended-loop", "SKILL.md"),
  "utf8"
);

// 걸음마 뼈대의 행동 계약을 문구로 고정(표류 방지). 한쪽만 지워지면 파이프라인이 달라진다.
const MARKERS = [
  ".chageun/task.md",            // SETUP: 할일 카드 위치
  ".chageun/criteria.md",        // SETUP: 성공기준(동결 대상) 위치
  "한 줄씩",                     // SETUP: 기준을 한 줄씩 확인(대충 넘김 방지)
  "동결",                        // SETUP: 무인 시작하면 .chageun 보호로 기준 잠김
  "적합",                        // 적합 확인 국면
  "plan-validator",              // LOOP: 계획심판 게이트
  "code-implementer",            // LOOP: 구현 일꾼
  "localhost",                   // LOOP: 로컬 실구동검증(배포 아님)
  "단언",                        // LOOP: assertion 주축(스크린샷은 증거)
  "pr-reviewer",                 // LOOP: 코드심판 게이트
  "N=1",                         // LOOP: 고치기 1회
  "커밋",                        // LOOP: 통과 시 저장(push 아님)
  "park",                        // 갈림길·실패는 멈춤
  "대기표",                      // FINISH: hard-stop 대기표(배포는 복귀 후)
  "검증 대기 초안",              // FINISH: "완성" 아님 언어
];

test("unattended-loop 스킬이 걸음마 파이프라인 핵심 문구를 모두 담는다", () => {
  for (const m of MARKERS) assert.ok(SKILL.includes(m), `SKILL.md에 누락: ${m}`);
});

test("무인 스킬은 배포를 무인 중 하지 않는다고 명시(로컬만)", () => {
  assert.ok(/배포[^\n]*복귀|복귀[^\n]*배포/.test(SKILL), "배포는 복귀 후 사람과 함께임을 명시해야 함");
});

const IMPL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "agents", "code-implementer.md"),
  "utf8"
);
test("code-implementer가 무인 금지 안내를 담는다", () => {
  assert.ok(/무인/.test(IMPL), "무인 언급");
  assert.ok(/push|배포|운영|외부/.test(IMPL), "되돌리기 비싼 행동 언급");
  assert.ok(/park|BLOCKED/.test(IMPL), "시도 말고 park/BLOCKED로 올리라는 지시");
});
