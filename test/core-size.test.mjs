import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P6 코어 크기 상한(one-in-one-out) — 연구 F5(컨텍스트 활용률)·BMAD project-context lean 규칙 근거.
// operating-rules.md는 "매 세션 상시 주입"이라 팽창이 곧 모든 세션 비용 + 중간 규칙 희석(안전 캡슐 존재 이유).
// 이 테스트는 상한을 기계로 강제한다: 넘기려면 (a) 다른 규칙을 줄이거나(one-in-one-out), (b) 아래 상한
// 상수를 같은 커밋에서 올린다 — 후자는 한 줄 가시 diff라 리뷰어가 "코어가 또 커졌다"를 반드시 본다
// (침묵 팽창 차단). 계측 아님(정적 파일 크기 검사, 로컬 로깅·카운터 없음).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "src", "rules", "operating-rules.md");

// 상한: 현재 31,763 bytes 기준 소폭 여유(한 문장 남짓). 이 값을 올릴 땐 커밋 메시지에 "왜 코어가 커져야
// 하나 + 스킬 위임 검토했는가"를 남긴다(one-in-one-out의 예외는 가시적·정당화된 결정으로만).
const CEILING_BYTES = 32000;

test(`코어 규칙(operating-rules.md)이 상한 ${CEILING_BYTES} bytes 이하 — 팽창은 one-in-one-out`, () => {
  const bytes = statSync(CORE).size;
  assert.ok(
    bytes <= CEILING_BYTES,
    `operating-rules.md = ${bytes} bytes > 상한 ${CEILING_BYTES}. ` +
    `코어는 매 세션 상시 주입이라 팽창은 모든 세션 비용·규칙 희석을 부른다. ` +
    `다른 규칙을 줄여 상쇄하거나(one-in-one-out), 정말 필요하면 이 테스트의 CEILING_BYTES를 올리되 ` +
    `커밋에 "왜 코어가 커져야 하나 + 스킬 위임 검토" 근거를 남겨라.`
  );
});

// 상한이 실효(현재값에 붙어 있음)인지 확인 — 헤드룸이 과도하면 게이트가 무력해진다.
// 현재값이 상한보다 2KB 넘게 낮아지면(대폭 감축) 상한도 함께 조여 실효 유지하라는 신호.
test("상한 헤드룸이 과도하지 않다(게이트 실효성)", () => {
  const bytes = statSync(CORE).size;
  const headroom = CEILING_BYTES - bytes;
  assert.ok(
    headroom >= 0 && headroom <= 2048,
    `헤드룸 ${headroom} bytes. 상한이 현재값(${bytes})보다 2KB 넘게 크면 one-in-one-out이 무력해진다 — ` +
    `대폭 감축했다면 CEILING_BYTES도 함께 낮춰 게이트를 조여라.`
  );
});
