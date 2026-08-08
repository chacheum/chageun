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
// planScaleBlock 은 히트 **배열**을 돌려준다(크기·회차를 각각 승인받게 하려고).
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

test("회차를 프롬프트에서 읽는다", () => {
  assert.equal(call("재검증 회차: 5\ndocs/plans/small.md").key, "plan-rounds");
});
test("회차 4는 통과(5회째에서 막힌다)", () => {
  assert.equal(call("재검증 회차: 4\ndocs/plans/small.md"), null);
});
test("회차는 파일 앞 20줄만 본다(본문 인용에 자기 차단 안 됨)", () => {
  const f = { "docs/plans/q.md": "머리\n".repeat(30) + "재검증 회차: 9\n" };
  assert.equal(planScaleBlock("Task", { subagent_type: "plan-validator", prompt: "docs/plans/q.md" },
    { readFile: (r) => f[r] }), null);
});
// 크기 승인 하나가 회차 상한까지 열면 안 된다 — 둘 다 돌려주고 각각 승인받게 한다.
test("크기와 회차가 둘 다 걸리면 둘 다 돌려준다(크기 먼저)", () => {
  const h = hits("재검증 회차: 9\ndocs/plans/big.md");
  assert.deepEqual(h.map((x) => x.key), ["plan-size", "plan-rounds"]);
});
test("잰 파일과 줄수를 함께 돌려준다(오차단을 바로 알아보게)", () => {
  assert.equal(call("docs/plans/big.md").measured, "docs/plans/big.md(4021줄)");
});

test("승인 키에 측정값이 들어가 범위가 생긴다", () => {
  assert.notEqual(bigPlanKey("docs/plans/big.md", "plan-size", 4020),
                  bigPlanKey("docs/plans/big.md", "plan-size", 9000));
  assert.equal(call("docs/plans/big.md").detail, bigPlanKey("docs/plans/big.md", "plan-size", 4021));
});
test("승인 키는 경로가 아니라 파일 이름으로 만든다(표기가 바뀌어도 유효)", () => {
  assert.equal(bigPlanKey("docs/plans/big.md", "plan-size", 4021),
               bigPlanKey("/abs/x/docs/plans/big.md", "plan-size", 4021));
});
test("승인 버킷 경계: 위로만 열리고 아래로는 안 새어 나간다", () => {
  assert.equal(bigPlanKey("a.md", "plan-size", 3001), bigPlanKey("a.md", "plan-size", 3999));
  assert.notEqual(bigPlanKey("a.md", "plan-size", 3999), bigPlanKey("a.md", "plan-size", 4001));
});
test("실측 기준선: 잘 끝난 계획 크기(2,560줄)는 안 걸린다", () => {
  assert.ok(PLAN_MAX_LINES > 2560);
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
test("회차를 양쪽에서 읽으라고 적혀 있다", () => {
  assert.match(PV(), /계획서 머리와 호출 프롬프트 양쪽에서 읽는다/);
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
// 문구에 "3,000줄"·"5회째"를 손으로 적어 뒀다. 상수만 바꾸면 문구가 조용히 거짓말을 한다.
test("차단문의 숫자가 상수와 같다", () => {
  const size = core.reasonFor("plan-size");
  const rounds = core.reasonFor("plan-rounds");
  assert.ok(size.includes(core.PLAN_MAX_LINES.toLocaleString("en-US")),
    `plan-size 문구에 ${core.PLAN_MAX_LINES} 이 없다`);
  assert.ok(rounds.includes(`${core.PLAN_MAX_ROUNDS}회째`),
    `plan-rounds 문구에 ${core.PLAN_MAX_ROUNDS}회째 가 없다`);
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
