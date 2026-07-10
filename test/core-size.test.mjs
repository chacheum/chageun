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
// activate-codex.mjs가 인라인하는 절차 스킬 — 아래 drift 가드가 실제 소스와 일치를 강제한다.
const PROC_SKILLS = ["finish-check", "spec-gate", "run-verify", "routing"];

function normBytes(p) {
  return Buffer.byteLength(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8");
}
function procSkillBytes() {
  return PROC_SKILLS.reduce((n, s) => n + normBytes(join(ROOT, "src", "skills", s, "SKILL.md")), 0);
}

// Claude 상시 주입 = operating-rules.md 단독. batch6 다이어트(라우팅 절→스킬)로 하향.
const CEILING_BYTES = 30000;
// Codex 상시 주입의 '규칙' 면 = operating-rules.md + addendum. 코어 규칙을 addendum으로 옮겨
// Claude 상한을 우회하는 걸 막는다(pr-reviewer medium 반영).
const CODEX_CORE_CEILING = 34000;
// Codex 상시 주입 '총면' = 규칙면 + 인라인 절차 스킬 본문. batch6가 규칙→스킬 이동을 시작하면서
// "스킬로 옮기면 두 상한 다 빠져나간다"는 새 우회로가 생겼다 — 이 합산 상한이 그 우회를 막는다
// (Claude는 스킬이 지연로드라 이 면이 없고, Codex만 인라인이라 총면이 실체다).
const CODEX_TOTAL_CEILING = 56000;

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

test(`Codex 총면(규칙면 + 인라인 절차 스킬)이 상한 ${CODEX_TOTAL_CEILING} bytes 이하 — 스킬 인라인 우회 차단`, () => {
  const bytes = normBytes(CORE) + normBytes(CODEX_ADDENDUM) + procSkillBytes();
  assert.ok(
    bytes <= CODEX_TOTAL_CEILING,
    `규칙면 + 인라인 스킬 = ${bytes} bytes > 상한 ${CODEX_TOTAL_CEILING}. ` +
    `코어 규칙을 인라인 절차 스킬로 옮기면 Claude·Codex 규칙면 상한을 다 피하지만 Codex 상시 주입은 그대로 커진다 — ` +
    `이 합산 상한이 그 우회를 막는다. 총량을 줄이거나 근거와 함께 상한을 올려라.`
  );
});

// PROC_SKILLS 목록이 activate-codex.mjs의 실제 인라인 목록과 표류하면 총면 상한이 구멍난다.
test("PROC_SKILLS 목록이 activate-codex.mjs procSkills와 일치(표류 가드)", () => {
  const src = readFileSync(join(ROOT, "src", "hooks", "activate-codex.mjs"), "utf8");
  const m = /const procSkills = \[([^\]]*)\]/.exec(src);
  assert.ok(m, "activate-codex.mjs에서 procSkills 배열을 찾지 못함 — 이 테스트의 추출 정규식을 갱신하라");
  const actual = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert.deepEqual(actual, PROC_SKILLS);
});

// 상한이 실효(현재값에 붙어 있음)인지 — 헤드룸이 과도하면 게이트가 무력해진다.
test("상한 헤드룸이 과도하지 않다(게이트 실효성)", () => {
  const claude = CEILING_BYTES - normBytes(CORE);
  const codexFace = CODEX_CORE_CEILING - (normBytes(CORE) + normBytes(CODEX_ADDENDUM));
  const codexTotal = CODEX_TOTAL_CEILING - (normBytes(CORE) + normBytes(CODEX_ADDENDUM) + procSkillBytes());
  for (const [name, headroom] of [["Claude", claude], ["Codex 규칙면", codexFace], ["Codex 총면", codexTotal]]) {
    assert.ok(
      headroom >= 0 && headroom <= 2048,
      `${name} 헤드룸 ${headroom} bytes. 상한이 현재값보다 2KB 넘게 크면 one-in-one-out이 무력해진다 — ` +
      `대폭 감축했다면 상한 상수도 함께 낮추고, 상한을 올릴 땐 현재값+2KB 이내로만(그 이상은 침묵 팽창 여지).`
    );
  }
});
