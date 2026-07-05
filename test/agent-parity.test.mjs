import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Claude 에이전트(src/agents)와 Codex 요약본(src/codex/gate-agents.md)은 손으로 두 벌 관리된다.
// 핵심 판정 문구가 한쪽만 바뀌면 두 플랫폼이 다르게 행동한다(Fable 지적 ③). 이 테스트가 그 표류를 막는다.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const prReviewer = readFileSync(join(SRC, "agents", "pr-reviewer.md"), "utf8");
const planValidator = readFileSync(join(SRC, "agents", "plan-validator.md"), "utf8");
const codexGates = readFileSync(join(SRC, "codex", "gate-agents.md"), "utf8");

// 각 마커는 [Claude 에이전트 파일, Codex gate-agents.md] 양쪽에 존재해야 한다.
const PR_MARKERS = [
  "medium만 있고",              // APPROVE 조건 단서(사용자 동의)
  "사용자가 알고 진행 가능",     // 안전 단서 — Codex가 이걸 빠뜨렸었음
  "비전문가 요약에 반드시 명시", // APPROVE라도 명시
  "폴백",                        // git 아닐 때 종료 금지
  "git init",                    // 되돌리기 싸게 제안
  "git ls-files --others --exclude-standard", // H3: untracked 신규파일 검수(빈 diff→검수0 방지), 양 플랫폼 표류 방어
];
const PV_MARKERS = [
  "🙋",                          // 스펙 확인 게이트 대리결정 목록
  "대리결정",                    // AI interpolation 교차검증
  "추측",                        // plan 경로 추측 금지
  "구조·범위를 바꿀",            // 🙋 우선순위 severity 잣대(#6a) — 양 플랫폼 표류 방어
  "안전·권한·데이터 노출·삭제 방식 결정은 구조·범위급으로 취급", // #6a 안전-핵심: 안전 🙋 강등 금지 절이 codex에서만 지워지는 표류 방어(pr-reviewer low)
];

test("pr-reviewer 핵심 판정 문구가 Claude·Codex 양쪽에 존재", () => {
  for (const m of PR_MARKERS) {
    assert.ok(prReviewer.includes(m), `Claude pr-reviewer.md에 누락: ${m}`);
    assert.ok(codexGates.includes(m), `Codex gate-agents.md에 누락: ${m}`);
  }
});

test("plan-validator 핵심 항목이 Claude·Codex 양쪽에 존재", () => {
  for (const m of PV_MARKERS) {
    assert.ok(planValidator.includes(m), `Claude plan-validator.md에 누락: ${m}`);
    assert.ok(codexGates.includes(m), `Codex gate-agents.md에 누락: ${m}`);
  }
});

test("pr-reviewer APPROVE 조건이 '무조건 medium 통과'로 느슨해지지 않았다", () => {
  // 표류 회귀 가드: Codex가 단서 없이 "medium만 있거나 발견 없음 → APPROVE"로 되돌아가면 실패.
  assert.ok(!/medium만 있거나 발견 없음\s*→\s*\*\*APPROVE/.test(codexGates),
    "Codex pr-reviewer가 안전 단서 없는 느슨한 APPROVE로 회귀함");
});

// 다이어트 가드: 하네스가 자동 주입하는 메모리 설명서 중복이 되돌아오지 않게 한다.
test("에이전트 파일에 하네스-중복 '# Persistent Agent Memory' 섹션이 없다", () => {
  for (const [name, txt] of [["plan-validator", planValidator], ["pr-reviewer", prReviewer]]) {
    assert.ok(!txt.includes("# Persistent Agent Memory"),
      `${name}.md에 하네스 자동주입과 중복되는 메모리 설명서가 다시 들어옴`);
    // 에이전트 고유의 '무엇을 기록할지' 안내 문단은 남아 있어야 한다.
    assert.ok(txt.includes("Update your agent memory"),
      `${name}.md에서 메모리 기록 안내 문단이 사라짐(과삭제)`);
  }
});
