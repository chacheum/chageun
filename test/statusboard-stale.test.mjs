// 사람 칸이 **언제 기준인지** 밝히는 머리 블록(v0.65.0 F-27 · T2c · 성공 기준 O).
//
// ⚠ **시각 문자열이 분 단위라 "값이 바뀌었나"를 파일 글자로만 재지 않는다.** 같은 분 안에
//    두 번 돌면 글자가 같아서, 안 움직이는 구현도 초록이 된다. 그래서 움직임은 **캐시의
//    `humanSeenAt`(밀리초)** 로 재고, 파일 쪽은 그 값이 그대로 찍혔는지로 맞춘다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpDir } from "./support-tmpdir.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "src", "hooks", "posttooluse.js");
const core = require(join(HERE, "..", "src", "hooks", "statusboard-auto-core.js"));
const TPL_PATH = join(HERE, "..", "src", "skills", "statusboard", "board.template.md");
const TEMPLATE = readFileSync(TPL_PATH, "utf8");

const BASE = { ...process.env };
for (const k of Object.keys(BASE)) { if (k.startsWith("CHAGEUN_")) delete BASE[k]; }

const GIT_ID = ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"];
function git(dir, args) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + " 실패: " + (r.stderr || r.stdout || ""));
}

let seq = 0;
function scene(boardText) {
  const dir = tmpDir("stale-");
  git(dir, ["init", "-q"]);
  appendFileSync(join(dir, ".git", "info", "exclude"), "status.md\n");
  const sc = { dir, board: join(dir, "status.md"), tpath: join(dir, "t.jsonl"), cache: tmpDir("cache-"), key: "sess" + (++seq) };
  writeFileSync(sc.board, boardText === undefined ? TEMPLATE : boardText);
  writeFileSync(sc.tpath, "");
  return sc;
}
function fire(sc, extra = {}) {
  const input = {
    session_id: sc.key, transcript_path: sc.tpath, cwd: sc.dir,
    tool_name: extra.tool_name || "Bash",
    tool_input: extra.tool_input || { command: "ls" },
    tool_response: "ok",
  };
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input), env: { ...BASE, XDG_CACHE_HOME: sc.cache }, encoding: "utf8",
  });
  assert.equal(r.status, 0);
  return r;
}
const stateOf = (sc) => JSON.parse(readFileSync(join(sc.cache, "chageun", "board-tasks", sc.key + ".json"), "utf8"));
const board = (sc) => readFileSync(sc.board, "utf8");
const headLine = (sc) => (board(sc).split("\n").find((l) => l.indexOf("사람이 쓰는 칸") !== -1) || "");

const rec = (o) => JSON.stringify(o) + "\n";
function spawnRec(callId, agentId, desc, at) {
  const ts = new Date(at || Date.now()).toISOString();
  return rec({ type: "assistant", uuid: "u-" + agentId, timestamp: ts, message: { role: "assistant", content: [
    { type: "tool_use", id: callId, name: "Task", input: { description: desc, subagent_type: "code-implementer" } }] } }) +
  rec({ type: "user", uuid: "r-" + agentId, timestamp: ts, message: { role: "user", content: [
    { type: "tool_result", tool_use_id: callId, content: "agentId: " + agentId }] } });
}
function notifRec(taskId, status, summary, at) {
  const ts = new Date(at).toISOString();
  const text = "<task-notification>\n<task-id>" + taskId + "</task-id>\n" +
    "<status>" + status + "</status>\n<summary>" + summary + "</summary>\n" +
    "<result>보고 전문입니다</result>\n</task-notification>";
  return rec({ type: "user", uuid: "n-" + taskId, timestamp: ts, message: { role: "user", content: [{ type: "text", text }] } });
}
// 에이전트 소식이 **한 글자도 없는** 회차. 사람이 자리를 비운 뒤 흐르는 것이 이 모양이다.
function idleRec(at) {
  const ts = new Date(at).toISOString();
  return rec({ type: "assistant", uuid: "u-idle-" + at, timestamp: ts, message: { role: "assistant", content: [
    { type: "tool_use", id: "call-idle-" + at, name: "Bash", input: { command: "ls" } }] } });
}
const A1 = "aac7930e76fa2c5e9", A2 = "b1d4f9012ab34cd56", A3 = "c9e0117af22b3d445";

// 사람 칸 한 글자 고치기(기계 블록 **밖**을 건드린다).
let edits = 0;
function editHuman(sc) {
  const t = board(sc);
  const from = t.indexOf("## 3. 진행 중인 판");
  assert.ok(from > 0, "사람 칸을 찾지 못했다");
  writeFileSync(sc.board, t.slice(0, from) + "## 3. 진행 중인 판\n\n- 사람이 고친 줄 " + (++edits) + "\n" +
    t.slice(t.indexOf("\n## 4."), t.length));
}

// ── 머리 블록 모양 ───────────────────────────────────────────────────────────

test("머리 블록: 두 시각이 절대 표기로 들어간다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  editHuman(sc);
  appendFileSync(sc.tpath, spawnRec("c2", A2, "둘째", Date.now()));
  fire(sc);
  const t = board(sc);
  assert.match(t, /기계가 이 파일을 마지막으로 고친 때 \*\*20\d\d-\d\d-\d\d \d\d:\d\d\*\*/);
  assert.match(t, /적어도 20\d\d-\d\d-\d\d \d\d:\d\d 부터/);
  for (const bad of ["분 전", "시간 전", "방금"]) assert.ok(!t.includes(bad));
  assert.ok(!t.includes("에 썼습니다"), "기계는 사람이 쓴 순간을 못 본다 — 과대 주장 금지");
});

test("첫 회차는 모름 · 그 줄에 날짜가 없다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const line = headLine(sc);
  // 계획서는 이 상태를 `모름` 이라 부르고, 화면 문구는 스펙 §2.4.3 의 "언제 바뀌었는지 모릅니다"다.
  assert.match(line, /언제 바뀌었는지 모릅니다/, "안 본 것을 봤다고 하지 않는다");
  assert.ok(!/20\d\d-\d\d-\d\d/.test(line), "방금 깐 기계가 묵은 §1을 '방금 확인함'으로 만들면 안 된다");
  assert.equal(stateOf(sc).humanSeenAt, undefined);
});

test("미래 금지: 적힌 시각이 현재보다 뒤가 아니다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const t = board(sc);
  const now = Date.now();
  for (const m of t.match(/20\d\d-\d\d-\d\d \d\d:\d\d/g) || []) {
    assert.ok(Date.parse(m.replace(" ", "T")) <= now + 60 * 1000, "미래 시각: " + m);
  }
});

// ── 대조(모델 기억 아님 · 파일 내용) ─────────────────────────────────────────

test("대조: 바뀌면 움직이고 안 바뀌면 안 움직인다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const h0 = stateOf(sc).humanHash;

  editHuman(sc);
  appendFileSync(sc.tpath, spawnRec("c2", A2, "둘째", Date.now()));
  fire(sc);
  const s1 = stateOf(sc);
  assert.notEqual(s1.humanHash, h0, "사람 칸이 바뀐 것을 알아챈다");
  assert.ok(s1.humanSeenAt > 0);
  assert.ok(board(sc).includes("적어도 " + core.fmtAbs(s1.humanSeenAt) + " 부터"), "알아챈 그 값이 그대로 찍힌다");

  appendFileSync(sc.tpath, spawnRec("c3", A3, "셋째", Date.now()));
  fire(sc);
  const s2 = stateOf(sc);
  assert.equal(s2.humanSeenAt, s1.humanSeenAt, "안 바뀌었으면 시각도 그대로");
});

test("되먹임 없음: 기계가 쓴 직후에도 사람 칸 시각이 안 움직인다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const h0 = stateOf(sc).humanHash;
  appendFileSync(sc.tpath, spawnRec("c2", A2, "둘째", Date.now()));
  fire(sc);                                   // 방금 기계가 쓴 파일을 다시 본다
  const st = stateOf(sc);
  assert.equal(st.humanHash, h0, "humanText 가 기계 블록을 안 빼면 여기서 빨개진다");
  assert.equal(st.humanSeenAt, undefined, "기계 자신의 쓰기가 '사람이 고쳤다'로 잡히면 안 된다");
});

// ── 미룸(A-M1 · B-M1) ────────────────────────────────────────────────────────

test("미룸: 사람 칸만 바뀐 회차는 파일을 안 건드린다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  editHuman(sc);
  const before = board(sc);
  fire(sc);                                   // 장부 변화 없음
  assert.equal(board(sc), before, "곧바로 쓰면 사람의 다음 편집이 거부된다");
  const st = stateOf(sc);
  assert.ok(st.humanSeenAt > 0, "캐시에는 알아챈 값이 적혀 있어야 한다");
});

test("미룸: 다음 장부 변화 때 앞 회차에 알아챈 값으로 함께 나간다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  editHuman(sc);
  fire(sc);
  const seen = stateOf(sc).humanSeenAt;
  appendFileSync(sc.tpath, spawnRec("c2", A2, "둘째", Date.now()));
  fire(sc);
  const t = board(sc);
  assert.ok(t.includes("적어도 " + core.fmtAbs(seen) + " 부터"), "머리 시각이 앞 회차 값이어야 한다");
  assert.match(t, /둘째/, "§2와 머리 블록이 같은 쓰기 한 번에 함께 나간다");
});

test("연달아 고치기: 사이에 파일이 안 바뀌어 편집 충돌이 안 생긴다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  editHuman(sc);
  const a = board(sc);
  fire(sc);
  assert.equal(board(sc), a);
  editHuman(sc);
  const b = board(sc);
  fire(sc);
  assert.equal(board(sc), b);
});

test("읽은 직후 회차는 미루고, 다음 회차에 밀린 쓰기가 나간다", () => {
  const sc = scene();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const before = board(sc);
  // ① 대상이 상황판인 호출 + 장부가 바뀌는 조각
  appendFileSync(sc.tpath, spawnRec("c2", A2, "읽은 뒤 일감", Date.now()));
  fire(sc, { tool_name: "Read", tool_input: { file_path: sc.board } });
  assert.equal(board(sc), before, "읽은 직후 쓰면 그 다음 Edit 이 거부된다");
  const st = stateOf(sc);
  assert.ok(Object.keys(st.tasks).includes(A2), "장부와 자리는 그대로 갱신한다");
  assert.equal(st.pendingWrite, true, "밀린 쓰기를 기억해야 한다");
  // ② 다음 회차(대상이 다르고 장부 변화도 없다) — 그때 나간다
  fire(sc);
  assert.match(board(sc), /읽은 뒤 일감/, "pendingWrite 가 없으면 밀린 쓰기가 조용히 사라진다");
  assert.equal(stateOf(sc).pendingWrite, false);
});

// 🛑 **바로 위 검사의 나머지 반쪽이다.** 위는 일감이 **아직 도는** 채로 미루므로, 다음 회차의
//    문을 `장부에 상태 없는 일감` 갈래가 열어 준다. 여기서는 **마지막 일감까지 끝난 뒤** 미루게
//    만든다: 그 갈래가 닫혀 있어, 밀린 쓰기 자체를 알아보는 갈래가 없으면 영영 안 나간다.
//    실측(2026-08-14)이 이 모양이었다: 20:13 에 마지막 알림이 오고 그 다음 도구가 상황판
//    `Read` 라 미뤄졌는데, 그 뒤로 새 소식이 없어 §2 가 20:08 에 얼어붙었다.
test("마지막 일감까지 끝난 뒤 미룬 쓰기도 다음 회차에 나간다", () => {
  const sc = scene();
  const t0 = Date.now();
  appendFileSync(sc.tpath, spawnRec("c1", A1, "혼자 돌던 일감", t0));
  fire(sc);
  assert.match(board(sc), /## 2\. 지금 뒤에서 도는 것: 1건/, "먼저 도는 것으로 한 번 찍힌다");

  // ① 마지막 알림 + 그 회차의 대상이 상황판(실측 순서 그대로) → 설계대로 미룬다
  appendFileSync(sc.tpath, notifRec(A1, "completed", 'Agent "혼자 돌던 일감" 끝', t0 + 1000));
  fire(sc, { tool_name: "Read", tool_input: { file_path: sc.board } });
  const st1 = stateOf(sc);
  assert.equal(st1.tasks[A1].status, "completed", "장부는 정확히 적힌다");
  assert.equal(st1.pendingWrite, true, "쓰기가 미뤄진 것을 기억한다");
  assert.match(board(sc), /## 2\. 지금 뒤에서 도는 것: 1건/, "이 회차에는 아직 파일이 옛날 그대로다");

  // ② 새 에이전트 소식이 하나도 없는 다음 회차 - 그래도 밀린 쓰기는 나가야 한다
  appendFileSync(sc.tpath, idleRec(t0 + 2000));
  fire(sc);
  assert.match(board(sc), /## 2\. 지금 뒤에서 도는 것: 0건/,
    "끝난 일을 계속 '도는 중'으로 보여 주면 자리를 비웠다 온 사장님이 정반대로 읽는다");
  assert.match(board(sc), /\| 혼자 돌던 일감 \| 끝남 \|/, "표의 그 줄도 끝난 것으로 바뀐다");
  assert.equal(stateOf(sc).pendingWrite, false, "나갔으면 표시를 내려야 다음 회차가 헛돌지 않는다");
});

// ── 표시가 깨졌거나 없을 때 ──────────────────────────────────────────────────

for (const [name, head] of [
  ["여는 표시만", "<!-- chageun:auto:head -->\n"],
  ["순서 뒤바뀜", "<!-- /chageun:auto:head -->\n낡음\n<!-- chageun:auto:head -->\n"],
  ["짝이 둘", "<!-- chageun:auto:head -->\nA\n<!-- /chageun:auto:head -->\n<!-- chageun:auto:head -->\nB\n<!-- /chageun:auto:head -->\n"],
]) {
  test(`머리 표시 ${name}: 한 글자도 안 쓴다`, () => {
    const text = "# 판\n\n" + head + "\n## 1. 지금 하실 것: 0건\n";   // §2 표시는 아예 없다
    const sc = scene(text);
    appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
    fire(sc);
    assert.equal(board(sc), text);
  });
}

test("두 블록은 서로 독립이다: 한쪽이 깨져도 다른 쪽은 갱신된다", () => {
  const broken = "# 판\n\n<!-- chageun:auto:head -->\n낡은 머리\n\n<!-- chageun:auto -->\n낡은 표\n<!-- /chageun:auto -->\n";
  const sc = scene(broken);
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const t = board(sc);
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 1건/, "§2는 갱신된다");
  assert.ok(t.includes("<!-- chageun:auto:head -->\n낡은 머리"), "머리는 그대로 둔다");
});

test("표시가 한 벌만 있어도 있는 쪽만 갱신한다", () => {
  const onlyHead = "# 판\n\n<!-- chageun:auto:head -->\n낡은 머리\n<!-- /chageun:auto:head -->\n\n## 2. 지금 뒤에서 도는 것: 9건\n";
  const sc = scene(onlyHead);
  appendFileSync(sc.tpath, spawnRec("c1", A1, "일감", Date.now()));
  fire(sc);
  const t = board(sc);
  assert.match(t, /기계가 이 파일을 마지막으로 고친 때/, "머리는 갱신된다");
  assert.match(t, /## 2\. 지금 뒤에서 도는 것: 9건/, "§2 표시가 없으면 그 칸은 손대지 않는다");
});

test("본보기에는 머리 표시가 있고 손으로 적는 시각이 없다", () => {
  assert.match(TEMPLATE, /<!-- chageun:auto:head -->/);
  assert.match(TEMPLATE, /<!-- \/chageun:auto:head -->/);
  const subtitle = TEMPLATE.split("\n").find((l) => l.startsWith("> ")) || "";
  assert.ok(!/20\d\d-\d\d-\d\d/.test(subtitle), "본보기에 낡을 줄을 심지 않는다");
});
