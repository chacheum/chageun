// 게이트 재검증 회차 표시(v0.46.0) 배선 테스트.
//
// 이 기능의 실패 모드는 "규칙은 있는데 한 번도 안 켜짐"이다. 그래서 단순히 문장이 있나만 보지 않고,
// 쓰는 쪽(코어)과 읽는 쪽(양 플랫폼 게이트)이 **같은 문자열로 이어져 있는지**를 양방향으로 잰다.
// 4차 게이트 H-1: 조건은 넣었는데 그 조건을 판정할 데이터를 아무도 안 남기면 기능이 조용히 꺼진다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const core = read("src/rules/operating-rules.md");
const pv = read("src/agents/plan-validator.md");
const codex = read("src/codex/gate-agents.md");
const GATES = [["plan-validator", pv], ["codex gate-agents", codex]];

// v0.48.0: 코드 리뷰 회차(pr-reviewer)도 같은 방식으로 잰다.
const pr = read("src/agents/pr-reviewer.md");

// gate-agents.md는 plan-validator·pr-reviewer·code-implementer 지시문이 한 파일에 있다.
// plan-validator 문단(:113)이 회차 리터럴 7개를 이미 갖고 있어서, 파일 전체 includes로 단언하면
// pr-reviewer 절이 통째로 없어도 초록이 난다(실측). 반드시 절을 잘라서 본다.
function slice(doc, startNeedle, endNeedle, label) {
  const s = doc.indexOf(startNeedle);
  assert.ok(s >= 0, `${label}: '${startNeedle}' 앵커가 깨졌다`);
  const e = endNeedle === null ? doc.length : doc.indexOf(endNeedle, s + 1);
  // indexOf가 -1이면 slice(-1)이 마지막 한 글자를 돌려줘 길이 가드가 무의미해진다.
  assert.ok(
    e > s,
    endNeedle === null
      ? `${label}: 시작 앵커가 문서 끝에 있어 자를 내용이 없다`
      : `${label}: '${endNeedle}' 경계가 깨졌다`
  );
  return doc.slice(s, e);
}
// 지연 계산한다: top-level에서 slice를 돌리면 앵커 하나가 깨졌을 때 모듈 로드가 통째로 실패해
// 이 파일의 다른 테스트(plan-validator 회귀 포함)가 전부 안 돌고, "앵커 하나 깨짐"이 화면엔
// "전부 안 돌았음"으로 보여 진단이 흐려진다(pr-reviewer 1차 low).
const codexPr = () => slice(codex, "## pr-reviewer 지시문", "## code-implementer 지시문", "codex");
const PR_GATES = () => [["pr-reviewer", pr], ["codex pr-reviewer 절", codexPr()]];

test("슬라이스 가드: codex pr-reviewer 절이 plan-validator 문단을 안 물고 온다", () => {
  const seg = codexPr();
  assert.ok(seg.length < codex.length, "슬라이스가 파일 전체다");
  assert.ok(
    !seg.includes("재검증 회차"),
    "pr-reviewer 절 슬라이스에 plan-validator의 회차 마커가 섞였다 — 이후 단언이 전부 위약이 된다"
  );
});

test("쓰기 측: 코어가 재검증 시 회차를 적으라고 지시한다", () => {
  assert.match(
    core,
    /재검증 회차: N/,
    "코어에 쓰기 규칙이 없으면 게이트는 영구히 1차로 보고 이 규칙이 한 번도 안 켜진다(v0.46.0 이전 상태)"
  );
});

test("쓰기 측: 지난 회차 지적도 함께 남기게 한다(4차 H-1)", () => {
  assert.match(
    core,
    /previous round's blocker\/high titles/,
    "지난 회차 지적을 안 남기면 게이트가 '새 것이냐 반복이냐'를 판정할 근거가 없다"
  );
});

test("읽기 측: 양 플랫폼이 코어가 쓰는 그 문자열을 회차 소스로 읽는다", () => {
  for (const [name, doc] of GATES) {
    assert.match(doc, /재검증 회차: N/, `${name}이 코어가 쓰는 마커를 안 읽는다(쓰기-읽기 단절)`);
  }
});

test("회차 계수 기준이 양 플랫폼에 못박혀 있다(문턱 밀림 방지)", () => {
  for (const [name, doc] of GATES) {
    assert.match(
      doc,
      /모든 검증을 세고 최초 검증이/,
      `${name}에 계수 기준이 없다 — '첫 검증이 1'인지 '첫 재검증이 1'인지 갈리면 3차 문턱이 4차로 밀린다`
    );
  }
});

test("값이 엇갈리면 큰 쪽(스테일 헤더가 규칙을 끄는 것 차단)", () => {
  for (const [name, doc] of GATES) {
    assert.match(doc, /큰 쪽/, `${name}에 엇갈릴 때 규칙이 없다`);
    assert.match(doc, /개정 로그 절 개수로 추정/, `${name}에 두 번째 소스가 없다`);
  }
});

test("판정 형식 절이 회차 표시를 예외로 허용한다", () => {
  const start = pv.indexOf("### 3. 진행 권고");
  const end = pv.indexOf("판단 기준:");
  assert.ok(start >= 0 && end > start, "형식 절 앵커를 못 찾음 — 이 테스트의 앵커를 갱신하라");
  const fmt = pv.slice(start, end);
  assert.match(fmt, /예외/, "형식 절이 '정확히 한 줄만'을 못박은 채면 표시가 실제로 안 붙는다");
  assert.match(fmt, /매회 새 지적/, "허용되는 표시 형태가 형식 절에 안 적혀 있다");
});

test("CONDITIONAL 해제 조건 줄이 형식 예외에 막히지 않는다(4차 M-3)", () => {
  assert.match(
    pv,
    /어떤 조건을 충족해야 GO인지 한 줄 추가/,
    "CONDITIONAL 조건 줄 요구가 사라졌다 — 코어가 그 조건을 끝 점검 채점 항목으로 등록하게 돼 있다"
  );
  assert.match(
    pv,
    /판정 줄에 아무것도 덧붙이지 않는다/,
    "제한이 '판정 줄'이 아니라 '판정' 단위로 넓게 적히면 CONDITIONAL 조건 줄까지 금지로 읽힌다"
  );
});

test("모를 때의 기본값이 '붙인다'로 뒤집혀 있다(4차 H-1 핵심)", () => {
  for (const [name, doc] of GATES) {
    assert.match(
      doc,
      /알 수 없으면 새 것으로 보고 표시를 붙인다/,
      `${name}의 기본값이 침묵이면, 판정 근거가 없는 일반적인 경우에 기능이 통째로 꺼진다`
    );
  }
});

test("오탐 가드: 같은 blocker 반복이면 표시를 안 붙인다", () => {
  for (const [name, doc] of GATES) {
    assert.match(
      doc,
      /같은 blocker의 반복이면 표시를 붙이지 않는다/,
      `${name}에 오탐 가드가 없으면 수렴 중인 루프에도 표시가 붙는다`
    );
  }
});

test("반복형 루프도 카운터를 남긴다(4차 M-1)", () => {
  for (const [name, doc] of GATES) {
    assert.match(
      doc,
      /어느 쪽이든 3차 이상일 때/,
      `${name}에서 반복형 루프가 1차와 구분이 안 된다 — 반복형도 안 끝나는 루프다`
    );
  }
});

// pr-reviewer medium 4건. 전부 "알림이 차단으로 번지는" 한 방향의 사고다.
test("회차 finding이 판정을 밀어 올리지 못한다(pr-reviewer M-1)", () => {
  for (const [name, doc] of GATES) {
    assert.match(
      doc,
      /low~medium으로만/,
      `${name}: 회차 finding에 등급 상한이 없으면 게이트가 high로 달 수 있고, 판정이 최고 severity를 ` +
        `반영하므로 GO가 CONDITIONAL로 밀린다 — 드디어 통과하는 자리에서 다시 멈춘다`
    );
    assert.match(
      doc,
      /이번 회차가 깨끗하면/,
      `${name}: 수렴 완료(blocker·high 0)에도 회차 finding이 붙으면 통과가 통과로 안 끝난다`
    );
  }
});

test("과잉 차단 방지 절이 양 플랫폼에 있다(pr-reviewer M-2 · 미러 표류)", () => {
  for (const [name, doc] of GATES) {
    assert.match(
      doc,
      /그것만을 이유로 판정을 올리지/,
      `${name}: 이 절이 한쪽에만 있으면 같은 계획이 플랫폼에 따라 다른 판정을 받는다`
    );
  }
});

test("Codex도 CONDITIONAL 해제 조건을 적게 한다(pr-reviewer M-3)", () => {
  assert.match(
    codex,
    /어떤 조건을 충족해야 GO인지/,
    "Codex에 조건 줄 요구가 없으면, 코어가 사용자 승인·끝 점검 항목으로 등록할 대상이 비어 버린다"
  );
});

test("통과하면 회차 표시를 지운다(pr-reviewer M-4 · 스테일 숫자 차단)", () => {
  assert.match(
    core,
    /clear it once the plan reaches GO/,
    "리셋 규칙이 없으면 GO 난 계획서를 이어 쓸 때 남은 옛 숫자가 새 작업의 첫 검증을 N차로 만들고, " +
      "'모르면 붙인다'와 겹쳐 없는 루프에 표시와 finding이 붙는다. " +
      "'통과'가 아니라 GO여야 한다. 코어 :42가 CONDITIONAL을 멈춤으로 정의하므로 " +
      "CONDITIONAL을 통과로 읽고 지우면 그 계획의 회차 세기가 영영 꺼진다(되살릴 백스톱 없음)"
  );
});

test("영어 세션에서 마커를 번역해 버리지 않게 못박는다", () => {
  assert.match(
    core,
    /verbatim marker/,
    "코어는 영어인데 게이트가 찾는 건 한국어 리터럴이라, 번역하면 에러 없이 규칙만 조용히 꺼진다"
  );
});

test("안전 불변식: 회차 표시가 blocker를 면제하지 않는다", () => {
  for (const [name, doc] of GATES) {
    assert.match(doc, /3차 도달이 blocker를 면제하지/, `${name}에 면제 금지 절이 없다`);
  }
});

test("판정 리터럴 소비처가 그대로다(괄호 부기가 기존 배선을 안 깬다)", () => {
  assert.match(core, /plan-validator \*\*NO-GO\/CONDITIONAL\*\*/, "코어 멈춤 배선의 앵커가 깨졌다");
  assert.match(
    read("src/skills/unattended-loop/SKILL.md"),
    /NO-GO면 \*\*park\*\*/,
    "무인 정지선 리터럴이 깨졌다 — 여기가 풀리면 사람 없이 도는 루프가 안 멈춘다"
  );
});

// v0.47.0 C: 쓰기-읽기 배선의 나머지 반쪽. 코어는 회차 **숫자** 옆에 지난 회차 blocker/high 제목도
// 적게 하는데, v0.46.0의 게이트 두 벌은 숫자의 소스 3개만 열거하고 그 **제목 목록**을 어디서 찾는지
// 안 알려줬다. 오탐 가드("같은 것의 기준")가 자기 데이터에 못 닿으면 같은 지적 반복도 "매회 새 지적"이 된다.
// 느슨한 사이간격(`[^.]*` 등)을 안 쓰는 이유: 넓으면 문서 딴 곳의 두 조각이 우연히 이어져 가짜 초록이
// 되고, 좁으면 문장 안 마침표 하나에 영구 빨간불이 된다. 고정 조각을 리터럴로 잠근다.
test("읽기 측이 지난 회차 지적의 출처를 안다(쓰기-읽기 양방향 완성)", () => {
  for (const [name, doc] of GATES) {
    assert.match(doc, /`재검증 회차: N` 옆에 적힌/,
      `${name}: 코어가 제목을 적게 해놓고 게이트에 어디서 찾는지 안 알려주면, ` +
      `오탐 가드가 자기 데이터에 못 닿아 같은 지적 반복도 "매회 새 지적"으로 표시된다`);
  }
});

test("부기 문자열에 긴 줄표를 쓰지 않는다", () => {
  // v0.48.0: 이 테스트만 pr-reviewer를 함께 돈다. 공용 GATES에 넣으면 plan-validator 전용
  // 리터럴을 도는 다른 테스트들이 pr-reviewer에서 전부 깨진다.
  for (const [name, doc] of [...GATES, ["pr-reviewer", pr]]) {
    const found = doc.match(/\([0-9N]차 [^)]*\)/g) || [];
    assert.ok(found.length > 0, `${name}에 부기 문자열 예시가 없다`);
    for (const s of found) assert.ok(!s.includes("—"), `${name} 부기에 긴 줄표: ${s}`);
  }
});

// ── v0.48.0: 코드 리뷰 회차(pr-reviewer) ─────────────────────────────────────
// plan-validator와 조건이 다르다. 계획 검증은 회차 소스 3개 중 2개가 계획서 파일에 앵커되지만,
// 코드 리뷰의 대상은 diff라 그 2개가 통째로 없다. 남는 건 호출 프롬프트뿐이라 쓰는 쪽이 더 중요하다.

test("쓰기 측: 코어가 코드 재리뷰 회차도 적으라고 지시한다", () => {
  assert.match(core, /재리뷰 회차: N/,
    "코어에 쓰기 규칙이 없으면 pr-reviewer는 영구히 1차로 보고 이 규칙이 한 번도 안 켜진다 " +
    "(v0.42.0이 정확히 이 실패를 했다: 읽는 쪽만 있어 2,941회 중 0회 발동)");
});

// 200자 창(window)으로 근접만 보면 verbatim이 옆 문장 것이어도 초록이고, "지난 회차 지적" 절반은
// 아예 안 잠긴다. 세 조각을 하나의 인접 리터럴로 단언한다.
test("쓰기 측: 마커·번역금지·지난 회차 지적이 한 문장에 함께 있다", () => {
  assert.ok(
    core.includes("verbatim marker `재리뷰 회차: N` + the previous round's blocker/high titles"),
    "세 조각이 한 문장에 붙어 있어야 한다. verbatim이 없으면 영어 세션에서 번역돼 규칙이 조용히 " +
    "꺼지고, previous가 없으면 이번 회차 것으로 읽혀 지난 회차 제목 자리가 빈다"
  );
});

// 쓰는 쪽에 계수 기준이 없으면, 읽는 쪽이 "모든 리뷰를 세고 최초가 1차"로 세는 동안 쓰는 쪽은
// "고친 뒤 다시 낸 것만" 세어 한 칸 어긋난 숫자를 넘긴다. 범위도 같은 이유로 쓰는 쪽에 있어야 한다.
test("쓰기 측: 계수 기준과 범위가 코어에 함께 있다", () => {
  assert.ok(core.includes("count every review, first = 1"),
    "계수 기준이 쓰는 쪽에 없으면 읽는 쪽과 한 칸 어긋난다");
  assert.ok(core.includes("a different change restarts at 1"),
    "범위가 쓰는 쪽에 없으면 한 브랜치에 쌓인 다른 작업의 첫 리뷰에 이어진 숫자가 넘어간다");
});

test("두 카운터가 섞이지 않는다(계획 회차 ≠ 코드 리뷰 회차)", () => {
  assert.ok(!pr.includes("재검증 회차"),
    "pr-reviewer가 계획 검증용 마커를 자기 회차 소스로 지목하면, 계획서 머리의 숫자를 코드 리뷰 회차로 읽는다");
});

test("읽기 측: 양 플랫폼 pr-reviewer가 재리뷰 회차를 센다", () => {
  for (const [name, doc] of PR_GATES()) {
    assert.match(doc, /재리뷰 회차: N/, `${name}: 쓰기 마커를 읽는 쪽이 없다`);
    assert.match(doc, /모든 리뷰를 세고 최초 리뷰가 1차/, `${name}: 계수 기준이 없다`);
    assert.match(doc, /검토 대상 기능이 바뀌면 1차/,
      `${name}: 범위 규칙이 없다. 없으면 한 브랜치에 쌓인 다른 작업의 첫 리뷰에도 "3차" 경고가 붙는다`);
    assert.match(doc, /인라인으로 실행 중이면/,
      `${name}: Codex 인라인 모드 계수 경로가 없다. 없으면 그 플랫폼에서 규칙이 영구히 1차다`);
    assert.match(doc, /알 수 없으면 새 것으로 보고 표시를 붙인다/,
      `${name}: 기본값 반전이 없다. 모를 때 침묵하면 규칙이 영영 안 켜진다`);
    // 코어가 쓰는 두 조각 중 "지난 회차 지적" 쪽은 읽는 규칙이 그 출처를 지목해야 배선이 닫힌다.
    assert.ok(doc.includes("`재리뷰 회차: N` 옆에 적힌"),
      `${name}: 지난 회차 지적의 출처 지목이 없다. 코어가 제목을 적어 보내도 읽는 쪽이 어디서 찾을지 ` +
      `모르면 "알 수 없음"으로 떨어져 매번 새 것으로 처리된다`);
    assert.match(doc, /\(N차 · 매회 새 지적\)/,
      `${name}: 본문의 부기 지시가 없다(출력 형식 절의 \`(3차 …)\` 예시와 다른 문자열이다)`);
    // 오탐 가드. 이게 빠지면 수렴 중인 루프에 매번 경고가 붙는다. plan-validator 쪽은 이미 잠겨 있어
    // 미러에서만 조용히 갈릴 수 있는 자리다.
    assert.match(doc, /같은 지적의 반복이면 표시를 붙이지 않는다/,
      `${name}: 반복 지적 오탐 가드가 없다`);
    assert.match(doc, /엇갈리면 큰 쪽을 쓴다/, `${name}: 소스 충돌 해소 규칙이 없다`);
    assert.match(doc, /셋 다 없으면 1차/, `${name}: 소스가 하나도 없을 때의 기본값이 없다`);
    // pr-reviewer 1차 medium 1: "큰 쪽"과 "범위" 사이 우선순위가 없으면 한 가지 자연스러운 독법
    // ("프롬프트엔 3, 내 범위 판단은 1, 엇갈리니 큰 쪽 3")이 범위 규칙을 통째로 무력화한다.
    // 그 독법은 G16의 반대 방향 칸(회차를 적되 다른 기능 diff → 부기 안 붙음)과 정면 충돌한다.
    assert.match(doc, /범위가 다르면 다른 소스의 숫자가 아무리 커도 1차다/,
      `${name}: 범위와 큰-쪽 사이 우선순위가 없다. 없으면 오탐 방지가 자기 회귀 테스트와 어긋난다`);
  }
});

test("읽기 측: 회차 표시가 판정을 올리는 장치가 아니다(안전 불변식)", () => {
  for (const [name, doc] of PR_GATES()) {
    assert.match(doc, /그것만을 이유로 판정을 올리지/, `${name}: 판정 상향 금지 절이 없다`);
    assert.match(doc, /3차 도달이 blocker를 면제하지/, `${name}: 면제 금지 절이 없다`);
    assert.match(doc, /low~medium으로만/, `${name}: finding severity 상한이 없다`);
    assert.match(doc, /이번 회차가 깨끗하면/, `${name}: 수렴 시 억제 절이 없다`);
  }
});

// 부기 예외는 **출력 형식 절 안에** 있어야 한다. 본문에만 있으면 나중에 형식 절의 예외 문구만
// 지워져도 초록이 유지되고, 그러면 형식이 다시 부기를 금지해 표시가 안 붙는다.
// ⚠ 이 배치만으로는 부족하다는 실측이 있다 — 원본 plan-validator는 예외를 이미 형식 절 안에 갖고도
// 조건을 만족한 세 회차(2026-08-07)에서 부기가 0회 붙었다. 셋 다 판정이 CONDITIONAL인데 원본 예시는
// NO-GO 하나뿐이라, **예시의 판정 단어를 적용 조건으로 읽는 것**이 유력한 원인이다. 그래서 미러는
// 예시를 둘 주고 "판정이 무엇이든"을 못 박는다 — 아래 세 번째 단언이 그 문구를 잠근다.
test("부기가 출력 형식 절 안에서 유일한 예외로 명시된다", () => {
  const segs = [
    ["pr-reviewer", slice(pr, "## 3. 최종 권고", "## 도구 제한", "pr-reviewer")],
    ["codex pr-reviewer 절", slice(codexPr(), "## 3. 최종 권고", "변경 규모가 클 때", "codex 판정 절")],
  ];
  for (const [name, seg] of segs) {
    assert.match(seg, /예외/, `${name}: 판정 형식 절에 예외 명시가 없다`);
    assert.match(seg, /\(3차 · 매회 새 지적\)/, `${name}: 판정 형식 절에 부기 예시가 없다`);
    assert.match(seg, /판정이 무엇이든/,
      `${name}: 예시의 판정 단어가 조건으로 읽힌다. 원본 규칙이 3회 연속 이 이유로 안 켜진 것으로 보인다`);
  }
});
