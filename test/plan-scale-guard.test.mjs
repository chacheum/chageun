// v0.53.0 계획 규모 가드. 실측 근거: 4,020줄 계획이 10회 넘게 재검증되며 코드 0줄.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("../src/hooks/pretooluse-core.js");
const { planScaleBlock, planPathsInPrompt, bigPlanKey, PLAN_MAX_LINES } = core;

const F = {
  "docs/plans/big.md": "a\n".repeat(4020),
  "docs/plans/small.md": "b\n".repeat(1785),
  "docs/plans/2026-08-01-홈캘린더-보기개선-1차.md": "c\n".repeat(4000),
};
const opts = { readFile: (rel) => { if (!(rel in F)) throw new Error("ENOENT"); return F[rel]; } };
// planScaleBlock 은 히트 **배열**을 돌려준다(축이 늘어도 축마다 따로 승인받게 하려고).
const hits = (prompt, sub = "chageun:plan-validator") =>
  planScaleBlock("Task", { subagent_type: sub, prompt }, opts);
const call = (prompt, sub) => { const h = hits(prompt, sub); return h ? h[0] : null; };

test("한글 이름 계획서도 경로로 잡힌다", () => {
  assert.deepEqual(planPathsInPrompt("계획서: docs/plans/2026-08-01-홈캘린더-보기개선-1차.md 검증해줘"),
    ["docs/plans/2026-08-01-홈캘린더-보기개선-1차.md"]);
});

// 3회차 게이트 high: 왼쪽 경계가 없으면 아래 셋이 어긋난 경로를 만들어 가드가 조용히 꺼졌다.
test("여는 괄호·마크다운 링크·붙임 라벨에서도 경로가 정확히 잡힌다", () => {
  assert.deepEqual(planPathsInPrompt("[계획서](docs/plans/big.md)"), ["docs/plans/big.md"]);
  assert.deepEqual(planPathsInPrompt("계획서:docs/plans/big.md"), ["docs/plans/big.md"]);
  assert.deepEqual(planPathsInPrompt("`docs/plans/big.md` 검증"), ["docs/plans/big.md"]);
});

test("후보가 여럿이면 전부 모은다", () => {
  assert.deepEqual(planPathsInPrompt("docs/plans/small.md 와 docs/plans/big.md"),
    ["docs/plans/small.md", "docs/plans/big.md"]);
});

// "가장 긴 경로"가 아니라 "읽어서 가장 큰 것"으로 판정해야 참고용 옛 계획서에 안 속는다.
test("참고로 언급된 짧은 경로가 함께 있어도 큰 계획을 잡는다", () => {
  const r = call("계획서: docs/plans/big.md (지난 계획 docs/plans/some-very-long-name-plan.md 참고)");
  assert.equal(r.key, "plan-size");
  assert.match(r.detail, /big\.md/);
});

test("큰 계획이면 막는다", () => { assert.equal(call("계획서: docs/plans/big.md").key, "plan-size"); });
test("한글 이름 큰 계획도 막는다", () => {
  assert.equal(call("docs/plans/2026-08-01-홈캘린더-보기개선-1차.md").key, "plan-size");
});
test("상한 아래는 통과", () => { assert.equal(call("docs/plans/small.md"), null); });
test("게이트가 아니면 검사 안 함", () => { assert.equal(call("docs/plans/big.md", "general-purpose"), null); });
test("경로를 못 찾으면 막지 않는다", () => { assert.equal(call("계획 검증해줘"), null); });
test("readFile 미주입이면 판정하지 않는다(코어 순수 계약)", () => {
  assert.equal(planScaleBlock("Task", { subagent_type: "plan-validator", prompt: "docs/plans/big.md" }), null);
});

test("잰 파일과 줄수를 함께 돌려준다(오차단을 바로 알아보게)", () => {
  // 4,020 (4021 아님) — 개행으로 끝나는 파일의 끝 빈 조각은 안 센다(4회차 low).
  assert.equal(call("docs/plans/big.md").measured, "잰 파일 docs/plans/big.md(4020줄)");
});

test("승인 키에 측정값이 들어가 범위가 생긴다", () => {
  assert.notEqual(bigPlanKey("docs/plans/big.md", 4020),
                  bigPlanKey("docs/plans/big.md", 9000));
  assert.equal(call("docs/plans/big.md").detail, bigPlanKey("docs/plans/big.md", 4020));
});
test("승인 키는 경로가 아니라 파일 이름으로 만든다(표기가 바뀌어도 유효)", () => {
  assert.equal(bigPlanKey("docs/plans/big.md", 4021),
               bigPlanKey("/abs/x/docs/plans/big.md", 4021));
});
test("승인 버킷 경계: 위로만 열리고 아래로는 안 새어 나간다", () => {
  assert.equal(bigPlanKey("a.md", 3001), bigPlanKey("a.md", 3999));
  assert.notEqual(bigPlanKey("a.md", 3999), bigPlanKey("a.md", 4001));
});
// ⚠ 2026-08-09 정정. 이 테스트는 원래 "잘 끝난 계획 크기(2,560줄)는 안 걸린다"였는데,
//   그 성질은 **거짓**이다 — 알려진 성공 최대는 3,651줄이고 현행 문턱은 3,000이라 걸린다.
//   틀린 숫자(2,560)를 쓰고 있었기 때문에만 초록이었다. 즉 팀이 거짓임을 아는 성질을
//   기계가 계속 보증하고 있었다(pr-reviewer 2차 medium).
//   지금 상태를 사실대로 잠근다. 문턱을 3,700 이상으로 올리면 이 테스트가 빨개져서
//   "그 결정을 했다"는 것을 그 자리에서 상기시킨다 — 그게 이 테스트의 값이다.
test("알려진 성공 최대(3,651줄)가 현행 문턱에 걸린다", () => {
  assert.ok(
    PLAN_MAX_LINES < 3651,
    "문턱을 3,651 이상으로 올렸다면 이 테스트를 지우지 말고 사실에 맞게 고쳐라 — " +
      "실측 성공 5건(3,017 · 3,080 · 3,456 · 3,523 · 3,651)과 실측 사고 1건(4,043)의 " +
      "사이 틈이 392줄뿐이라, 그 틈에 문턱을 두는 것은 사고 한 건에 자를 맞추는 일이다"
  );
});

// ---- 승인 통로 (Task 2) ----
const ask = (key) => ({ type: "tool_use", id: "t1", name: "AskUserQuestion",
  input: { questions: [{ question: `계획이 큽니다 ${key}`, multiSelect: false,
    options: [{ label: "쪼갠다" }, { label: "이 크기로 진행" }] }] } });
const res = (key) => ({ type: "tool_result", tool_use_id: "t1", is_error: false,
  content: `${JSON.stringify(`계획이 큽니다 ${key}`)}=${JSON.stringify("이 크기로 진행")}` });
const tr = (key) => [{ message: { content: [ask(key)] } }, { message: { content: [res(key)] } }];
const K = "[chageun-big-plan:big.md:4k]";

test("사용자가 실제로 고른 승인만 통과", () => {
  assert.equal(core.approvedBigPlan(tr(K), K).approved, true);
});
test("질문만 있고 응답이 없으면 승인 아님", () => {
  assert.equal(core.approvedBigPlan([{ message: { content: [ask(K)] } }], K).approved, false);
});
test("다른 계획의 승인은 안 쓰인다", () => {
  assert.equal(core.approvedBigPlan(tr("[chageun-big-plan:other.md:4k]"), K).approved, false);
});
test("계획이 더 커지면 이전 승인이 안 통한다(유효 범위)", () => {
  assert.equal(core.approvedBigPlan(tr(K), "[chageun-big-plan:big.md:9k]").approved, false);
});
test("기존 컴포넌트 승인은 공유 헬퍼로 뽑은 뒤에도 그대로 동작한다", () => {
  const ck = "[chageun-design-variant:button:ghost]";
  assert.equal(core.approvedDesignVariant(tr(ck), "button", "ghost").approved, true);
  assert.equal(core.approvedDesignVariant(tr(ck), "button", "solid").approved, false);
});

// ---- plan-validator.md 문구 (Task 4) ----
import { readFileSync } from "node:fs";
const PV = () => readFileSync(new URL("../src/agents/plan-validator.md", import.meta.url), "utf8");

// 문자열 존재만 보면 고무도장이 된다. **두 문턱이 역할로 갈렸는지**를 잰다.
test("보고 문턱 400은 그대로고, 하드 차단 3,000은 따로 있다고 적혀 있다", () => {
  const md = PV();
  assert.match(md, /대략 400줄을 넘거나/);                        // :136 보고 문턱 유지
  assert.match(md, /400줄 아래면 이 축으로 아무 말도 하지 않는다/); // v0.50.0 억제 조건 보존
  assert.match(md, /진행을 실제로 막는 문턱은 3,?000줄/);          // 하드 차단은 별개라고 명시
});
test("부풀림 축의 발동 조건이 규모 보고와 함께 살아 있다", () => {
  assert.match(PV(), /위 규모 보고가 켜졌을 때/);
  assert.equal(PLAN_MAX_LINES, 3000);   // 훅 상한과 문서의 보고 문턱이 다른 숫자임을 고정
});
test("큰 계획을 얕게 보라는 지시가 없다", () => {
  assert.doesNotMatch(PV(), /전부를 같은 깊이로 보려 하지 말고/);
});
test("정직 고지 앵커가 살아 있다", () => {
  const md = PV();
  assert.match(md, /얕게 본 부분을 명시/);
  assert.match(md, /조용한 축소는 금지/);
});
// 회차 소스 규칙은 §재검증 회차와 수렴 **한 곳**이 정본이다. 5회차 medium: 계획 규모 가드 절에
//   소스 둘짜리 축약본을 하나 더 뒀다가, 셋째 소스(개정 로그 절 개수)가 빠져 가장 흔한 경우
//   (양쪽 다 비어 있음)에 "1차"로 읽히게 됐다. 사본을 지우고 정본만 앵커로 잡는다.
test("회차 소스 규칙은 정본 한 곳에만 있다(셋 중 큰 쪽)", () => {
  const md = PV();
  assert.match(md, /회차 파악 \(셋을 보고 큰 쪽을 쓴다\)/);
  assert.doesNotMatch(md, /계획서 머리와 호출 프롬프트 양쪽에서 읽는다/);
});
test("새 점검 항목이 있다", () => { assert.match(PV(), /실행하면 바로 아는 값/); });

// ---- 차단된 게이트 호출을 "검증함"으로 치지 않는다 (pr-reviewer 1회차 high) ----
const planEdit = () => ({ message: { content: [{ type: "tool_use", id: "e1", name: "Write",
  input: { file_path: "docs/plans/x.md" } }] } });
const gateSpawn = (id) => ({ message: { content: [{ type: "tool_use", id, name: "Task",
  input: { subagent_type: "chageun:plan-validator", prompt: "docs/plans/x.md" } }] } });
const gateResult = (id, isError) => ({ message: { content: [{ type: "tool_result",
  tool_use_id: id, is_error: isError, content: isError ? "차단" : "GO" }] } });

test("정상적으로 돌아간 게이트는 검증으로 친다(리마인더 안 뜸)", () => {
  const objs = [planEdit(), gateSpawn("g1"), gateResult("g1", false)];
  assert.equal(core.planReminderNeeded(objs, "Write", { file_path: "src/a.ts" }), false);
});
test("훅에 막힌 게이트 호출은 검증으로 안 친다(리마인더가 살아난다)", () => {
  const objs = [planEdit(), gateSpawn("g1"), gateResult("g1", true)];
  assert.equal(core.planReminderNeeded(objs, "Write", { file_path: "src/a.ts" }), true);
});
test("막힌 뒤 다시 불러 성공하면 검증으로 친다", () => {
  const objs = [planEdit(), gateSpawn("g1"), gateResult("g1", true), gateSpawn("g2"), gateResult("g2", false)];
  assert.equal(core.planReminderNeeded(objs, "Write", { file_path: "src/a.ts" }), false);
});

test("지난 회차 지적도 프롬프트에서 찾으라고 적혀 있다", () => {
  assert.match(PV(), /지난 회차 지적은 계획서 머리 또는 호출 프롬프트의/);
});

// ---- 문턱 숫자가 차단문과 상수에서 어긋나지 않게 (3회차 low) ----
// 문구에 "3,000줄"을 손으로 적어 뒀다. 상수만 바꾸면 문구가 조용히 거짓말을 한다.
// 문구는 **세 벌**이다(사람·서브에이전트·무인). 한 벌만 재면 나머지 둘이 조용히 거짓말한다.
// ⚠ 사람용 갈래만 `includes` 로는 못 잡는다(3회차 medium). 그 문구엔 이제 문턱(3,000) 말고
//   **알려진 성공 구간 상단(3,700)** 도 들어 있어서, 문턱을 3,700 으로 올리면 뒤 숫자 덕분에
//   `includes` 가 그냥 통과한다. 서브에이전트·무인 두 벌만 빨개지고, 그 둘을 고쳐 초록으로
//   만든 순간 **사람이 보는 첫 문장만 "3,000줄을 넘습니다"인 채로 남는다.**
//   그래서 사람용은 첫 문장을 정확히 본다.
test("차단문 세 벌의 문턱 숫자가 상수와 같다", () => {
  const size = core.PLAN_MAX_LINES.toLocaleString("en-US");
  assert.match(
    core.reasonFor("plan-size"),
    new RegExp("^차단: 계획서가 " + size + "줄을 넘습니다"),
    `사람용 plan-size 첫 문장의 문턱이 ${size} 이 아니다 — 다른 숫자(성공 구간 상단 등)가 ` +
      "문구 어딘가에 있어도 이 검사는 통과하지 않는다"
  );
  for (const [label, text] of [
    ["서브에이전트", core.reasonFor("plan-size", true)],
    ["무인", core.reasonForUnattended("plan-size")],
  ]) assert.ok(text.includes(size), `${label} plan-size 문구에 ${size} 이 없다`);
  // 사람용 문구엔 문턱 말고 **알려진 성공 구간 상단(3,700)** 도 손으로 적혀 있다. 문턱이 거기 닿으면
  //   "3,700줄 아래면 그 구간엔 잘 끝난 계획도 있으니"와 "그보다 크면 쪼개는 쪽을 먼저 권합니다"가
  //   둘 다 뜻을 잃는다(그 아래는 이제 안 막히므로). 주석은 빌드를 못 깨니 도장을 하나 박는다(4회차 low).
  //   ⚠ 이 단언은 "알려진 성공 최대(3,651줄)가 현행 문턱에 걸린다" 테스트(< 3651)에 포섭돼
  //   **단독으로는 안 울린다** — 값은 문턱을 올리며 그 테스트를 사실에 맞게 고쳐 초록으로 만든
  //   **뒤에도** 한 번 더 걸리는 두 번째 알림이라는 점이다. "중복이네" 하고 지우지 말 것(5회차 low).
  assert.ok(core.PLAN_MAX_LINES < 3700,
    "문턱이 3,700 이상이면 사람용 차단문의 '3,700줄 아래면' 문장이 뜻을 잃는다 — 그 문장도 함께 고쳐라");
});

// v0.56.0: 이 가드의 프레임을 잠근다. 값은 "예측기가 아니라 동의 관문"이라는 것 하나인데,
//   그걸 지키는 게 주석의 🛑 경고뿐이면 빌드를 못 깬다. 위 "정직 고지 앵커가 살아 있다" 테스트가
//   이미 같은 방식으로 산문을 앵커한다(저장소 관례). 표현을 다듬을 때 함께 고쳐야 하는 것은
//   노린 효과다.
// ⚠ **단언마다 그 문장에만 걸리는지 실제로 확인한다 — 눈으로 세지 말고 돌려서.** 6·7회차 실화:
//   게이트가 "`/검증 결과를 믿기 어려/` 가 차단문 세 곳에 걸려 첫 문장을 지워도 초록"이라고 했고
//   나도 그걸 확인했다며 좁혔는데, **둘 다 틀렸다.** (나)와 예문은 `어렵…` 활용형이고 둘째 음절
//   `렵`(U+B835)은 `려`(U+B824)가 아니라, 옛 정규식도 첫 문장 하나에만 걸렸다. 내 "확인"은 `reasonFor()` 결과가 아니라
//   **소스 파일 전체**에 정규식을 대본 것이었다(서브에이전트 문구·주석이 걸려 true 가 나왔다).
//   측정 대상을 제품 함수로 고정하면 이 착오는 안 난다.
test("차단문이 예측 주장이 아니라 동의 관문으로 말한다", () => {
  const human = core.reasonFor("plan-size");
  assert.match(human, /이 크기가 실패한다는 뜻이 아닙니다/,
    "예측 프레임('이 크기면 실패한다')으로 되돌아가면 성공 사례 5건(3,017~3,651줄, 전부 출하)이 " +
      "즉시 반례가 되고, 회차 축을 '표본 한 자릿수'로 기각한 것과 이중 잣대가 된다");
  // 굵게 표시(`**`)는 안 잠근다 — 뜻이 그대로인 서식 손질에 빨간불이 뜨면 앵커가 "정규식만 고치면
  //   되는 것"으로 닳는다(7회차 low). `어려워지므로` 활용형 하나로 첫 문장이 이미 특정된다.
  assert.match(human, /검증 결과를 믿기 어려워지므로/,
    "멈추는 이유(검증을 믿기 어렵다)가 첫 문장에서 빠지면 남는 건 '크니까 막는다'뿐이라 근거가 " +
      "사고 1건짜리 일화로 되돌아간다");
  assert.match(human, /알려진 사례 밖이라 쪼개는 쪽을 먼저 권합니다/,
    "3,700 초과 갈래의 처방이 빠지면 3,200줄과 6,000줄이 같은 온도로 읽힌다(1회차 medium A)");
  assert.match(human, /왜 멈췄는지/,
    "승인 질문에 '왜 멈췄는지'를 적으라는 요구가 빠지면 사용자 화면엔 안심 쪽 절반만 도착해 " +
      "승인이 고무도장이 된다(1회차 medium B)");
  // 6회차 low: 프레임을 세 벌(사람·서브에이전트·무인) 중 한 벌만 잠그면, 서브에이전트 문구가
  //   길다고 앞 절을 잘려도 아무 테스트가 안 울린다. 서브에이전트는 사용자 화면이 없어 본 세션
  //   보고가 유일한 통로다.
  const sub = core.reasonFor("plan-size", true);
  assert.match(sub, /이 크기가 실패한다는 뜻이 아닙니다/,
    "서브에이전트 문구가 예측 프레임으로 돌아가면 본 세션 보고에 '실패할 크기라 막혔다'가 실린다");
  assert.match(sub, /`잰 파일`의 이름과 줄 수를 그대로 옮기세요/,
    "잰 파일을 옮기라는 지시가 빠지면 본 세션에 남는 것은 '막혔다'뿐이라 사용자가 판단할 재료가 없다");
  assert.match(sub, /검증 결과를 믿기 어려워 사람이 정합니다/,
    "서브에이전트 문구도 '왜 멈추는가'를 잠근다 — 사람용만 잠그면 세 벌 중 한 벌만 지켜진다(7회차 low)");
});

// 4회차 low: 개행으로 끝나는 파일을 1 크게 세어 정확히 3,000줄인 계획서가 "초과"로 막혔다.
test("개행으로 끝나도 줄 수를 정확히 센다 — 딱 3,000줄은 안 막힌다", () => {
  const exact = { readFile: () => "x\n".repeat(core.PLAN_MAX_LINES) };
  assert.equal(planScaleBlock("Task", { subagent_type: "plan-validator",
    prompt: "계획서: docs/plans/exact.md" }, exact), null);
  const over = { readFile: () => "x\n".repeat(core.PLAN_MAX_LINES + 1) };
  const h = planScaleBlock("Task", { subagent_type: "plan-validator",
    prompt: "계획서: docs/plans/over.md" }, over);
  assert.equal(h[0].key, "plan-size");
  assert.match(h[0].measured, new RegExp(`\\(${core.PLAN_MAX_LINES + 1}줄\\)`));
});

// ---- 경로 후보를 미리 거르지 않는다 (3회차 medium: 굵게 쓴 절대경로를 통째로 놓쳤다) ----
test("굵게 표시한 절대경로도 후보에 들어간다", () => {
  const found = core.planPathsInPrompt("계획서: **/home/me/proj/docs/plans/big.md** 를 검증");
  assert.ok(found.includes("/home/me/proj/docs/plans/big.md"),
    `벗긴 절대경로가 후보에 없다: ${JSON.stringify(found)}`);
});

test("한글 폴더가 앞에 와도 원본이 후보에 남는다", () => {
  const found = core.planPathsInPrompt("계획서: 한글폴더/plans/개편계획.md");
  assert.ok(found.includes("한글폴더/plans/개편계획.md"),
    `원본 경로가 후보에 없다: ${JSON.stringify(found)}`);
});

test("후보 상한을 넘기지 않는다", () => {
  const many = Array.from({ length: 40 }, (_, i) => `**docs/plans/p${i}.md**`).join(" ");
  assert.ok(core.planPathsInPrompt(many).length <= 20);
});
