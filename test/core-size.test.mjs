import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P6 코어 크기 상한(one-in-one-out) — 연구 F5(컨텍스트 활용률)·BMAD project-context lean 규칙 근거.
// 상시 주입 규칙의 팽창은 곧 모든 세션 비용 + 중간 규칙 희석(안전 캡슐 존재 이유). 이 테스트는 상한을
// 기계로 강제한다: 넘기려면 (a) 다른 규칙을 줄이거나(one-in-one-out), (b) 아래 상한 상수를 같은 커밋에서
// 올린다 — 후자는 한 줄 가시 diff라 리뷰어가 "코어가 또 커졌다"를 반드시 본다(침묵 팽창 차단).
// 계측 아님(정적 파일 크기 검사, 로컬 로깅·카운터 없음).
// 재현성: 개행을 LF로 정규화해 재므로 OS/checkout(CRLF)에 무관(+ .gitattributes eol=lf 이중 방어).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "src", "rules", "operating-rules.md");
const CODEX_ADDENDUM = join(ROOT, "src", "codex", "operating-rules-addendum.md");

function normBytes(p) {
  return Buffer.byteLength(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8");
}

// Claude 상시 주입 = operating-rules.md 단독. 현재 31,763 bytes 기준 소폭 여유(한 문장 남짓).
const CEILING_BYTES = 32000;
// Codex 상시 주입의 '규칙' 면 = operating-rules.md + addendum(Codex는 스킬 본문도 인라인하지만
// 그건 지연로드 기능 콘텐츠라 별도 — 여기선 '규칙 우회면'만 잡는다). 코어 규칙을 addendum으로 옮겨
// Claude 상한을 우회하는 걸 막는다(pr-reviewer medium 반영). 현재 35,549 기준 소폭 여유.
const CODEX_CORE_CEILING = 35800;

test(`Claude 코어(operating-rules.md)가 상한 ${CEILING_BYTES} bytes 이하 — 팽창은 one-in-one-out`, () => {
  const bytes = normBytes(CORE);
  assert.ok(
    bytes <= CEILING_BYTES,
    `operating-rules.md = ${bytes} bytes > 상한 ${CEILING_BYTES}. ` +
    `코어는 매 세션 상시 주입이라 팽창은 모든 세션 비용·규칙 희석을 부른다. ` +
    `다른 규칙을 줄여 상쇄하거나(one-in-one-out), 정말 필요하면 CEILING_BYTES를 현재값+2KB 이내로만 올리되 ` +
    `커밋에 "왜 코어가 커져야 하나 + 스킬 위임 검토" 근거를 남겨라.`
  );
});

test(`Codex 규칙면(operating-rules + addendum)이 상한 ${CODEX_CORE_CEILING} bytes 이하 — addendum 우회 차단`, () => {
  const bytes = normBytes(CORE) + normBytes(CODEX_ADDENDUM);
  assert.ok(
    bytes <= CODEX_CORE_CEILING,
    `operating-rules.md + addendum = ${bytes} bytes > 상한 ${CODEX_CORE_CEILING}. ` +
    `코어 규칙을 addendum으로 옮겨 Claude 상한을 우회해도 Codex 상시 주입은 그대로 커진다 — ` +
    `이 합산 상한이 그 우회를 막는다. 규칙 총량을 줄이거나 CODEX_CORE_CEILING을 근거와 함께 올려라.`
  );
});

// 상한이 실효(현재값에 붙어 있음)인지 — 헤드룸이 과도하면 게이트가 무력해진다.
test("상한 헤드룸이 과도하지 않다(게이트 실효성)", () => {
  const claude = CEILING_BYTES - normBytes(CORE);
  const codex = CODEX_CORE_CEILING - (normBytes(CORE) + normBytes(CODEX_ADDENDUM));
  for (const [name, headroom] of [["Claude", claude], ["Codex", codex]]) {
    assert.ok(
      headroom >= 0 && headroom <= 2048,
      `${name} 헤드룸 ${headroom} bytes. 상한이 현재값보다 2KB 넘게 크면 one-in-one-out이 무력해진다 — ` +
      `대폭 감축했다면 상한 상수도 함께 낮추고, 상한을 올릴 땐 현재값+2KB 이내로만(그 이상은 침묵 팽창 여지).`
    );
  }
});
