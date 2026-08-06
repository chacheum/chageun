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

test("부기 문자열에 긴 줄표를 쓰지 않는다", () => {
  for (const [name, doc] of GATES) {
    const found = doc.match(/\([0-9N]차 [^)]*\)/g) || [];
    assert.ok(found.length > 0, `${name}에 부기 문자열 예시가 없다`);
    for (const s of found) assert.ok(!s.includes("—"), `${name} 부기에 긴 줄표: ${s}`);
  }
});
