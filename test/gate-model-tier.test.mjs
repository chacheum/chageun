import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// R6 (Anthropic 강연 백로그): 게이트 모델이 조용히 노화해 일꾼보다 약해지는 걸 막는다.
// 설계 의도 = "검토 대상보다 최소 같거나 강한 독립 심판". 이 테스트가 기계로 강제할 수 있는 두 가지:
//   1. 게이트(plan-validator·pr-reviewer)는 지정된 최상위 모델을 쓴다.
//   2. 일꾼(code-implementer)은 게이트보다 강한 티어가 아니다(심판≥일꾼).
// 테스트가 볼 수 없는 것: 살아있는 메인 세션 모델. 사용자가 Opus 위 티어를 메인으로 상시 돌리면
// Opus 게이트가 메인보다 약해지는데 — 규칙 본문의 "메인 세션보다 약한 모델 금지"가 그 경우를 산문으로
// 덮는다(어떤 테스트도 세션 모델을 못 읽는다). 그래서 이 테스트는 **마이그레이션 체크포인트**다:
// Opus 위 티어가 표준이 되면 TOP_TIER와 게이트 `model:`을 같은 커밋에서 함께 올려야 하고, 이 테스트가
// 둘을 lockstep으로 묶어 조용한 노화를 시끄러운 한 줄 diff로 바꾼다.
// (계측 아님 — 정적 프론트매터 검사, 로컬 로깅·카운터 없음.)
const AGENTS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "agents");
// 오름차순 강도. Anthropic이 새 티어를 내면 여기에 추가한다.
const TIER = { haiku: 1, sonnet: 2, opus: 3 };
const TOP_TIER = "opus";

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
