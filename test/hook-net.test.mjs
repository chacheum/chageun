// test/hook-net.test.mjs — 안전 그물(F-29 · v0.65.0).
//
// 무엇을 재나: 차근의 안전 잠금이 도구 이름 `Task`·`Agent` 두 개에만 걸려 있던 것을 고친 뒤,
//   (1) 훅이 켜지는 범위가 **모든 도구**인가 (2) 스폰 판정이 **함수 한 곳**에 모였는가
//   (3) 차근이 못 읽는 통로(`Workflow`·`REPL`)가 게이트를 **닫기만 하고 열지 못하는가**
//   (4) 목록 밖 새 도구가 **조용하지 않되 시끄럽지도 않은가** (5) 무인 범위가 안 넓어졌는가.
//
// 픽스처에는 실제 프로젝트 이름·경로를 쓰지 않는다(test/identifier-leak.test.mjs 가 막는다).
//   합성 이름(`/repo`, `NewFangledTool`)만 쓴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpDir } from "./support-tmpdir.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = join(ROOT, "src", "hooks");
const HOOK = join(HOOKS_DIR, "pretooluse.js");
const core = require(join(HOOKS_DIR, "pretooluse-core.js"));
const { spawnIntent, hasPrReviewer, planReminderNeeded, reasonFor } = core;

// 부모 env 의 CHAGEUN_* 을 전부 지우고 시작한다(케이스별 주입).
const BASE = { ...process.env };
for (const k of Object.keys(BASE)) { if (k.startsWith("CHAGEUN_")) delete BASE[k]; }

// 훅을 한 번 돌린다. unattended:true 면 임시 작업트리에 유효 통과표를 심는다.
function runHook(input, { env = {}, unattended = false, rawInput = null } = {}) {
  const dir = tmpDir("hooknet-");
  const fullEnv = { ...BASE, ...env };
  if (unattended) {
    mkdirSync(join(dir, ".chageun"), { recursive: true });
    writeFileSync(join(dir, ".chageun", "token"), JSON.stringify({ nonce: "abc123" }));
    fullEnv.CHAGEUN_UNATTENDED = "1";
    fullEnv.CHAGEUN_UNATTENDED_TOKEN = "abc123";
    fullEnv.CHAGEUN_ROOT = dir;
  }
  const r = spawnSync(process.execPath, [HOOK], {
    input: rawInput === null ? JSON.stringify(input) : rawInput,
    env: fullEnv, cwd: dir, encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
}
// stdout JSON 의 additionalContext(없으면 "").
function contextOf(r) {
  if (!r.stdout.trim()) return "";
  try { return String(JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ""); } catch (_) { return ""; }
}

// 트랜스크립트 레코드 조립기.
const TU = (name, input, id) => ({ message: { content: [{ type: "tool_use", name, input, id }] } });
// 스폰 결과 레코드: 최상위 toolUseResult.agentId + content 에 tool_result 하나(1패스 조인 재료).
const RESULT = (agentId, toolUseId) => ({
  toolUseResult: { agentId },
  message: { content: [{ type: "tool_result", tool_use_id: toolUseId }] },
});
const EDIT = () => TU("Edit", { file_path: "/repo/src/a.js" });

// ── Step 1: 매처 불변식 ────────────────────────────────────────────────────
// 층1 — 훅이 켜지는 범위는 **모든 도구**다. 이름 목록은 판올림마다 사람이 따라가야 하고,
//   그 지연이 이 축이 고치는 문제다(부분일치 함정도 함께 사라진다).
test("F-29 층1: PreToolUse 매처가 모든 도구를 덮는다(빈 문자열)", () => {
  const cfg = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.claude.json"), "utf8"));
  assert.equal(cfg.hooks.PreToolUse.length, 1, "PreToolUse 등록은 한 벌이다");
  assert.equal(cfg.hooks.PreToolUse[0].matcher, "",
    '매처가 이름 목록이면 목록 밖 도구(Read·Workflow·SendMessage…)에서 훅이 통째로 안 돈다. PostToolUse 가 이미 ""다');
});

// ── Step 2: spawnIntent 표 ─────────────────────────────────────────────────
// 🛑 판정 순서가 곧 안전이다. `Workflow({script, agentType})` 처럼 두 조건이 겹칠 때
//    **opaque 가 이긴다** — readable 이 이기면 입력 칸 하나로 §4 불변식이 우회된다.
test("F-29 층2: spawnIntent 판정표(opaque 가 먼저 · readable 은 name/shape 로 갈린다)", () => {
  assert.deepEqual(spawnIntent("Agent", { subagent_type: "chageun:pr-reviewer" }),
    { kind: "readable", via: "name", agentType: "chageun:pr-reviewer" });
  assert.deepEqual(spawnIntent("Task", { subagent_type: "code-implementer" }),
    { kind: "readable", via: "name", agentType: "code-implementer" });
  // 성질로 잡는 갈래. 🛑 이 칸이 재는 것은 **spawnIntent 단독 판정**뿐이고,
  //   그 값이 **게이트를 여는 데 못 쓰인다**는 것은 아래 Step 2.5·Step 3 이 잰다.
  //   두 칸은 반드시 같이 있어야 한다 — 이 칸만 있으면 "성질이면 리뷰로 쳐도 된다"로 읽힌다.
  assert.deepEqual(spawnIntent("SomeFutureTool", { agentType: "pr-reviewer" }),
    { kind: "readable", via: "shape", agentType: "pr-reviewer" });
  assert.deepEqual(spawnIntent("Workflow", { script: "x", agentType: "chageun:pr-reviewer" }),
    { kind: "opaque", via: "name", agentType: "" }, "입력 칸이 도구 이름을 못 이긴다");
  assert.deepEqual(spawnIntent("Workflow", { name: "deep-research", args: {} }),
    { kind: "opaque", via: "name", agentType: "" }, "실제로 관측된 입력 모양");
  assert.deepEqual(spawnIntent("Workflow", { script: "…" }), { kind: "opaque", via: "name", agentType: "" });
  assert.deepEqual(spawnIntent("REPL", { code: "…" }), { kind: "opaque", via: "name", agentType: "" });
  assert.equal(spawnIntent("Read", { file_path: "/repo/a.js" }), null);
  assert.equal(spawnIntent("Bash", { command: "ls" }), null);
});

// ── Step 2.5: via 를 쓰는 쪽 불변식(여는 판정) ─────────────────────────────
// `via:"shape"` 는 호출하는 쪽이 입력 칸 하나로 만들어 낼 수 있다. 그래서 **게이트를 닫는 데만**
//   쓸 수 있고, 여는 데 쓰면 이름 문자열로 게이트를 여는 것과 위험이 같다.
const PLAN_EDIT = () => TU("Edit", { file_path: "docs/plans/x.md", old_string: "a", new_string: "b" });
test("F-29 여는 판정: 계획 검증 리마인더는 via:\"name\" 스폰만 '검증됨'으로 친다", () => {
  const code = { file_path: "/repo/src/a.js" };
  // 성질 통로: `아무도구({agentType:"plan-validator"})` 한 줄로는 리마인더가 안 꺼진다.
  const shape = [PLAN_EDIT(), TU("NewFangledTool", { agentType: "chageun:plan-validator" }, "tu_s")];
  assert.equal(planReminderNeeded(shape, "Edit", code), true,
    "성질 통로가 계획 검증 도장이 되면 검증 한 번 안 받은 계획이 구현으로 들어간다");
  // 대조(기존 동작 유지): 이름 통로는 그대로 인정된다.
  const named = [PLAN_EDIT(), TU("Task", { subagent_type: "chageun:plan-validator" }, "tu_n")];
  assert.equal(planReminderNeeded(named, "Edit", code), false, "이름 통로는 종전대로 검증 흔적이다");
});

// ── Step 3: 불변식 — 불투명 통로도 성질 통로도 게이트를 못 연다 ────────────
test("F-29 불변식: 불투명 통로는 리뷰 도장이 되지 않는다((a)·(b))", () => {
  // (a) Edit → pr-reviewer 스폰 → Workflow 호출. 리뷰 뒤에 불투명 통로가 왔다.
  //     불투명 호출은 lastCodeEdit 을 밀어야 한다 — 각본이 코드를 통째로 고쳤을 수 있다.
  assert.equal(hasPrReviewer([
    EDIT(), TU("Agent", { subagent_type: "chageun:pr-reviewer" }, "tu_a"),
    TU("Workflow", { name: "deep-research", args: {} }, "tu_w"),
  ]), false, "각본이 리뷰 뒤에 무엇을 고쳤는지 차근은 못 읽는다 — 리뷰를 최신으로 볼 수 없다");
  // (b) Edit → Workflow 호출만. 리뷰가 아예 없다.
  assert.equal(hasPrReviewer([EDIT(), TU("Workflow", { script: "x" }, "tu_w2")]), false);
  // 불투명 통로가 리뷰를 **대신하지도** 못한다(pr-reviewer 흔적이 없는 기록).
  assert.equal(hasPrReviewer([TU("Workflow", { name: "x", args: {} }, "tu_w3"), EDIT()]), false);
});

test("F-29 불변식: 성질 통로 직접 쓰기가 리뷰 도장이 되지 않는다((c))", () => {
  // `아무도구({agentType:"chageun:pr-reviewer"})` 한 줄로 검토받은 적 없는 코드가 도장을 달면 안 된다.
  assert.equal(hasPrReviewer([
    EDIT(), TU("SomeFutureTool", { agentType: "chageun:pr-reviewer" }, "tu_c"),
  ]), false, "성질 칸은 호출하는 쪽이 얹으면 그만이라 게이트를 여는 데 못 쓴다");
});

test("F-29 불변식: 1패스 맵 우회로도 막혀 있다((d) · SendMessage 조인)", () => {
  // (c)만 막고 이 길을 열어 두면, 맵(pretooluse-core.js hasPrReviewer 1패스)에 오른 성질 스폰이
  //   toolUseResult.agentId 와 조인돼 agentTypeById 에 앉고, SendMessage 한 통이 lastReview 를 민다.
  assert.equal(hasPrReviewer([
    TU("SomeFutureTool", { agentType: "chageun:pr-reviewer" }, "tu_d"),
    RESULT("agent_shape", "tu_d"),
    EDIT(),
    TU("SendMessage", { to: "agent_shape" }, "tu_msg"),
  ]), false, "성질 스폰은 1패스 맵에 오르지 않는다 — 오르면 쪽지 한 통이 리뷰 도장이 된다");
});

// 🛑 **이 판의 자물쇠가 무엇인지 이름에 적는다.** 게이트(6회차)가 `via:"shape"` 를 남기는 판단을
//    인정하면서 단서를 붙였다: 그 판단은 **1패스 맵이 이름 전용으로 남아 있다는 전제** 위에 선다.
test("F-29 자물쇠: 1패스 맵은 via:\"name\" 전용이다 — 이 한 줄이 성질 통로가 리뷰 도장이 되는 것을 막는다", () => {
  // (1) 이 칸이 **초록이어야** v0.46.0 이 살려 놓은 SendMessage 재검토 경로가 산다.
  //     그 전엔 Task/Agent 스폰만 세서, 재검토를 했는데도 정당한 push 가 두 번 막혔다.
  // (2) 1패스 맵(`hasPrReviewer` 의 typeByToolUseId 채우기)을 성질까지 넓히면 바로 위 (d) 가 빨개진다.
  //     그때 **고칠 것은 검사가 아니라 그 한 줄**이다.
  // (3) 이 자물쇠가 **못 막는 길이 하나 있다**: 런타임이 직접 실은 `toolUseResult.agentType` 은
  //     도구 이름을 한 번도 안 거치고 맵에 오른다(같은 파일 1패스의 `tur.agentType` 가지).
  //     T0 프로브가 쟀고 각본 발은 **지금 판 기준 0건**이라 오늘 그 길이 안 열려 있지만,
  //     그건 **런타임 표기에 달린 값**이라 이 자물쇠가 지켜 주는 것이 아니다.
  assert.equal(hasPrReviewer([
    TU("Task", { subagent_type: "chageun:pr-reviewer" }, "tu_r"),
    RESULT("agent_named", "tu_r"),
    EDIT(),
    TU("SendMessage", { to: "agent_named" }, "tu_msg2"),
  ]), true, "이 칸이 빨개지면 리뷰 비용을 한 번 더 물리는 옛 버그(v0.46.0 이전)가 되살아난 것이다");
});

// ── Step 4: 새 차단(서브에이전트의 불투명 통로 사용) ───────────────────────
test("F-29 층4: 서브에이전트의 불투명 통로 호출은 차단(subagent-opaque-spawn)", () => {
  const r = runHook({ agent_type: "deep-implementer", tool_name: "Workflow", tool_input: { name: "x", args: {} } });
  assert.equal(r.code, 2, "서브에이전트가 각본으로 게이트를 띄우면 훅이 그것을 게이트로 인정한다(T0 실측)");
  assert.equal(r.stderr.trim(), reasonFor("subagent-opaque-spawn", true).trim(), "사유 = subagent-opaque-spawn");
  // 같은 입력에서 agent_type 만 뺀 것 = 메인 세션 → 통과(결정 2번: 메인은 막지 않고 센다).
  assert.equal(runHook({ tool_name: "Workflow", tool_input: { name: "x", args: {} } }).code, 0,
    "메인 세션의 Workflow·REPL 은 정당한 도구다");
});

test("F-29 층4 문구: 서브에이전트에게 켤 수 없는 스위치·따라 할 우회를 안내하지 않는다", () => {
  const msg = reasonFor("subagent-opaque-spawn", true);
  assert.ok(msg.includes("BLOCKED"), "서브에이전트가 실제로 할 수 있는 행동(본 세션에 BLOCKED 보고)을 지정한다");
  assert.ok(!/환경변수|CHAGEUN_/.test(msg), "서브에이전트는 훅 프로세스의 환경변수를 못 켠다(deploy 문구의 실측 교훈)");
  assert.ok(!/사용자에게 (물어|여쭤)/.test(msg), "서브에이전트는 화면 질문을 못 띄운다");
  assert.ok(!/훅|설정 파일을 고/.test(msg), "읽는 쪽이 따라 할 수 있는 우회를 안내하지 않는다(gate-skip 4회차 교훈)");
});

// ── Step 5: 층3 — 목록 밖 새 도구가 조용하지 않다 · 그런데 시끄럽지도 않다 ──
test("F-29 층3: 목록 밖 스폰꼴 도구는 알리되 막지 않는다", () => {
  const r = runHook({ tool_name: "NewFangledTool", tool_input: { agentType: "x" } });
  assert.equal(r.code, 0, "모르는 도구를 막으면 판올림마다 사용자 작업이 멈춘다");
  assert.ok(contextOf(r).includes("NewFangledTool"), "알림에 그 도구 이름이 실제로 들어간다");
});

test("F-29 층3: 스폰꼴이 아닌 새 도구와 코드 칸을 든 MCP 도구는 조용히 지나간다", () => {
  const plain = runHook({ tool_name: "NewFangledTool", tool_input: { q: "x" } });
  assert.equal(plain.code, 0);
  assert.equal(contextOf(plain), "", "스폰꼴이 아니면 침묵(소음 방지)");
  // 🛑 `code`·`script` 를 열쇠에서 뺐다는 증거. 이 칸이 빨개지면 **공개 플러그인 사용자가
  //    호출마다 알림을 맞는** 상태로 되돌아간 것이다. dedup 이 없어(상태 파일 없음) 끌 방법이 없다.
  const mcp = runHook({ tool_name: "mcp__someuser__run_code", tool_input: { code: "x" } });
  assert.equal(mcp.code, 0);
  assert.equal(contextOf(mcp), "", "MCP 도구 이름은 사용자마다 달라 씨앗 목록이 원리적으로 못 따라간다");
});

test("F-29 층3: 씨앗 목록에 MCP 도구 이름이 하나도 없다", () => {
  // 씨앗은 **이 하네스가 내는 이름**만 덮는다. MCP 도구 이름은 사용자마다 달라 원리적으로 못 따라가고,
  //   실기록 census 에서 옮겨 담으면 **공개 플러그인에 이 컴퓨터의 도구 이름이 박힌다.**
  //   test/identifier-leak.test.mjs 는 픽스처를 보지 이 상수를 안 봐서 이 칸이 따로 필요하다.
  const { KNOWN_TOOLS } = require(join(HOOKS_DIR, "tool-ledger-core.js"));
  const mcp = [...KNOWN_TOOLS].filter((n) => n.startsWith("mcp__"));
  assert.deepEqual(mcp, [], "씨앗은 sdk-tools.d.ts 에서만 뽑는다(census 는 대조용)");
  assert.ok(KNOWN_TOOLS.has("Read") && KNOWN_TOOLS.has("Edit") && KNOWN_TOOLS.has("Write"),
    "선언의 스키마 이름(FileRead·FileEdit·FileWrite)이 아니라 실제로 오는 이름을 담아야 한다");
  assert.ok(!KNOWN_TOOLS.has("FileRead"), "스키마 이름으로 오기 시작하면 그날은 알림이 뜨는 편이 맞다");
});

// ── Step 6: 사본 없음 불변식 ───────────────────────────────────────────────
// 🛑 이 칸이 빨개졌을 때 옳은 대응은 **검사를 느슨하게 고치는 것이 아니라** 새로 생긴
//    정규식 사본을 지우는 것이다. 빨간불을 푸는 가장 쉬운 길이 검사를 넓히는 것이고,
//    그러면 이 축의 핵심 장치(판정이 한 곳에만 있다)가 사라진다.
//
// 🛑 **한계 — 이 검사는 정확한 리터럴만 본다.** 아래 셋은 초록으로 지나간다:
//    · `name === "Task" || name === "Agent"` 같은 **문자열 비교 사본**
//    · `/^(Bash|Task|Agent)$|…/i` 같은 **다른 모양의 정규식**(src/hooks/finish-work.js 가 이 모양이다)
//    · `new RegExp("^(Task|Agent)$")` 처럼 **런타임에 만든 것**
//    즉 이 칸이 초록이라고 "사본이 하나만 남았다"가 증명되지는 않는다.
//    **처방: 새로 스폰 판정이 필요하면 정규식을 새로 적지 말고 `spawnIntent` 를 부르라.**
test("F-29 판정이 한 곳에만 있다: /^(Task|Agent)$/ 리터럴은 spawnIntent 정의 1곳뿐", () => {
  const LITERAL = /\/\^\(Task\|Agent\)\$\//;
  const hits = [];
  for (const f of readdirSync(HOOKS_DIR).filter((n) => n.endsWith(".js"))) {
    const lines = readFileSync(join(HOOKS_DIR, f), "utf8").split("\n");
    lines.forEach((ln, i) => { if (LITERAL.test(ln)) hits.push(`${f}:${i + 1}`); });
  }
  assert.equal(hits.length, 1, "사본이 늘었다(또는 정의가 사라졌다): " + hits.join(", "));
  assert.match(hits[0], /^pretooluse-core\.js:/, "유일한 리터럴은 코어의 spawnIntent 정의여야 한다");
});

test("F-29 옛 매처 사본은 명시적 예외다(정규식 리터럴이 아니라 문자열 복사본)", () => {
  // LEGACY_UNATTENDED_SCOPE 는 hooks.claude.json 옛 매처의 **복사본**이고 꼬리가
  //   `…|confirm_cost|Task|Agent` 다. 스폰 판정과 무관하므로 위 칸의 리터럴 세기에 안 걸린다.
  const hits = [];
  for (const f of readdirSync(HOOKS_DIR).filter((n) => n.endsWith(".js"))) {
    if (readFileSync(join(HOOKS_DIR, f), "utf8").includes("confirm_cost")) hits.push(f);
  }
  assert.deepEqual(hits, ["pretooluse-core.js"], "옛 매처 문자열 사본은 한 곳(상수)에만 있다");
});

// ── Step 7: 무인 칸 네 개(결정 3번) ────────────────────────────────────────
// 🛑 **(가)가 빨개지면 예외가 너무 좁고, (다)가 빨개지면 무인이 유인보다 헐거워진 것.**
//    (가)·(나)는 둘 다 `u-mcp-write` 만 본다 — "무인이면 넓힌 판정을 통째로 건너뛴다"로 구현해도
//    둘 다 초록이라, 그 실수만 잡는 칸이 (다)다. (라)는 바깥 catch 가 fail-open 으로
//    뒤집혔는지를 잡는다(이름을 못 읽었으면 park 이 유지돼야 한다).
test("F-29 무인 (가): 그물을 넓혀 새로 도달한 갈래는 무인에서 안 막는다", () => {
  const r = runHook({ tool_name: "mcp__claude_ai_Google_Drive__create_file", tool_input: { name: "x" } }, { unattended: true });
  assert.equal(r.code, 0, "사용자 결정(2026-08-11): 무인 범위는 안 넓힌다");
});
test("F-29 무인 (나): 옛 매처에 닿던 기존 차단은 그대로 막힌다", () => {
  const r = runHook({ tool_name: "mcp__x__create_branch", tool_input: { name: "x" } }, { unattended: true });
  assert.equal(r.code, 2, "예외가 규칙 단위가 아니라 도달 단위로 잡혔다는 증거");
  assert.match(r.stderr, /파괴적 MCP 도구/, "사유 = u-mcp-write");
});
test("F-29 무인 (다): 무인이 유인보다 헐거워지지 않는다(불투명 차단은 무인에서도 산다)", () => {
  const r = runHook({ agent_type: "deep-implementer", tool_name: "Workflow", tool_input: { name: "x" } }, { unattended: true });
  assert.equal(r.code, 2, "무인 갈래를 함수 머리에서 조기 종료로 짜면 여기가 빨개진다");
  assert.equal(r.stderr.trim(), reasonFor("subagent-opaque-spawn", true).trim(), "사유 = subagent-opaque-spawn");
});
test("F-29 무인 (라): 도구 이름을 못 읽어도 park 한다(fail-closed 유지)", () => {
  const r = runHook(null, { unattended: true, rawInput: "{broken" });
  assert.equal(r.code, 2, "이 catch 가 잡는 대표 경우가 입력 JSON 파싱 실패이고, 그때 도구 이름은 아예 없다");
  assert.match(r.stderr, /판정 중 오류/, "사유 = u-error");
});
