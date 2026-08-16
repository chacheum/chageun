// 상황판 §2 를 기계가 쓰는 자리(v0.65.0 F-27 · T2c).
// 순수 함수는 직접 부르고, 배선은 `posttooluse.js` 에 stdin JSON 을 먹여 자식 프로세스로 돈다.
//
// 🛑 **임시 `XDG_CACHE_HOME` 은 빈 폴더로 준다.** `board-tasks` 를 미리 만들면 `mkdirSync`
//    누락이 안 잡히고, 새 사용자 기계에서만 조용히 안 도는 구멍이 그대로 남는다.
// 🛑 **누출 칸은 "안 나온다"를 재는 칸이라 원재료를 실제로 먹여야 한다.** 가짜 열쇠·가짜
//    경로·계정 사정이 붙은 꼬리를 입력에 넣고, 결과 파일에 없는 것을 확인한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { tmpDir } from "./support-tmpdir.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "src", "hooks", "posttooluse.js");
const core = require(join(HERE, "..", "src", "hooks", "statusboard-auto-core.js"));
const TEMPLATE = readFileSync(join(HERE, "..", "src", "skills", "statusboard", "board.template.md"), "utf8");

const BASE = { ...process.env };
for (const k of Object.keys(BASE)) { if (k.startsWith("CHAGEUN_")) delete BASE[k]; }

const GIT_ID = ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"];
function git(dir, args) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + " 실패: " + (r.stderr || r.stdout || ""));
}

let seq = 0;
function scene(opts = {}) {
  const dir = tmpDir("auto-");
  git(dir, ["init", "-q"]);
  if (opts.ignore !== false) appendFileSync(join(dir, ".git", "info", "exclude"), "status.md\n");
  const board = join(dir, "status.md");
  if (opts.board !== null) writeFileSync(board, opts.board === undefined ? TEMPLATE : opts.board);
  const tpath = join(dir, "t.jsonl");
  writeFileSync(tpath, opts.transcript || "");
  return { dir, board, tpath, cache: tmpDir("cache-"), key: "sess" + (++seq), state: null };
}
function fire(sc, extra = {}) {
  const input = {
    session_id: sc.key, transcript_path: sc.tpath, cwd: sc.dir,
    tool_name: extra.tool_name || "Bash",
    tool_input: extra.tool_input || { command: "ls" },
    tool_response: "ok",
  };
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    env: { ...BASE, XDG_CACHE_HOME: extra.cache || sc.cache },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
const stateOfScene = (sc) => JSON.parse(readFileSync(join(sc.cache, "chageun", "board-tasks", sc.key + ".json"), "utf8"));
const board = (sc) => readFileSync(sc.board, "utf8");

// ── 트랜스크립트 조각 만들기(실측 모양 그대로) ────────────────────────────────
//
// 🛑 **세 모양은 손으로 지어낸 것이 아니라 실측 전수 대조에서 나왔다**(2026-08-17 · 이 저장소
//    트랜스크립트 31개 · `toolUseResult.agentId` 를 든 레코드 337건). 칸 구성이 정확히 둘로
//    갈렸고 예외가 없었다:
//      · 뒤에서 띄움 283건 - `status:"async_launched"` · `isAsync` · `description` · `outputFile`
//      · 앞에서 기다린 결과 54건 - `status:"completed"` · `agentType` · `content`(보고 전문)
//    **둘을 가르는 칸은 `status` 하나뿐이다.** 글자(`agentId:`)로는 안 갈린다 - 띄움 안내문에도
//    그 글자가 있어서, 그것으로 끝남을 읽으면 뒤에서 도는 일감이 뜨자마자 끝난 것으로 뒤집힌다.
//    ⚠ 칸을 여기서 빼면 검사가 옛 구현(글자 찾기)도 통과시킨다. 실물에 있는 칸은 그대로 싣는다.
const rec = (o) => JSON.stringify(o) + "\n";
function callRec(callId, agentId, desc, ts) {
  return rec({ type: "assistant", uuid: "u-" + agentId, timestamp: ts, message: { role: "assistant", content: [
    { type: "tool_use", id: callId, name: "Task", input: { description: desc, subagent_type: "code-implementer", prompt: "비밀 지시문" } },
  ] } });
}
// 뒤에서 띄움. 🛑 안내문의 `agentId: …` 글자를 **그대로 둔다**: 이 글자만 보고 끝남을 읽는
//    구현을 잡는 것이 아래 "뒤에서 뜬 것은 끝남이 아니다" 칸이다.
function spawnRec(callId, agentId, desc, at) {
  const ts = new Date(at).toISOString();
  return callRec(callId, agentId, desc, ts) +
  rec({ type: "user", uuid: "r-" + agentId, timestamp: ts, message: { role: "user", content: [
    { type: "tool_result", tool_use_id: callId, content:
      "Async agent launched successfully. (This tool result is internal metadata.)\n" +
      "agentId: " + agentId + " (use SendMessage with to: '" + agentId + "')" },
  ] }, toolUseResult: {
    agentId, description: desc, status: "async_launched", isAsync: true, canReadOutputFile: true,
    outputFile: "/home/someone/.cache/claude-tmp/tasks/" + agentId + ".output",
    prompt: "비밀 지시문", resolvedModel: "claude-opus-5",
  } });
}
// 앞에서 기다린 것. 뜬 기록이 **따로 없고** 결과가 그 자리에서 돌아온다.
function doneRec(callId, agentId, desc, at, status, body) {
  const ts = new Date(at).toISOString();
  return callRec(callId, agentId, desc, ts) +
  rec({ type: "user", uuid: "d-" + agentId, timestamp: ts, message: { role: "user", content: [
    { type: "tool_result", tool_use_id: callId, content: body || "# 검토 결과\n보고 전문입니다" },
  ] }, toolUseResult: {
    // ⚠ `||` 로 기본값을 주지 않는다: 빈 상태를 재려는 칸이 조용히 `completed` 를 재게 된다.
    agentId, agentType: "chageun:pr-reviewer", status: status === undefined ? "completed" : status,
    content: [{ type: "text", text: body || "# 검토 결과\n보고 전문입니다" }],
    prompt: "비밀 지시문", resolvedModel: "claude-opus-5",
    totalDurationMs: 421000, totalTokens: 137000, totalToolUseCount: 12, usage: {}, toolStats: {},
  } });
}
// 평범한 도구 결과. 🛑 **일감이 아니다.** 실측(2026-08-12 · 2026-08-16 두 세션)에서 이 모양이
//    유령 일감을 만들었다: 이 저장소를 `grep` 한 Bash 출력에 소스 줄 `spawns.push({ agentId: m[1]`
//    이 섞여 들어 `m` 이라는 일감이 §2 에 떴고, 이름표는 그 Bash 호출의 설명이었다.
function bashGhostRec(callId, desc, at) {
  const ts = new Date(at).toISOString();
  const stdout = "88:        const m = /agentId:\\s*([A-Za-z0-9]+)/.exec(resultText(b));\n" +
    "91:          spawns.push({ agentId: m[1], name: names.get(key) || \"\", at });";
  return rec({ type: "assistant", uuid: "u-ghost-" + callId, timestamp: ts, message: { role: "assistant", content: [
    { type: "tool_use", id: callId, name: "Bash", input: { description: desc, command: "grep -n agentId src/hooks/statusboard-auto-core.js" } },
  ] } }) +
  rec({ type: "user", uuid: "r-ghost-" + callId, timestamp: ts, message: { role: "user", content: [
    { type: "tool_result", tool_use_id: callId, content: stdout, is_error: false },
  ] }, toolUseResult: { stdout, stderr: "", interrupted: false, isImage: false, noOutputExpected: false } });
}
function notifRec(taskId, status, summary, at, result) {
  const ts = new Date(at).toISOString();
  const text = "<task-notification>\n<task-id>" + taskId + "</task-id>\n<tool-use-id>call_zz</tool-use-id>\n" +
    "<output-file>/home/someone/.cache/claude-tmp/tasks/" + taskId + ".output</output-file>\n" +
    "<status>" + status + "</status>\n<summary>" + summary + "</summary>\n" +
    "<result>" + (result || "보고 전문입니다") + "</result>\n</task-notification>";
  return rec({ type: "user", uuid: "n-" + taskId, timestamp: ts, message: { role: "user", content: [{ type: "text", text }] } });
}
const A1 = "aac7930e76fa2c5e9", A2 = "b1d4f9012ab34cd56", A3 = "c9e0117af22b3d445";
const HOUR = 3600 * 1000;

// ── 경계 표시 ────────────────────────────────────────────────────────────────

test("경계 정상: 사이만 갈리고 바깥은 바이트 단위로 같다", () => {
  const sc = scene({ transcript: spawnRec("call_1", A1, "상황판 자동 갱신", Date.now()) });
  const before = board(sc);
  assert.equal(fire(sc).code, 0);
  const after = board(sc);
  assert.notEqual(after, before, "블록은 갈려야 한다");
  const cut = (t) => {
    const a = t.indexOf("<!-- chageun:auto -->"), b = t.indexOf("<!-- /chageun:auto -->");
    return [t.slice(0, a), t.slice(b)];
  };
  const [preB, postB] = cut(before), [preA, postA] = cut(after);
  assert.equal(preA.replace(/<!-- chageun:auto:head -->[\s\S]*?<!-- \/chageun:auto:head -->/, "HEAD"),
    preB.replace(/<!-- chageun:auto:head -->[\s\S]*?<!-- \/chageun:auto:head -->/, "HEAD"), "머리 블록 밖 앞부분이 그대로");
  assert.equal(postA, postB, "뒷부분이 바이트 단위로 그대로");
  assert.match(after, /상황판 자동 갱신/);
});

for (const [name, text] of [
  ["한쪽 없음(여는 것만)", "# 판\n\n<!-- chageun:auto -->\n낡은 칸\n"],
  ["한쪽 없음(닫는 것만)", "# 판\n\n낡은 칸\n<!-- /chageun:auto -->\n"],
  ["순서 뒤바뀜", "# 판\n\n<!-- /chageun:auto -->\n낡은 칸\n<!-- chageun:auto -->\n"],
  ["둘 이상", "# 판\n\n<!-- chageun:auto -->\nA\n<!-- /chageun:auto -->\n<!-- chageun:auto -->\nB\n<!-- /chageun:auto -->\n"],
  ["아예 없음(이미 있는 상황판의 기본 상태)", "# 판\n\n## 2. 지금 뒤에서 도는 것: 3건\n\n낡은 표\n"],
]) {
  test(`경계 ${name}: 한 글자도 안 쓴다`, () => {
    const sc = scene({ board: text, transcript: spawnRec("call_1", A1, "일감", Date.now()) });
    assert.equal(fire(sc).code, 0);
    assert.equal(board(sc), text, "자리를 짐작해 끼워 넣으면 안 된다");
  });
}

test("상황판이 없으면 만들지 않는다", () => {
  const sc = scene({ board: null, transcript: spawnRec("call_1", A1, "일감", Date.now()) });
  assert.equal(fire(sc).code, 0);
  assert.equal(existsSync(sc.board), false);
});

// ── 자기 시각 · 개수 ─────────────────────────────────────────────────────────

test("자기 시각은 절대 표기만 쓴다", () => {
  const sc = scene({ transcript: spawnRec("call_1", A1, "일감", Date.now()) });
  fire(sc);
  const t = board(sc);
  assert.match(t, /마지막 확인 20\d\d-\d\d-\d\d \d\d:\d\d/);
  for (const bad of ["분 전", "시간 전", "방금"]) {
    assert.ok(!t.includes(bad), "상대 표기가 얼어붙으면 거짓말을 계속한다: " + bad);
  }
});

test("개수 일치: 제목의 N건 = 표의 '도는 중' 줄 수", () => {
  const now = Date.now();
  const sc = scene({ transcript:
    spawnRec("call_1", A1, "도는 것 하나", now) +
    spawnRec("call_2", A2, "도는 것 둘", now) +
    spawnRec("call_3", A3, "끝난 것", now) +
    notifRec(A3, "completed", 'Agent "끝난 것" finished', now) });
  fire(sc);
  const t = board(sc);
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 2건/);
  assert.equal((t.match(/\| 도는 중 \|/g) || []).length, 2);
  assert.equal((t.match(/\| 끝남 \|/g) || []).length, 1);
});

// ── 표 상한 ──────────────────────────────────────────────────────────────────
//
// 🛑 **상한이 §2 의 존재 이유부터 자르던 자리다.** 정렬 열쇠(`endedAt || spawnedAt`)가 끝난
//    것에는 끝난 시각(최신)을, 도는 것에는 띄운 시각(과거)을 주므로, 한 줄로 세워 자르면
//    **먼저 밀려 나가는 것이 지금 도는 것**이다. 아래 셋은 그 자리를 세 방향에서 잰다.
const dataRows = (t) => t.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 일감 "));
const rowNames = (t) => dataRows(t).map((l) => l.slice(2).split(" | ")[0]);

// ⚠ 이름은 **일부러 부숴 본 결과**에 맞춰 적었다. 두 고침이 겹치는 자리가 있어서(도는 것을
//    먼저 채우면 그 줄이 표 안에 있으니 자른 뒤에 세도 숫자가 맞는다) 아래 첫 칸만으로는
//    "자르기 전에 센다"를 못 잰다. 그 축은 **도는 것이 상한보다 많은** 둘째 칸이 혼자 잰다.
test("상한: 끝난 것이 스물다섯 오가도 도는 것이 표에서 안 밀려난다", () => {
  const now = Date.now();
  // 두 시간째 도는 일꾼 하나 + 그 사이 오간 끝난 검토 스물다섯.
  const tasks = { live: { name: "두 시간째 도는 일꾼", spawnedAt: now - 2 * HOUR, status: "" } };
  for (let i = 0; i < 25; i++) {
    tasks["done" + i] = { name: "끝난 검토 " + i, spawnedAt: now - HOUR, status: "completed", endedAt: now - i * 1000 };
  }
  const t = core.renderBlock(tasks, now);
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 1건/, "자른 결과에서 세면 '0건'이 되어 다 끝난 줄 안다");
  assert.ok(rowNames(t).includes("두 시간째 도는 일꾼"), "§2 가 보여 주려던 그 한 줄이 먼저 잘리면 안 된다");
  assert.equal(dataRows(t).length, core.MAX_ROWS, "상한 자체는 그대로다");
});

test("상한: 도는 것이 상한보다 많으면 제목은 자르기 전 장부 전체로 센다", () => {
  const now = Date.now();
  const tasks = {};
  for (let i = 0; i < 25; i++) tasks["r" + i] = { name: "일꾼 " + i, spawnedAt: now - HOUR, status: "" };
  const t = core.renderBlock(tasks, now);
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 25건/, "안 보이는 것이 있다는 사실은 숫자가 알려 준다");
  assert.equal(dataRows(t).length, core.MAX_ROWS);
  assert.equal(dataRows(t).filter((l) => l.includes("| 도는 중 |")).length, core.MAX_ROWS, "자리는 도는 것이 다 쓴다");
});

test("상한: 도는 것을 먼저 채우되 묶음 안 차례는 최신 먼저 그대로", () => {
  const now = Date.now();
  const t = core.renderBlock({
    r1: { name: "도는 것 옛것", spawnedAt: now - 3 * HOUR, status: "" },
    r2: { name: "도는 것 새것", spawnedAt: now - 1 * HOUR, status: "" },
    e1: { name: "끝난 것 옛것", spawnedAt: now - 4 * HOUR, status: "completed", endedAt: now - 40 * 60 * 1000 },
    e2: { name: "끝난 것 새것", spawnedAt: now - 4 * HOUR, status: "completed", endedAt: now - 10 * 60 * 1000 },
  }, now);
  assert.deepEqual(rowNames(t), ["도는 것 새것", "도는 것 옛것", "끝난 것 새것", "끝난 것 옛것"],
    "묶음은 도는 것 먼저, 묶음 안은 최신 먼저");
});

// ── 누출 ─────────────────────────────────────────────────────────────────────

test("누출: 보고 전문·열쇠·경로가 파일에 안 간다", () => {
  const now = Date.now();
  const sc = scene({ transcript:
    spawnRec("call_1", A1, "검토 일감", now) +
    notifRec(A1, "completed", 'Agent "검토 일감" finished', now, "열쇠 sk-live-abcdefghijklmn 와 보고 전문") });
  fire(sc);
  const t = board(sc);
  assert.ok(!t.includes("sk-live-abcdefghijklmn"), "<result> 본문이 새면 안 된다");
  assert.ok(!/[a-f0-9]{17}/.test(t), "agentId 는 캐시에만 산다");
  assert.ok(!t.includes("/home/"), "경로는 계정 이름이 드러난다");
  assert.ok(!t.includes("output-file") && !t.includes("비밀 지시문"), "지시문·출력 경로도 안 나간다");
  assert.match(t, /검토 일감/, "이름은 나가야 한다");
  // 열쇠는 캐시 상태 파일에만 산다.
  assert.ok(Object.keys(stateOfScene(sc).tasks).includes(A1));
});

test("누출: summary 꼬리의 계정 사정이 안 따라온다", () => {
  const now = Date.now();
  // ⚠ 꼬리를 **짧게** 둔다. 실측 문장처럼 길면 40자 자르기에 우연히 잘려 나가, 따옴표 뒤를
  //    통째로 옮기는 구현도 초록이 된다(그 함정을 한 번 밟았다).
  const tail = 'Agent "일감 이름" failed: session limit 8:40pm';
  const sc = scene({ transcript: spawnRec("call_1", A1, "", now) + notifRec(A1, "failed", tail, now) });
  fire(sc);
  const t = board(sc);
  assert.match(t, /일감 이름/);
  assert.ok(!t.includes("session limit"), "따옴표 뒤 꼬리는 버린다");
  assert.match(t, /\| 멈춤 \|/);

  // 실측에 나온 긴 API 오류 모양도 같은 처분인지 함께 본다.
  const long = 'Agent "긴 일감" failed: Agent terminated early due to an API error: You\'ve hit your session limit · resets 8:40pm (Asia/Seoul)';
  const sc2 = scene({ transcript: spawnRec("call_1", A2, "", now) + notifRec(A2, "failed", long, now) });
  fire(sc2);
  assert.match(board(sc2), /긴 일감/);
  assert.ok(!board(sc2).includes("API error"));
});

test("누출: <result> 안에 든 태그를 필드로 읽지 않는다", () => {
  const now = Date.now();
  // 알림에 `<summary>` 가 없고, **`<result>` 본문 안에만** 있는 모양. 자르지 않는 구현은
  // 보고 전문에서 이름을 주워 와 평문 상황판에 싣는다.
  const ts = new Date(now).toISOString();
  const text = "<task-notification>\n<task-id>" + A1 + "</task-id>\n<status>completed</status>\n" +
    "<result>보고 전문입니다\n<summary>Agent \"누출된 이름\" finished</summary>\n</result>\n</task-notification>";
  const sc = scene({ transcript: spawnRec("call_1", A1, "", now) +
    JSON.stringify({ type: "user", uuid: "n1", timestamp: ts, message: { role: "user", content: [{ type: "text", text }] } }) + "\n" });
  fire(sc);
  const t = board(sc);
  assert.ok(!t.includes("누출된 이름"), "<result> 는 자르고 파싱조차 안 한다");
  assert.match(t, /\(이름 없음\)/, "이름을 모르면 모른다고 적는다");
});

test("누출: 이름 손질 넷", () => {
  const long = "가".repeat(60);
  assert.equal(core.safeName(long, []).length, 41, "40자 + …");
  assert.ok(core.safeName(long, []).endsWith("…"));
  assert.equal(core.safeName("앞\n뒤 | 표", []), "앞 뒤 표", "줄바꿈·표 구분자는 빈칸으로");
  assert.equal(core.safeName("", []), "(이름 없음)");
  const secrets = [{ key: "API_TOKEN", value: "sk-live-abcdefghijklmn" }];
  const masked = core.safeName("열쇠 sk-live-abcdefghijklmn 작업", secrets);
  assert.ok(!masked.includes("sk-live-abcdefghijklmn"), "기계는 막는 게 아니라 가린다");
  assert.ok(!core.safeName("<b>굵게</b>", []).includes("<b>"), "특수문자는 이스케이프");
});

// ── 상태 판정 ────────────────────────────────────────────────────────────────

test("상태: 닫힌 목록 · 목록 밖은 전부 모름", () => {
  const now = Date.now();
  const at = now - HOUR;
  assert.equal(core.stateOf({ spawnedAt: at, status: "completed" }, now), "끝남");
  for (const s of ["failed", "killed", "stopped"]) {
    assert.equal(core.stateOf({ spawnedAt: at, status: s }, now), "멈춤");
  }
  assert.equal(core.stateOf({ spawnedAt: at, status: "weird" }, now), "모름", "새 값을 지어내지 않는다");
});

test("상태: 끝남을 못 봤는데 오래되면 모름", () => {
  const now = Date.now();
  assert.equal(core.stateOf({ spawnedAt: now - HOUR, status: "" }, now), "도는 중");
  assert.equal(core.stateOf({ spawnedAt: now - 13 * HOUR, status: "" }, now), "모름", "영원히 도는 중이면 칸이 안 닫힌다");
});

test("상태: 목록 밖 알림도 배선에서 모름으로 적힌다", () => {
  const now = Date.now();
  const sc = scene({ transcript: spawnRec("call_1", A1, "일감", now) + notifRec(A1, "weird", 'Agent "일감" finished', now) });
  fire(sc);
  assert.match(board(sc), /\| 모름 \|/);
  assert.match(board(sc), /: 0건/, "모름은 도는 중으로 안 센다");
});

// ── 무엇이 일감인가 · 뜬 것과 끝난 것 ────────────────────────────────────────
//
// 🛑 이 절의 세 칸은 **한 함수(`parseDelta`)의 같은 판정**을 세 방향에서 잰다. 축을 나눠 적는
//    이유는, 한 방향만 재면 반대쪽으로 틀린 구현이 초록으로 통과하기 때문이다:
//      ① 아무 도구나 일감이 되면 안 된다   ② 앞에서 기다린 것은 끝나야 한다
//      ③ 뒤에서 뜬 것은 끝나면 안 된다(②를 글자로 고치면 여기가 뒤집힌다)

test("유령 금지: agentId 글자가 든 평범한 도구 결과는 일감이 아니다", () => {
  const now = Date.now();
  // ① 순수 함수로 곧장. 칸이 없는 레코드는 한 건도 안 나와야 한다.
  const ghost = bashGhostRec("call_g", "차근이 스폰을 어떻게 잡는지 확인", now);
  assert.equal(core.parseDelta(ghost).spawns.length, 0, "결과 본문의 글자는 일감이 아니다");
  assert.ok(ghost.includes("agentId:"), "🛑 미끼가 실제로 들어 있어야 이 칸이 무엇을 잰다");

  // ② 배선. 진짜 일감을 하나 같이 넣어 **조기 탈출이 아니라 파싱이 걸러냈음**을 못박는다
  //    (유령만 넣으면 비용 문지기가 닫아 버려, parseDelta 를 안 고쳐도 초록이 된다).
  const sc = scene({ transcript: spawnRec("call_1", A1, "진짜 일감", now) + ghost });
  fire(sc);
  const t = board(sc);
  assert.match(t, /진짜 일감/);
  assert.ok(!t.includes("차근이 스폰을 어떻게 잡는지 확인"), "Bash 설명이 일감 이름으로 오르면 안 된다");
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 1건/, "유령이 세어지면 안 된다");
  assert.deepEqual(Object.keys(stateOfScene(sc).tasks), [A1], "장부에도 유령이 남으면 안 된다");
});

test("앞에서 기다린 것은 끝남으로 잡힌다", () => {
  const now = Date.now();
  const d = core.parseDelta(doneRec("call_1", A1, "앞에서 기다린 검토", now));
  assert.equal(d.spawns.length, 1, "뜬 기록이 따로 없으니 줄도 여기서 생겨야 한다");
  assert.deepEqual(d.ends.map((e) => [e.taskId, e.status]), [[A1, "completed"]]);

  const sc = scene({ transcript: doneRec("call_1", A1, "앞에서 기다린 검토", now) });
  fire(sc);
  const t = board(sc);
  assert.match(t, /\| 앞에서 기다린 검토 \| 끝남 \|/, "다 끝난 일을 '도는 중'으로 보여 주면 안 된다");
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 0건/);
});

test("뒤에서 뜬 것은 끝남이 아니다", () => {
  const now = Date.now();
  // 🛑 **이 칸이 바로 위 칸의 반대쪽 벽이다.** 뒤에서 띄운 결과에도 `agentId` 가 실려 오므로,
  //    끝남을 칸의 유무로 읽으면 여기서 뒤집힌다: 틀린 "끝남"은 틀린 "도는 중"보다 나쁘다.
  const d = core.parseDelta(spawnRec("call_1", A1, "뒤에서 도는 일감", now));
  assert.equal(d.spawns.length, 1);
  assert.deepEqual(d.ends, [], "띄움 레코드로 끝남을 만들면 안 된다");

  const sc = scene({ transcript: spawnRec("call_1", A1, "뒤에서 도는 일감", now) });
  fire(sc);
  const t = board(sc);
  assert.match(t, /\| 뒤에서 도는 일감 \| 도는 중 \|/);
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 1건/);
});

test("띄움이 아니면 전부 끝남에 적고 값은 그대로 넘긴다", () => {
  const now = Date.now();
  const endsOf = (st) => core.parseDelta(doneRec("call_1", A1, "일감", now, st)).ends;
  assert.equal(endsOf("failed").length, 1, "멈춘 것도 끝난 것이다");
  assert.equal(endsOf("async_launched").length, 0, "띄움은 끝남이 아니다");
  // 🛑 **여기가 뒤집혔던 자리다.** 목록 밖이라고 아무것도 안 적으면 그 일감은 상태가 **빈 채**
  //    남아 §2 에서 "도는 중"으로 세어지고 12시간을 버틴다. 값을 지어내지 않으면서 유령도 안
  //    만드는 길은 하나뿐이다: **끝남에 적되 값을 그대로 넘겨** `stateOf` 가 "모름"으로 떨어뜨린다.
  assert.deepEqual(endsOf("weird").map((e) => e.status), ["weird"], "새 값이 생겨도 값은 안 지어낸다");
  assert.deepEqual(endsOf("cancelled").map((e) => e.status), ["cancelled"]);
  assert.deepEqual(endsOf("").map((e) => e.status), [""]);

  const sc = scene({ transcript: doneRec("call_1", A1, "멈춘 검토", now, "failed") });
  fire(sc);
  assert.match(board(sc), /\| 멈춘 검토 \| 멈춤 \|/);
});

test("모르는 상태값은 '도는 중'으로 굳지 않고 '모름'으로 떨어진다", () => {
  const now = Date.now();
  const sc = scene({ transcript: doneRec("call_1", A1, "취소된 검토", now, "cancelled") });
  fire(sc);
  const t = board(sc);
  assert.match(t, /\| 취소된 검토 \| 모름 \|/, "지어내지 않으면서 유령도 안 만든다");
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 0건/, "12시간 굳는 유령 '도는 중'이 생기면 안 된다");
});

test("띄움은 칸 두 개로 알아본다: 한쪽이 없어도 띄움이다", () => {
  const now = Date.now(), ts = new Date(now).toISOString();
  // 🛑 실측에서 `async_launched` 인데 `isAsync` 가 없는 레코드가 나왔다(2026-08-17 · 2건 · 각본
  //    띄우기). 그 2건은 `agentId` 대신 `taskId` 를 써서 이 갈래에 안 들어오지만, 칸 하나만 보는
  //    구현은 그런 모양이 하나만 들어와도 **뜬 일감을 끝난 것으로 뒤집는다** - 가장 나쁜 방향이다.
  const launchRec = (callId, agentId, desc, tur) =>
    callRec(callId, agentId, desc, ts) +
    rec({ type: "user", uuid: "r-" + agentId, timestamp: ts, message: { role: "user", content: [
      { type: "tool_result", tool_use_id: callId, content: "Async agent launched successfully." },
    ] }, toolUseResult: { agentId, description: desc, ...tur } });

  const noFlag = launchRec("call_1", A1, "깃발 없는 띄움", { status: "async_launched" });
  assert.ok(!noFlag.includes("isAsync"), "🛑 그 칸이 실제로 빠져 있어야 이 칸이 무엇을 잰다");
  assert.deepEqual(core.parseDelta(noFlag).ends, [], "status 만으로도 띄움을 알아본다");

  const oddStatus = launchRec("call_2", A2, "낯선 상태 띄움", { status: "launched_v2", isAsync: true });
  assert.deepEqual(core.parseDelta(oddStatus).ends, [], "isAsync 만으로도 띄움을 알아본다");
});

test("조각이 갈려도 띄움 레코드가 자기 안에 든 이름표를 쓴다", () => {
  const now = Date.now();
  const full = spawnRec("call_1", A1, "쪼개진 일감", now);
  // 조각이 **결과 줄에서 시작한다**: 이름표를 실은 호출 줄은 지난 회차에 이미 지나갔다.
  const tail = full.slice(full.indexOf("\n") + 1);
  assert.ok(!tail.includes('"type":"tool_use"'), "🛑 호출 줄이 남아 있으면 이 칸이 아무것도 안 잰다");
  assert.ok(!tail.includes('"id":"call_1"'), "이름표를 실은 블록이 통째로 빠졌는지 함께 못박는다");
  assert.equal(core.parseDelta(tail).spawns[0].name, "쪼개진 일감");

  const sc = scene({ transcript: tail });
  fire(sc);
  assert.match(board(sc), /쪼개진 일감/);
  assert.ok(!board(sc).includes("(이름 없음)"), "장부에 이름이 비면 안 된다");
});

// ── 우회 금지 · 캐시 ─────────────────────────────────────────────────────────

test("우회 금지: 무시가 확인 안 된 상황판에는 한 글자도 안 쓴다", () => {
  const now = Date.now();
  const sc = scene({ ignore: false, transcript: spawnRec("call_1", A1, "일감", now) });
  const before = board(sc);
  assert.equal(fire(sc).code, 0);
  assert.equal(board(sc), before, "기계가 하드 차단을 우회하면 안 된다");
  // ⚠ 같은 세션에서 무시 줄을 넣어 다시 재지 않는다 — 차단 판정은 세션 내내 굳는 쪽이라
  //    여기서 초록이 나오면 그 캐시 계약이 깨진 것이다. 무시된 저장소는 새 세션으로 잰다.
  const ok = scene({ transcript: spawnRec("call_1", A1, "일감", now) });
  fire(ok);
  assert.notEqual(board(ok), before, "무시가 확인되면 쓴다");
});

test("캐시 비대칭: 통과는 5분 · 차단은 세션 내내", () => {
  const now = Date.now();
  const sc = scene({ transcript: spawnRec("call_1", A1, "첫 일감", now) });
  fire(sc);
  assert.match(board(sc), /첫 일감/, "통과 판정으로 한 번 썼다");

  // 세션 도중 추적을 시작하면(사장님이 git add), 통과 캐시가 만료된 뒤에는 안 써야 한다.
  git(sc.dir, ["add", "-f", "status.md"]);
  const st = stateOfScene(sc);
  st.ignoreVerdictAt = now - 6 * 60 * 1000;          // 5분 캐시를 넘긴다
  writeFileSync(join(sc.cache, "chageun", "board-tasks", sc.key + ".json"), JSON.stringify(st));
  appendFileSync(sc.tpath, spawnRec("call_2", A2, "둘째 일감", Date.now()));
  fire(sc);
  assert.ok(!board(sc).includes("둘째 일감"), "추적이 시작되면 기계도 멈춘다");

  // 반대로 차단 판정은 세션 내내 유지된다 — 시각을 되돌려도 다시 안 쓴다.
  const st2 = stateOfScene(sc);
  assert.equal(st2.ignoreVerdict, "blocked");
  st2.ignoreVerdictAt = 0;
  writeFileSync(join(sc.cache, "chageun", "board-tasks", sc.key + ".json"), JSON.stringify(st2));
  appendFileSync(sc.tpath, spawnRec("call_3", A3, "셋째 일감", Date.now()));
  fire(sc);
  assert.ok(!board(sc).includes("셋째 일감"));
});

// ── 비용 ─────────────────────────────────────────────────────────────────────

test("비용: 조기 탈출 판정을 검사가 직접 부른다", () => {
  assert.equal(core.shouldParse("아무 말 없는 도구 출력", { tasks: {} }), false);
  assert.equal(core.shouldParse('... "agentId":"abc" ...', { tasks: {} }), true, "칸이 온 조각은 열어야 한다");
  assert.equal(core.shouldParse("<task-notification>", { tasks: {} }), true);
  // 🛑 문지기가 찾는 글자도 **칸 이름**이다. 본문의 `agentId:` 로 열면, 그 낱말을 낸 평범한
  //    출력마다 최대 4MB 조각을 통째로 파싱하고 비밀값까지 걷는다 - 그러고도 건지는 것이 없다
  //    (`parseDelta` 가 본문을 아예 안 본다).
  assert.equal(core.shouldParse("... agentId: abc ...", { tasks: {} }), false, "본문 글자로는 안 연다");
  assert.equal(core.shouldParse(bashGhostRec("c", "차근 코드 훑어보기", Date.now()), { tasks: {} }), false,
    "차근 코드를 grep 할 때마다 파싱 비용이 나가면 안 된다");
  assert.equal(core.shouldParse("무관한 조각", { tasks: { x: { status: "" } } }), true, "도는 것이 있으면 시간만 흘러도 표가 바뀐다");
  assert.equal(core.shouldParse("무관한 조각", { tasks: { x: { status: "completed" } } }), false);
  assert.equal(core.shouldParse("", { tasks: { x: { status: "completed" } }, pendingWrite: true }), true,
    "밀린 쓰기가 있으면 새 소식이 없어도 문이 열린다(안 열면 그 쓰기가 영영 안 나간다)");
  assert.equal(core.shouldParse("", { tasks: { x: { status: "completed" } }, pendingWrite: false }), false,
    "밀린 쓰기를 내린 뒤에는 도로 닫힌다");
});

test("비용: 트랜스크립트를 통째로 안 읽는다", () => {
  const src = readFileSync(HOOK, "utf8");
  assert.ok(!/readFileSync\([^)]*tpath/.test(src), "전체 읽기가 들어오면 §1.6 이 금지한 비용이 되살아난다");
  assert.ok(!/readFileSync\([^)]*transcript/.test(src));
  assert.match(src, /readSync\(/, "바이트 자리로 읽는다");
});

test("offset: 파일이 줄어도 죽지 않고 따라잡는다", () => {
  const now = Date.now();
  const sc = scene({ transcript: spawnRec("call_1", A1, "첫 일감", now) });
  fire(sc);
  assert.ok(stateOfScene(sc).offset > 0);
  writeFileSync(sc.tpath, spawnRec("call_2", A2, "짧아진 뒤 일감", now));   // 압축·교체
  const r = fire(sc);
  assert.equal(r.code, 0);
  assert.match(board(sc), /짧아진 뒤 일감/);
});

test("offset: 앞 항목이 짧아지면 지문이 안 맞아 자리를 버린다", () => {
  const now = Date.now();
  const pad = (n) => rec({ type: "assistant", uuid: "pad", timestamp: new Date(now).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "x".repeat(n) }] } });
  const sc = scene({ transcript: pad(4000) + spawnRec("call_1", A1, "첫 일감", now) });
  fire(sc);
  const off = stateOfScene(sc).offset;
  assert.ok(off > 0);
  // G7 가리기가 실제로 하는 일: 이미 기록된 항목이 짧아진다. 크기는 안 줄도록 뒤에 더 붙인다.
  writeFileSync(sc.tpath, pad(200) + spawnRec("call_1", A1, "첫 일감", now) + spawnRec("call_2", A2, "밀린 뒤 일감", now) + pad(5000));
  const size = readFileSync(sc.tpath).length;
  assert.ok(size >= off, "크기가 줄지 않은 상태를 재는 칸이다");
  fire(sc);
  const t = board(sc);
  assert.match(t, /밀린 뒤 일감/, "자리가 밀리면 한 건이 조용히 빠진다");
  assert.match(t, /첫 일감/);
});

test("표식 폴더 없음: 빈 캐시에서도 상태 파일이 생긴다", () => {
  const cache = tmpDir("cache-");                     // 🛑 board-tasks 를 미리 만들지 않는다
  const sc = scene({ transcript: spawnRec("call_1", A1, "일감", Date.now()) });
  sc.cache = cache;
  assert.equal(fire(sc).code, 0);
  assert.ok(existsSync(join(cache, "chageun", "board-tasks")), "새 기계에서 폴더를 스스로 만든다");
  assert.ok(existsSync(join(cache, "chageun", "board-tasks", sc.key + ".json")));
});

test("실패 침묵: 캐시를 못 써도 종료코드 0 · stdout 비어 있음", () => {
  const blocked = join(tmpDir("cache-"), "notafolder");
  writeFileSync(blocked, "");
  const sc = scene({ transcript: spawnRec("call_1", A1, "일감", Date.now()) });
  const r = fire(sc, { cache: blocked });
  assert.equal(r.code, 0);
  assert.equal(r.out, "", "이 훅의 stdout 은 G7 계약이 쓰는 자리다");
});

test("읽기 전용 상황판이어도 죽지 않는다", () => {
  const sc = scene({ transcript: spawnRec("call_1", A1, "일감", Date.now()) });
  chmodSync(sc.board, 0o444);
  const r = fire(sc);
  chmodSync(sc.board, 0o644);
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});
