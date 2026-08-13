// "이 프로젝트에 상황판이 있나 · 어디인가" - 판정 한 자리(src/hooks/board-root-core.js).
//
// 🛑 **두 방향을 다 잰다.** 넓히는 쪽(작업방·하위 폴더에서 위 저장소 뿌리를 찾는다)만 재면
//    경계가 헐거워진 것을 아무도 못 본다: 홈에 상황판이 한 장 있을 때 그 아래 **모든** 프로젝트가
//    그것을 제 것으로 여기고 기계가 거기에 쓰는 사고는 초록불 밑에서 난다.
// 🛑 **HOME 을 주입해 밀폐한다.** 판정이 경계까지 위로 걸으므로, 주입이 없으면 `/tmp/status.md`
//    나 `/status.md` 가 없다는 **기계 상태**에 기대는 검사가 된다(다른 기계에서 조용히 뒤집힌다).
//    주입이 먹는 근거: POSIX 의 `os.homedir()` 이 `$HOME` 을 먼저 읽는다(board-core.mjs 와 같은 수법).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./support-tmpdir.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const HOOKS = join(SRC, "hooks");
const boardRoot = require(join(HOOKS, "board-root-core.js"));
const { resolveRoot } = await import(join(SRC, "skills", "statusboard", "board-core.mjs"));
const TEMPLATE = readFileSync(join(SRC, "skills", "statusboard", "board.template.md"), "utf8");

const { findBoardDir, findBoardPath, isBoundaryDir, homeDirOf, FILE, MAX_UP } = boardRoot;

// 홈 아래에 프로젝트 하나. 반환한 `env` 를 그대로 넘겨야 밀폐가 선다.
function scene(prefix, opts = {}) {
  const home = tmpDir(prefix);
  const proj = join(home, "proj");
  mkdirSync(proj, { recursive: true });
  // 작업방 모양 그대로: `<repo>/.claude/worktrees/<이름>` 3단.
  const nested = join(proj, ".claude", "worktrees", "agent-abc123");
  mkdirSync(nested, { recursive: true });
  if (opts.board) writeFileSync(join(proj, FILE), opts.board === true ? TEMPLATE : opts.board);
  if (opts.homeBoard) writeFileSync(join(home, FILE), TEMPLATE);
  return { home, proj, nested, env: { HOME: home } };
}

// ── 단위: 찾는 방향(넓히기) ──────────────────────────────────────────────────

test("켠 폴더에 있으면 그 폴더", () => {
  const s = scene("br-a-", { board: true });
  assert.equal(findBoardDir(s.proj, s.env), s.proj);
  assert.equal(findBoardPath(s.proj, s.env), join(s.proj, FILE));
});

test("작업방처럼 3단 아래에서 켜도 저장소 뿌리를 찾는다", () => {
  const s = scene("br-b-", { board: true });
  assert.equal(findBoardDir(s.nested, s.env), s.proj);
});

test("끝 슬래시가 붙은 켠 폴더도 같은 답", () => {
  const s = scene("br-c-", { board: true });
  assert.equal(findBoardDir(s.nested + "/", s.env), s.proj);
});

// ── 단위: 안 찾는 방향(좁히기 · 오탐) ────────────────────────────────────────

test("홈 경계: 프로젝트에서 켜면 홈의 상황판을 안 집는다", () => {
  // 홈에 한 장 있으면 그 아래 모든 프로젝트가 같은 상황판을 제 것으로 여기고,
  // §2 자동 갱신이 남의 프로젝트 일감을 그 파일에 쓴다.
  const s = scene("br-d-", { homeBoard: true });
  assert.equal(findBoardDir(s.proj, s.env), null, "홈까지 올라갔다");
  assert.equal(findBoardDir(s.nested, s.env), null, "홈까지 올라갔다(3단 아래)");
});

test("홈 자신에서 켜면 제 상황판은 집는다(resolveRoot 와 같은 답)", () => {
  // 올라간 것이 아니라 그 폴더의 제 파일이다. `resolveRoot("/home/u", …)` 도 똑같이 집는다.
  const s = scene("br-e-", { homeBoard: true });
  assert.equal(findBoardDir(s.home, s.env), s.home);
});

test("HOME 에 끝 슬래시가 붙어도 경계가 그대로 선다", () => {
  const s = scene("br-f-", { homeBoard: true });
  assert.equal(findBoardDir(s.proj, { HOME: s.home + "/" }), null, "끝 슬래시 하나에 경계가 풀렸다");
  assert.equal(findBoardDir(s.proj, { HOME: s.home + "//" }), null);
});

test("HOME 이 비었거나 공백이면 진짜 홈으로 되돌아간다(경계가 사라지지 않는다)", () => {
  const real = homedir();
  for (const v of ["", "   ", undefined]) assert.equal(homeDirOf({ HOME: v }), real, `HOME=${JSON.stringify(v)}`);
});

test("상대 경로 HOME 은 경계로 안 쓴다(켠 폴더가 홈 행세를 하는 것을 막는다)", () => {
  assert.equal(homeDirOf({ HOME: "proj" }), "", "path.resolve 가 상대값을 켠 폴더 기준으로 폈다");
});

test("`/home` 도 경계다(홈이 딴 데여도 남의 홈 트리로 안 오른다)", () => {
  // 없는 이름을 쓴다: 이 기계의 진짜 홈을 건드리지 않는다.
  assert.equal(findBoardDir("/home/nobody-xyz/proj", { HOME: "/nowhere" }), null);
  assert.equal(isBoundaryDir("/home", { HOME: "/nowhere" }), true);
  assert.equal(isBoundaryDir("/", { HOME: "/nowhere" }), true);
  assert.equal(isBoundaryDir("/home/nobody-xyz", { HOME: "/nowhere" }), false);
});

test(`상한 ${MAX_UP}단: 그 안이면 찾고 넘으면 포기한다`, () => {
  // 🛑 **숫자를 여기 그대로 박는다.** 아래 칸을 전부 `MAX_UP` 으로만 쓰면 상수를 40으로 바꿔도
  //    기대값이 같이 따라 움직여 **일부러 부숴도 초록**이다(자기 자신을 기준 삼은 검사).
  //    실측: 상수를 40으로 바꾸고 돌렸더니 21칸 전부 통과했다.
  assert.equal(MAX_UP, 12, "상한이 바뀌었다 - 값을 바꾸려면 이 줄과 훅 주석의 '최대 12번'을 함께 고친다");
  const home = tmpDir("br-g-");
  const mk = (depth) => {
    const boardAt = join(home, "repo-" + depth);
    let d = boardAt;
    for (let i = 0; i < depth; i++) d = join(d, "d" + i);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(boardAt, FILE), TEMPLATE);
    return { boardAt, deep: d };
  };
  const ok = mk(MAX_UP - 1);      // 켠 폴더까지 세어 딱 상한
  assert.equal(findBoardDir(ok.deep, { HOME: home }), ok.boardAt);
  const over = mk(MAX_UP);        // 한 단 더
  assert.equal(findBoardDir(over.deep, { HOME: home }), null, "상한이 실효가 없다");
});

test("경계 셋이 board-core.mjs 의 resolveRoot 와 같다", () => {
  // 🛑 규칙을 두 벌로 적어 두면 한쪽만 고쳐진다. 같은 입력에 같은 판단인지 여기서 붙들어 둔다.
  //    resolveRoot 는 **부모가 경계면** 형제를 안 훑는다(single) - 이 함수의 "부모가 경계면 멈춘다"와 같은 말이다.
  for (const [cwd, env] of [
    ["/home/u/proj", { HOME: "/home/u" }],
    ["/home/u", { HOME: "/nowhere" }],
    ["/proj", { HOME: "/nowhere" }],
  ]) {
    assert.equal(resolveRoot(cwd, env).single, true, `${cwd}: resolveRoot 가 안 멈춘다`);
    assert.equal(isBoundaryDir(dirname(cwd), env), true, `${cwd}: 부모를 경계로 안 본다`);
  }
  assert.equal(resolveRoot("/srv/work/proj", {}).single, false);
  assert.equal(isBoundaryDir("/srv/work", { HOME: "/home/u" }), false);
});

// ── 배선: 훅 셋이 이 하나를 부른다 ───────────────────────────────────────────

const HOOK_FILES = ["activate.js", "pretooluse.js", "posttooluse.js"];

test("훅 셋이 전부 board-root-core.js 를 부른다", () => {
  for (const f of HOOK_FILES) {
    const src = readFileSync(join(HOOKS, f), "utf8");
    assert.ok(src.includes('require("./board-root-core.js")'), `${f} 가 판정을 안 부른다 - 사본을 들고 있을 것이다`);
  }
});

test("훅 안에 옛 판정(켠 폴더만 보기)이 되살아나지 않았다", () => {
  // 이 문자열이 다시 나타나면 세 답이 또 갈린다. 되살아난 자리를 이름으로 짚어 준다.
  for (const f of HOOK_FILES) {
    const src = readFileSync(join(HOOKS, f), "utf8");
    for (const bad of ['path.join(cwd, BOARD_FILE)', 'path.join(process.cwd(), "status.md")']) {
      assert.ok(!src.includes(bad), `${f} 에 옛 판정이 되살아났다: ${bad}`);
    }
  }
});

test("이 파일이 없어져도 규칙 6조각은 살아 있다(편의가 안전을 데려가지 않는다)", () => {
  // 🛑 상황판은 편의고, 같은 조각을 쓰는 무인 부록은 **안전**이다(멈추는 법·한도·바깥 통신).
  //    이 모듈 하나가 없을 때(업데이트 중단·백신 격리) 규칙이 통째로 안내 한 줄로 바뀌면,
  //    하필 사람이 자리에 없는 세션에서 안전 상세만 조용히 빠진다.
  const inst = tmpDir("br-noboard-");
  mkdirSync(join(inst, "hooks"), { recursive: true });
  mkdirSync(join(inst, "rules"), { recursive: true });
  for (const [d, f] of [["hooks", "activate.js"], ["hooks", "activate-core.js"],
                        ["rules", "operating-rules.md"], ["rules", "unattended-appendix.md"]])
    copyFileSync(join(SRC, d, f), join(inst, d, f));    // board-root-core.js 는 일부러 뺀다
  const s = scene("br-noboard-cwd-", { board: true });
  const r = spawnSync(process.execPath, [join(inst, "hooks", "activate.js"), "4"],
    { cwd: s.proj, env: { ...BASE, ...s.env }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("# Stop rules"),
    `상황판 판정 모듈 하나가 규칙 조각을 데려갔다: ${JSON.stringify(r.stdout)}`);
});

test("매니페스트에 실려 배포판까지 간다", () => {
  const m = JSON.parse(readFileSync(join(SRC, "manifest.src.json"), "utf8"));
  assert.ok(m.components.hooks.includes("board-root-core.js"),
    "매니페스트에 없으면 소스에서만 있고 배포판에서 훅 셋이 한꺼번에 죽는다");
});

// ── 행동층: 훅 셋을 실제로 돌려 같은 답인지 본다 ─────────────────────────────

const BASE = { ...process.env };
for (const k of Object.keys(BASE)) { if (k.startsWith("CHAGEUN_")) delete BASE[k]; }
delete BASE.CLAUDE_PLUGIN_ROOT;

const GIT_ID = ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"];
function git(dir, args) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + " 실패: " + (r.stderr || r.stdout || ""));
}

// 실측 모양 그대로(test/statusboard-auto.test.mjs 와 같은 조각).
const rec = (o) => JSON.stringify(o) + "\n";
function spawnRec(callId, agentId, desc, at) {
  const ts = new Date(at).toISOString();
  return rec({ type: "assistant", uuid: "u-" + agentId, timestamp: ts, message: { role: "assistant", content: [
    { type: "tool_use", id: callId, name: "Task", input: { description: desc, subagent_type: "code-implementer", prompt: "지시문" } },
  ] } }) +
  rec({ type: "user", uuid: "r-" + agentId, timestamp: ts, message: { role: "user", content: [
    { type: "tool_result", tool_use_id: callId, content: "agentId: " + agentId + " (use SendMessage with to: '" + agentId + "')" },
  ] } });
}

function runHook(file, input, env) {
  const r = spawnSync(process.execPath, [join(HOOKS, file)], {
    input: JSON.stringify(input), env: { ...BASE, ...env }, encoding: "utf8",
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// 세션 시작 훅(activate.js)은 stdin 이 아니라 **켠 폴더**로만 판정한다.
function runActivate(cwd, env) {
  const core = require(join(HOOKS, "activate-core.js"));
  const r = spawnSync(process.execPath, [join(HOOKS, "activate.js"), String(core.APPENDIX_PIECE)], {
    cwd, env: { ...BASE, ...env }, encoding: "utf8",
  });
  return { code: r.status, out: r.stdout || "" };
}

const delegate = (cwd, sid) => ({
  tool_name: "Task", tool_input: { subagent_type: "general-purpose", prompt: "x" },
  cwd, session_id: sid,
});

test("행동층: 상황판이 위에 있으면 훅 셋이 **다 같이** 있다고 본다", () => {
  const s = scene("br-h-", { board: true });
  const cache = tmpDir("br-cache-");
  // 1) 세션 시작: 부록이 붙는다
  assert.ok(runActivate(s.nested, s.env).out.includes("상황판 `status.md`"), "activate 가 못 찾았다");
  // 2) 안내: "없습니다" 가 **안** 나간다
  const pre = runHook("pretooluse.js", delegate(s.nested, "br-h1"), { ...s.env, XDG_CACHE_HOME: cache });
  assert.equal(pre.code, 0);
  assert.ok(!/작업 상황판/.test(pre.out), "있는데도 없다고 안내했다(같은 세션에서 두 지시가 충돌한다)");
});

test("행동층: 어디에도 없으면 훅 셋이 **다 같이** 없다고 본다", () => {
  const s = scene("br-i-");
  const cache = tmpDir("br-cache2-");
  assert.equal(runActivate(s.nested, s.env).out, "", "없는데 부록이 붙었다");
  const pre = runHook("pretooluse.js", delegate(s.nested, "br-i1"), { ...s.env, XDG_CACHE_HOME: cache });
  assert.equal(pre.code, 0);
  assert.match(pre.out, /작업 상황판/, "없는데 안내가 안 나갔다");
});

test("행동층: 홈의 상황판으로는 훅 셋이 **다 같이** 없다고 본다", () => {
  const s = scene("br-j-", { homeBoard: true });
  const cache = tmpDir("br-cache3-");
  assert.equal(runActivate(s.proj, s.env).out, "", "홈의 상황판을 제 것으로 집었다");
  const pre = runHook("pretooluse.js", delegate(s.proj, "br-j1"), { ...s.env, XDG_CACHE_HOME: cache });
  assert.match(pre.out, /작업 상황판/, "홈의 상황판을 제 것으로 집어 안내를 삼켰다");
});

// PostToolUse(§2 자동 갱신)는 git 저장소가 있어야 한 바퀴가 돈다.
function autoScene(prefix, ignoreLine) {
  const home = tmpDir(prefix);
  const repo = join(home, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  appendFileSync(join(repo, ".git", "info", "exclude"), ignoreLine + "\n");
  writeFileSync(join(repo, FILE), TEMPLATE);
  const nested = join(repo, ".claude", "worktrees", "agent-abc123");
  mkdirSync(nested, { recursive: true });
  const tpath = join(repo, "t.jsonl");
  writeFileSync(tpath, spawnRec("call_1", "aac7930e76fa2c5e9", "상황판 자동 갱신", Date.now()));
  return { home, repo, nested, tpath, board: join(repo, FILE), env: { HOME: home } };
}
const fireAuto = (s, sid, cache) => runHook("posttooluse.js", {
  session_id: sid, transcript_path: s.tpath, cwd: s.nested,
  tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "ok",
}, { ...s.env, XDG_CACHE_HOME: cache });

test("행동층: 작업방에서 켜도 §2 가 저장소 뿌리의 상황판에 쓰인다", () => {
  const s = autoScene("br-k-", FILE);
  assert.equal(fireAuto(s, "br-k1", tmpDir("br-cache4-")).code, 0);
  assert.match(readFileSync(s.board, "utf8"), /상황판 자동 갱신/,
    "켠 폴더만 봐서 뿌리 상황판의 §2 가 그 세션 내내 안 갱신된다");
  assert.ok(!existsSync(join(s.nested, FILE)), "작업방 안에 상황판을 새로 만들었다");
});

test("행동층: 무시 판정도 상황판이 있는 폴더에서 짓는다(뿌리만 막은 규칙)", () => {
  // `/status.md` 는 뿌리의 그 파일 하나만 막는다. 켠 폴더(작업방)로 물으면 "안 막혔다"는
  // 답이 와서, 지금 쓰려는 파일이 아닌 다른 파일에 대한 답으로 안전장치가 선다.
  const s = autoScene("br-l-", "/" + FILE);
  assert.equal(fireAuto(s, "br-l1", tmpDir("br-cache5-")).code, 0);
  assert.match(readFileSync(s.board, "utf8"), /상황판 자동 갱신/, "무시 판정을 엉뚱한 폴더에서 지었다");
});

test("행동층: 어디에도 없으면 §2 는 아무 파일도 안 만든다", () => {
  const s = autoScene("br-m-", FILE);
  const bare = join(s.home, "other");            // 상황판이 없는 별개 프로젝트
  mkdirSync(bare, { recursive: true });
  const cache = tmpDir("br-cache6-");
  const r = runHook("posttooluse.js", {
    session_id: "br-m1", transcript_path: s.tpath, cwd: bare,
    tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "ok",
  }, { ...s.env, XDG_CACHE_HOME: cache });
  assert.equal(r.code, 0);
  assert.ok(!existsSync(join(bare, FILE)), "없는 상황판을 훅이 만들었다");
  assert.ok(!existsSync(join(cache, "chageun", "board-tasks", "br-m1.json")),
    "상황판이 없는데 장부를 쌓기 시작했다");
});
