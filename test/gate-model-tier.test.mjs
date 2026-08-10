import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// R6 (Anthropic 강연 백로그): 게이트 모델이 조용히 노화해 일꾼보다 약해지는 걸 막는다.
// 설계 의도 = "검토 대상보다 최소 같거나 강한 독립 심판". 이 파일 머리의 정적 검사 두 가지:
//   1. 게이트(plan-validator·pr-reviewer)는 지정된 최상위 모델을 쓴다.
//   2. 일꾼(code-implementer)은 게이트보다 강한 티어가 아니다(심판≥일꾼).
// (이 둘이 전부가 아니다 — 아래 `런타임 강등 가드` 블록에 등급 순서 불변식·하한 래칫·호출 파라미터
//  강등 차단이 더 있다. 여기만 읽고 "이 파일은 frontmatter만 본다"로 넘기면 사본이 또 늘어난다.)
// 테스트가 볼 수 없는 것: 살아있는 메인 세션 모델(어떤 테스트도 이걸 못 읽는다). 사용자가 게이트 티어 위
// 모델을 메인으로 상시 돌리면 게이트가 메인보다 약해진다. v0.58.0이 코어 `# Model · execution routing`
// 절 원칙의 기준을 '메인 세션'에서 **'검토 대상(일꾼)'** 으로 옮겼다. 그래서 게이트가 메인보다 약한
// 상황은 이제 원칙 위반이 아니고, 뒤에 붙은 비용 우선 예외(`Omit \`model\` even if you outrank the
// gate`)가 그 선택을 명시적으로 승인한다. 그래서 이 테스트는
// **마이그레이션 체크포인트**다:
// 새 최상위 티어가 표준이 되면 TOP_TIER와 게이트 `model:`을 같은 커밋에서 함께 올려야 하고, 이 테스트가
// 둘을 lockstep으로 묶어 조용한 노화를 시끄러운 한 줄 diff로 바꾼다.
// (2026-07-18: Opus→Fable 마이그레이션. 2026-08-05 v0.44.0: 비용 사유로 Fable→Opus 복귀.)
// (계측 아님 — 정적 프론트매터 검사, 로컬 로깅·카운터 없음.)
const AGENTS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "agents");
// v0.42: 등급표 사본을 **줄인다.** 예전엔 이 파일에만 TIER가 있었고 훅은 그걸 볼 수 없었다 —
// 그래서 Task 호출의 `model` 파라미터로 게이트를 강등해도 아무도 안 막았다(실측 사례 있음).
// 이제 표는 core(pretooluse-core.js)에 있고 훅과 테스트가 **같은 원본**을 쓴다. 사본은 2개
// (core + 각 agent frontmatter)뿐이고, 아래 lockstep 테스트가 그 둘을 묶는다.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { GATE_MODEL_TIER: TIER, GATE_DEFAULT_MODEL, gateModelBlock } =
  require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
// v0.44.0: 게이트 심판 = **Opus**. (2026-07-18 v0.37.0에 Opus→Fable로 갔던 것을 되돌린 것이다.)
// 되돌린 사유는 **비용**: Anthropic 공지 "Fable 5 draws down usage faster than Opus 5" + 주간 한도 50% 상한.
// ⚠ 맞바꾼 것: Fable을 골랐던 근거는 **품질**이었다(통제 비교 3판 — 같은 집안 심판은 맹점 공유).
// 이제 Opus가 Opus를 심판하므로 그 맹점 공유가 돌아온다. 품질 저하가 관측되면 되돌릴 것.
// 상세·되돌림 조건: docs/plans/2026-08-05-gate-model-fable-to-opus.md
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

test("lockstep: core 등급표의 게이트 기본 모델 == 각 agent frontmatter의 model:", () => {
  for (const [gate, want] of Object.entries(GATE_DEFAULT_MODEL)) {
    assert.equal(modelOf(gate + ".md"), want,
      `core의 GATE_DEFAULT_MODEL[${gate}]와 frontmatter가 어긋남 — 둘을 같은 커밋에서 함께 올려라`);
  }
  assert.equal(GATE_DEFAULT_MODEL["plan-validator"], TOP_TIER, "게이트 기본은 최상위 티어여야 함");
  assert.ok(TIER[TOP_TIER], "TOP_TIER가 등급표에 있어야 함");
});

// ── v0.42(9번): 런타임 강등 가드 ─────────────────────────────────────────────
// 위 테스트들은 **정적 frontmatter만** 본다. 그런데 Task/Agent 호출의 `model` 파라미터가 그걸 덮어쓴다 —
// 실측: 한 세션이 plan-validator를 `model:"opus"`로 띄웠고(당시 frontmatter는 fable) **아무 층도 안 막았다**.
// (v0.44.0에 게이트가 Opus로 돌아와 그 호출 자체는 이제 기본 동작이다. 지금 막을 강등은 sonnet·haiku 쪽.)
// 근거 원본 = src/hooks/pretooluse.js의 `gateModelBlock` 호출부와 pretooluse-core.js의 같은 함수
// (줄 번호 대신 심볼로 가리킨다 — 소스가 밀려도 안 어긋나게).
// (v0.49.0 Codex 삭제 때 함께 날아간 것을 되살렸다. 원문에 소스 실측 세부를 덧붙인 형태이고,
//  배치도 원문 자리(lockstep 테스트 위)가 아니라 gateModelBlock을 쓰는 이 블록 위로 옮겼다.)
//
// ⚠ 이 블록은 **손으로 케이스를 쓰지 않는다** — 기대값을 TIER 표에서 파생시킨다.
// 왜: TOP_TIER 마이그레이션 때 리터럴을 손으로 갈아끼우면, 뒤집는 김에 진짜 강등 케이스까지
// 통과로 만들어도 전 테스트가 green이라 **가드가 조용히 죽는다**(v0.44.0 plan-validator medium).
// 파생 루프 + 비공허 단언이면 그 실수가 성립 자체를 못 한다.
// 네임스페이스 4종 축은 유지한다 — 떨어뜨리면 gateOf의 네임스페이스 무관 매칭이 무검증이 된다.
const SUBAGENT_FORMS = ["plan-validator", "chageun:plan-validator", "pr-reviewer", "honclwd:pr-reviewer"];

test("런타임 강등 가드: 기대값을 TIER 표에서 파생 — 낮은 티어만 차단, 동급이상은 통과", () => {
  let blocked = 0, passed = 0;
  for (const sub of SUBAGENT_FORMS) {
    for (const m of Object.keys(TIER)) {
      const want = TIER[m] < TIER[TOP_TIER] ? "gate-model-downgrade" : null;
      assert.equal(gateModelBlock("Task", { subagent_type: sub, model: m }), want,
        `Task ${sub} model=${m} (TIER ${TIER[m]} vs TOP ${TIER[TOP_TIER]})`);
      assert.equal(gateModelBlock("Agent", { subagent_type: sub, model: m }), want,
        `Agent ${sub} model=${m}`);
      want ? blocked++ : passed++;
    }
  }
  // 비공허: 차단되는 조합이 하나도 없으면 가드가 죽은 것이다(전부 통과여도 위 루프는 green).
  assert.ok(blocked > 0, "차단되는 모델이 0개 — 가드가 무력화됨(TOP_TIER가 최하위인가?)");
  assert.ok(passed > 0, "통과하는 모델이 0개 — 오차단 0 요건 위반");
});

// ⚠ 파생 루프의 사각을 닫는 핀(v0.44.0 pr-reviewer medium): 위 루프는 기대값을 **구현이 쓰는 바로
// 그 표**에서 뽑으므로, 표의 **값**을 조작하면 기대와 구현이 함께 움직여 전부 green이 된다.
// (예: core에서 `sonnet: 2`를 `3`으로 바꾸면 sonnet 게이트가 통과되는데 366개 테스트가 다 초록.)
// 구 테스트는 `sonnet → 차단`을 리터럴로 박아 이걸 잡았는데 파생으로 바꾸며 그 핀이 사라졌다.
// 숫자가 아니라 **이름 순서**로 단언해 미래 재넘버링(10·20·30 등)도 견디게 한다.
test("순서 불변식: haiku < sonnet < opus < fable — 등급표 값 조작 차단", () => {
  assert.ok(TIER.haiku < TIER.sonnet, `haiku(${TIER.haiku}) < sonnet(${TIER.sonnet}) 위반`);
  assert.ok(TIER.sonnet < TIER.opus, `sonnet(${TIER.sonnet}) < opus(${TIER.opus}) 위반`);
  assert.ok(TIER.opus < TIER.fable, `opus(${TIER.opus}) < fable(${TIER.fable}) 위반`);
});

test("하한 래칫: 게이트 기본은 최소 Opus 이상 — sonnet·haiku까지 내려가는 표류 차단", () => {
  assert.ok(TIER[TOP_TIER] >= TIER.opus,
    `TOP_TIER(${TOP_TIER}, 티어 ${TIER[TOP_TIER]})가 opus(${TIER.opus}) 아래 — 심판이 일꾼 수준으로 추락. ` +
    `비용 절감을 이유로 여기서 더 내리지 말 것(v0.44.0에 fable→opus까지가 합의된 하한).`);
});

test("런타임 강등 가드: 오차단 0 — 미명시·비게이트·미지값은 통과", () => {
  const G = { subagent_type: "chageun:plan-validator" };
  assert.equal(gateModelBlock("Task", G), null, "모델 미명시 = frontmatter 상속 → 정상");
  assert.equal(gateModelBlock("Task", { ...G, model: "" }), null, "빈 문자열도 미명시");
  assert.equal(gateModelBlock("Task", { ...G, model: TOP_TIER }), null, "동급");
  assert.equal(gateModelBlock("Task", { ...G, model: TOP_TIER.toUpperCase() }), null, "대소문자 무관");
  assert.equal(gateModelBlock("Task", { ...G, model: "fable" }), null, "상위 티어 → 통과");
  // 문서화된 한계(신규 아님): 등급표에 없는 값은 fail-open이라 **풀 ID 강등은 못 잡는다**.
  assert.equal(gateModelBlock("Task", { ...G, model: "claude-sonnet-5" }), null, "모르는 값 → fail-open");
  assert.equal(gateModelBlock("Task", { subagent_type: "chageun:code-implementer", model: "sonnet" }), null, "게이트 아님");
  assert.equal(gateModelBlock("Task", { subagent_type: "general-purpose", model: "haiku" }), null, "게이트 아님");
  assert.equal(gateModelBlock("Bash", { command: "git status" }), null, "Task/Agent 아님");
  assert.equal(gateModelBlock("Task", {}), null, "subagent_type 없음");
});

test("런타임 강등 가드: 차단 문구가 대처법과 탈출구를 알린다", () => {
  const { reasonFor } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
  const msg = reasonFor("gate-model-downgrade");
  assert.ok(msg.includes("model"), "무엇을 고쳐야 하는지");
  assert.ok(msg.includes("CHAGEUN_ALLOW_GATE_MODEL=1"), "락아웃 방지 탈출구를 알려야 함");
});
