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
function normBytes(p) {
  return Buffer.byteLength(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8");
}

// Claude 상시 주입 = operating-rules.md 단독. batch6 다이어트 + batch7 영어화 기준으로 하향.
// 2026-07-27 +140 (17500→17640): "접기"(맞지만 사소한 low를 한 줄로 묶어 보고) 규칙. v0.38.0이 게이트의
// 억제 지시를 없애 "전부 올려라"로 바꿨는데, 그 정당화였던 "메인이 걸러준다"의 필터가 실제로는 없었다
// (수신 규율은 틀린 발견의 기각만 정의). Fable 독립 감사 medium. 분량 압박에 안전 단서를 깎지 않기로 해
// 상향(plan-validator CONDITIONAL 조건 4): 반드시 남길 5개 = medium 이상 금지 · 개수+종류 표기 ·
// 애매하면 접지 않기 · 접기는 기각 아님(요청 시 전체) · 대조 확인 면제 아님.
// 2026-08-07 +309 (17640→17949): 게이트 재검증 회차의 **쓰기 규칙** 신설(v0.46.0).
// 초안 +187에 pr-reviewer 반영분 +122: 마커를 번역하지 말 것(영어 세션에서 조용히 꺼짐) ·
// 지적 제목은 직전 회차 것만(누적하면 계획서가 커져 다음 검증기가 새 지적을 내는 되먹임을 규칙이 먹임) ·
// **통과하면 마커를 지운다**(GO 난 계획서를 이어 쓸 때 남은 옛 숫자가 새 작업의 첫 검증을 N차로 만들고,
// "모르면 붙인다"와 겹쳐 없는 루프에 표시·finding이 붙는다 — pr-reviewer medium).
// v0.42.0이 넣은 수렴 가드는 읽는 쪽(plan-validator·codex 미러)만 있었고, 그 회차를 적으라는 규칙이
// src 어디에도 없었다(grep 실측) — 아무도 안 적으면 게이트는 영구히 1차로 보고 규칙이 한 번도 안 켜진다.
// 스킬 위임 검토: 재검증은 routing·formats가 안 떠 있는 자리에서 일어나고, PreToolUse 리마인더는
// 세션당 1회성(pretooluse-core.js가 첫 게이트 후 validated를 굳힘)이라 상시 바닥 외에 도달 경로가 없다.
// 이 변경분 단독 델타다(작업 트리에 다른 미커밋 변경 0건인 상태에서 측정 — plan-validator 4차 H-3).
// 2026-08-07 +252 (17949→18201): **코드 재리뷰** 회차의 쓰기 규칙 신설(v0.48.0). 바로 앞 문장
// (plan-validator 재검증)과 어순을 맞춘 한 문장이다. 담은 것 넷 = verbatim(영어 세션에서 번역돼
// 조용히 꺼지는 것 방지) · 마커 `재리뷰 회차: N` · 지난 회차 blocker/high 제목(그 회차만) ·
// 계수 기준과 범위(count every review, first = 1 / a different change restarts at 1).
// 뒤 둘이 없으면 쓰는 쪽과 읽는 쪽이 한 칸 어긋난다(plan-validator 3차 H-2) — 읽는 쪽은 "모든 리뷰를
// 세고 최초가 1차"로 세는데 쓰는 쪽이 "고쳐 다시 낸 것만" 세면 넘기는 숫자가 다르다.
// **왜 스킬이 아니라 코어인가**: finish-check는 저발동 실측이 있고(honclwd 제외 10개 프로젝트 중 1회),
// routing은 지연로드라 코어보다 발동 신뢰도가 낮으며, Codex에선 둘 다 인라인 procSkill이라 총면
// 비용이 같다. 이 규칙은 v0.42.0 실패("읽는 쪽만 있어 2,941회 중 0회 발동")의 처방이라 가장 확실한 자리에 둔다.
// **왜 릴레이(리뷰어 출력 꼬리로 다음 회차를 넘김)가 아닌가** (plan-validator 2차 H-2): 도착 시점이
// N회차 끝인데 행동 시점은 N+1회차 시작이라 그 사이 수정 사이클·압축·세션 교체를 지나야 하고,
// 이전 리뷰어의 숫자를 베끼는 홉 체인이라 한 홉만 끊기면 영구히 1로 돌아가며 복구 경로가 없다.
// plan-validator와 조건이 다른 이유: 계획 검증은 회차 소스 3개 중 2개가 계획서 파일에 앵커되지만
// 코드 리뷰의 대상은 diff라 그 2개가 통째로 없다 — 남는 건 호출 프롬프트뿐이다.
// 이 변경분 단독 델타다(작업 트리에 다른 미커밋 변경 0건인 상태에서 측정).
const CEILING_BYTES = 18201;

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

// 상한이 실효(현재값에 붙어 있음)인지 — 헤드룸이 과도하면 게이트가 무력해진다.
test("상한 헤드룸이 과도하지 않다(게이트 실효성)", () => {
  const claude = CEILING_BYTES - normBytes(CORE);
  for (const [name, headroom] of [["Claude", claude]]) {
    assert.ok(
      headroom >= 0 && headroom <= 2048,
      `${name} 헤드룸 ${headroom} bytes. 상한이 현재값보다 2KB 넘게 크면 one-in-one-out이 무력해진다 — ` +
      `대폭 감축했다면 상한 상수도 함께 낮추고, 상한을 올릴 땐 현재값+2KB 이내로만(그 이상은 침묵 팽창 여지).`
    );
  }
});
