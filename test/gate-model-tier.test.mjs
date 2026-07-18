import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// R6 (Anthropic 강연 백로그): 게이트 모델이 조용히 노화해 일꾼보다 약해지는 걸 막는다.
// 설계 의도 = "검토 대상보다 최소 같거나 강한 독립 심판". 이 테스트가 기계로 강제할 수 있는 두 가지:
//   1. 게이트(plan-validator·pr-reviewer)는 지정된 최상위 모델을 쓴다.
//   2. 일꾼(code-implementer)은 게이트보다 강한 티어가 아니다(심판≥일꾼).
// 테스트가 볼 수 없는 것: 살아있는 메인 세션 모델. 사용자가 게이트 티어 위 모델을 메인으로 상시 돌리면
// 게이트가 메인보다 약해지는데, 규칙 본문의 "메인 세션보다 약한 모델 금지"가 그 경우를 산문으로
// 덮는다(어떤 테스트도 세션 모델을 못 읽는다). 그래서 이 테스트는 **마이그레이션 체크포인트**다:
// 새 최상위 티어가 표준이 되면 TOP_TIER와 게이트 `model:`을 같은 커밋에서 함께 올려야 하고, 이 테스트가
// 둘을 lockstep으로 묶어 조용한 노화를 시끄러운 한 줄 diff로 바꾼다. (2026-07-18: Opus→Fable 마이그레이션.)
// (계측 아님 — 정적 프론트매터 검사, 로컬 로깅·카운터 없음.)
const AGENTS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "agents");
// 오름차순 강도. Anthropic이 새 티어를 내면 여기에 추가한다.
const TIER = { haiku: 1, sonnet: 2, opus: 3, fable: 4 };
// 리뷰 게이트는 Fable(다른 집안 최상위 추론모델)로 독립 심판 — 통제 비교 3판(점검2·계획1) + 사용자 실사용
// 근거(2026-07-18). 같은 집안 심판(Opus가 Opus)은 맹점 공유 → 다른 집안이 더 잡음. Claude 전용(Codex는 Fable 없음 → 아래 test 3은 '강한 모델' 산문 유지).
const TOP_TIER = "fable";

function modelOf(file) {
  const fm = readFileSync(join(AGENTS, file), "utf8");
  const m = /^model:\s*"?([a-z0-9-]+)"?/m.exec(fm);
  assert.ok(m, `${file}: model 프론트매터를 못 찾음`);
  return m[1];
}

test("게이트(plan-validator·pr-reviewer)는 최상위 모델을 쓴다 — R6 마이그레이션 체크포인트", () => {
  for (const f of ["plan-validator.md", "pr-reviewer.md"]) {
    assert.equal(
      modelOf(f), TOP_TIER,
      `${f} 게이트가 최상위(${TOP_TIER})가 아님 — 심판이 일꾼보다 약해질 위험. ` +
      `Opus 위 티어가 메인 표준이 되면 TOP_TIER와 게이트 model:을 같은 커밋에서 함께 올려라.`
    );
  }
});

test("일꾼(code-implementer)은 게이트보다 강한 티어가 아니다 — 심판≥일꾼", () => {
  const worker = modelOf("code-implementer.md");
  assert.ok(TIER[worker], `code-implementer 모델 '${worker}'이 TIER 표에 없음 — 새 모델이면 TIER에 추가하라`);
  assert.ok(
    TIER[worker] <= TIER[TOP_TIER],
    `code-implementer(${worker})가 게이트(${TOP_TIER})보다 강함 — 심판이 일꾼보다 약함(R6가 막으려는 역전).`
  );
});

// R6 Codex 미러 가드 — Fable5 R6 재감사가 찾은 구멍(2026-07-12).
// 위 두 테스트는 Claude 프론트매터(src/agents/*.md)만 읽는다. Codex 게이트는 모델을 산문으로 지정하므로
// (src/codex/gate-agents.md) 어떤 테스트도 그 지정을 지키지 않았다 — agent-parity는 판정 문구만 잠글 뿐
// 모델 티어는 안 잠갔다. 누가 Codex 쪽 게이트를 "강한 모델"→"빠른 모델"로 조용히 강등해도 전 테스트가
// 통과했다(behavior hole 아닌 coverage hole). 이 가드가 그 조용한 강등을 시끄러운 실패로 바꾼다.
// ([[chageun-dual-platform-mirror]] 원칙의 실물: golden은 Claude만 봐서 Codex 표류를 못 잡는다.)
const CODEX_GATES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "codex", "gate-agents.md");

test("Codex 게이트 미러도 심판=강한 모델·일꾼=빠른 모델을 유지한다 — R6 표류 가드", () => {
  const g = readFileSync(CODEX_GATES, "utf8");
  // 1. 모델 매핑 앵커: 차근 Opus=강한 모델 / Sonnet=빠른 모델. 이 산문이 뒤집히면 게이트 심판이 약화된다.
  assert.ok(/"Opus"\s*=\s*Codex에서\s*강한 모델/.test(g),
    'Codex 매핑에서 "Opus = 강한 모델"이 사라지거나 바뀜 — 게이트 심판이 약해질 표류');
  assert.ok(/"Sonnet"\s*=\s*빠른 모델/.test(g),
    'Codex 매핑에서 "Sonnet = 빠른 모델"이 사라지거나 바뀜');
  // 2. plan-validator(게이트) spawn 예시는 강한 모델. **그 예시 블록만** 잘라 검사한다 —
  //    전역 부정검사는 나중에 일꾼 spawn 예시(정당한 빠른 모델)를 오탐한다(pr-reviewer low). 앵커는
  //    예시 헤딩 전문("분리 실행 예시")까지 잡아 아래 `## plan-validator 지시문` 헤딩으로 흘러가지 않게 한다.
  const gateSpawn = /# plan-validator 분리 실행 예시[\s\S]*?```/.exec(g);
  assert.ok(gateSpawn, "Codex plan-validator spawn 예시 블록을 못 찾음(문서 구조 변경?)");
  assert.ok(/model="강한 모델"/.test(gateSpawn[0]),
    'Codex plan-validator(게이트) spawn 예시가 강한 모델이 아님 — 심판 약화');
  assert.ok(!/model="빠른 모델"/.test(gateSpawn[0]),
    'Codex plan-validator(게이트) spawn 예시가 빠른 모델로 강등됨 — R6 역전');
  // 3. code-implementer(일꾼)는 빠른 모델. code-implementer 섹션으로 국한(전역 검사는 다른 곳
  //    같은 포맷 줄에 마스킹될 수 있어 — pr-reviewer low; 승격도 직접 부정검사로 잡아 게이트와 대칭).
  const ciIdx = g.indexOf("## code-implementer 지시문");
  assert.ok(ciIdx >= 0, "Codex code-implementer 섹션을 못 찾음(문서 구조 변경?)");
  const workerSection = g.slice(ciIdx);
  assert.ok(/\*\*모델:\*\*\s*빠른 모델/.test(workerSection),
    'Codex code-implementer 일꾼이 빠른 모델이 아님 — 심판<일꾼 역전(R6)');
  assert.ok(!/\*\*모델:\*\*\s*강한 모델/.test(workerSection),
    'Codex code-implementer 일꾼이 강한 모델로 승격됨 — 심판<일꾼 역전(R6)');
});
