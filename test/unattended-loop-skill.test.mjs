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
  "N=2",                         // LOOP: 고치기 2회까지
  "부풀기",                      // LOOP: 변경이 범위 벗어나면 멈춤
  "git diff --stat",             // LOOP: 부풀기 판정 수단
  "국소 가정",                   // 가정: 표시·문구는 최선추측+진행
  "구조 가정",                   // 가정: 데이터모델 등은 park
  "질문 상한",                   // 가정: 🙋 상한 넘으면 park
  "재판정",                      // 가정: 민감면·구조 건드리면 park
  "구조로 보고 park",            // 가정: 애매하면 안전측(타이브레이커)
  "커밋",                        // LOOP: 통과 시 저장(push 아님)
  "park",                        // 갈림길·실패는 멈춤
  "대기표",                      // FINISH: hard-stop 대기표(배포는 복귀 후)
  "검증 대기 초안",              // FINISH: "완성" 아님 언어
  "queue.md",                    // SETUP: 여러 일 큐 파일
  "위에서부터",                  // LOOP: 큐를 순서대로
  "커밋 이력",                   // 재개: git 이력으로 어디까지 했나 판정
  "한도",                        // 예산/워치독 한도 도달 시 멈춤
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

const RULES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "rules", "operating-rules.md"),
  "utf8"
);
test("무인 스킬: 질문 상한 표기가 4개로 통일(스킬·operating-rules 모두 3~4 잔존 금지)", () => {
  assert.ok(!SKILL.includes("3~4"), "SKILL.md: 질문 상한이 '4개'로 통일돼야 함");
  assert.ok(!RULES.includes("3~4"), "operating-rules.md: 질문 상한이 '4개'로 통일돼야 함(두 문서 표류 방지)");
});
