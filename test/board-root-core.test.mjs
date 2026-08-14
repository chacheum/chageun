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
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, copyFileSync, cpSync, rmSync } from "node:fs";
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

const { findBoardDir, findBoardPath, isBoundaryDir, homeDirOf, FILE, MAX_UP, BOUNDARY_NAMES } = boardRoot;
const MARK = "<!-- chageun:auto -->";   // 하드 차단의 내용 신호(경로만으로는 안 무장된다)

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

test("`/home` · `/Users` 도 경계다(홈이 딴 데여도 남의 홈 트리로 안 오른다)", () => {
  // 없는 이름을 쓴다: 이 기계의 진짜 홈을 건드리지 않는다.
  // `/Users` 는 macOS 의 홈 부모다 - 차근은 공개 플러그인이라 리눅스 이름만 알면 그 기계에서
  // 한 단 더 오른다. 이 저장소는 리눅스에서 도니 **경로 문자열로만** 잰다.
  assert.equal(findBoardDir("/home/nobody-xyz/proj", { HOME: "/nowhere" }), null);
  assert.equal(findBoardDir("/Users/nobody-xyz/proj", { HOME: "/nowhere" }), null);
  for (const b of ["/", "/home", "/Users"]) assert.equal(isBoundaryDir(b, { HOME: "/nowhere" }), true, b);
  assert.equal(isBoundaryDir("/home/nobody-xyz", { HOME: "/nowhere" }), false);
  assert.deepEqual(BOUNDARY_NAMES, ["/", "/home", "/Users"]);
});

test(`상한 ${MAX_UP}단: 그 안이면 찾고 넘으면 포기한다`, () => {
  // 🛑 **숫자를 여기 그대로 박는다.** 아래 칸을 전부 `MAX_UP` 으로만 쓰면 상수를 40으로 바꿔도
  //    기대값이 같이 따라 움직여 **일부러 부숴도 초록**이다(자기 자신을 기준 삼은 검사).
  //    실측: 상수를 40으로 바꾸고 돌렸더니 21칸 전부 통과했다.
  assert.equal(MAX_UP, 12, "상한이 바뀌었다 - 값을 바꾸려면 이 줄과 훅 주석의 '최대 12번'을 함께 고친다");
  // 같은 자기참조가 `FILE` 에도 있다: 시나리오와 기대값 양쪽에 쓰이니 값 자체를 박아 둔다.
  assert.equal(FILE, "status.md", "파일 이름이 바뀌면 상황판이 한 프로젝트에 두 장 생긴다");
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
    ["/Users/u", { HOME: "/nowhere" }],     // macOS 홈 부모도 양쪽이 같이 안다
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

test("하드 차단이 두 자리(켠 폴더 · 찾은 자리)를 합집합으로 본다", () => {
  // 🛑 앞 판에는 여기에 "옛 판정 문자열이 없다"는 감시가 있었는데 **지키는 척만 했다**:
  //    감시 문자열이 `path.join(cwd, BOARD_FILE)` 인데 옛 판정은 `path.resolve(…)` 였고,
  //    지금 코드는 `here` 를 만들며 그 표현을 정당하게 쓴다. 다음 사람을 속이는 줄이라
  //    지우고, 실제로 지켜야 할 성질(합집합 두 갈래가 남아 있는가)로 바꾼다.
  //    행동층은 아래 차단 칸들이 잰다 - 이 칸은 갈래가 통째로 사라지는 것만 짚는다.
  const src = readFileSync(join(HOOKS, "pretooluse.js"), "utf8");
  assert.ok(/abs !== here && abs !== boardRoot\.findBoardPath\(cwd\)/.test(src),
    "합집합 두 갈래 중 하나가 사라졌다 - 켠 폴더만 보면 뿌리 상황판이, 찾은 자리만 보면 새로 만드는 편집이 차단 밖으로 나간다");
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

test("모듈이 없을 때 쓰는 대체 객체가 내보내는 칸을 전부 갖는다", () => {
  // 🛑 빠뜨린 칸은 **모듈이 없을 때만** undefined 라, 나중에 그 칸을 쓰는 코드가 이 갈래에서만
  //    조용히 어긋난다(가장 늦게 발견되는 방향). 이름 목록으로 양방향 대조한다.
  const src = readFileSync(join(HOOKS, "pretooluse.js"), "utf8");
  const block = src.slice(src.indexOf("let boardRoot = {"), src.indexOf("};", src.indexOf("let boardRoot = {")));
  for (const k of Object.keys(boardRoot))
    assert.ok(block.includes(k + ":"), `대체 객체에 \`${k}\` 칸이 없다`);
  assert.ok(block.includes('FILE: "status.md"'), "대체값의 파일 이름이 모듈과 달라졌다");
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
  // 🛑 "작업 상황판" 이라는 낱말로만 재면 안 된다: 있는 세션에 나가는 안내(경로·§2 사정)도
  //    그 낱말을 쓴다. **"없습니다" 갈래가 나갔는가**만 본다.
  assert.ok(!/상황판\(`status.md`\)이 없습니다/.test(pre.out),
    "있는데도 없다고 안내했다(같은 세션에서 두 지시가 충돌한다)");
});

test("행동층: 어디에도 없으면 훅 셋이 **다 같이** 없다고 본다", () => {
  const s = scene("br-i-");
  const cache = tmpDir("br-cache2-");
  assert.equal(runActivate(s.nested, s.env).out, "", "없는데 부록이 붙었다");
  const pre = runHook("pretooluse.js", delegate(s.nested, "br-i1"), { ...s.env, XDG_CACHE_HOME: cache });
  assert.equal(pre.code, 0);
  assert.match(pre.out, /작업 상황판/, "없는데 안내가 안 나갔다");
});

test("상황판이 위에 있는 세션은 절대 경로와 §2 를 안 쓴다는 것을 안내받는다", () => {
  // 얼어붙은 `마지막 확인` 은 "낡았다"로도 "안 돈다"로도 읽혀 눈에 보이는 것만으로는
  // 신호가 안 된다. 세션당 한 번 말로 알린다.
  const s = scene("br-say-", { board: true });
  const r = runHook("pretooluse.js", delegate(s.nested, "br-say1"),
    { ...s.env, XDG_CACHE_HOME: tmpDir("br-cache11-") });
  assert.equal(r.code, 0, "안내는 차단이 아니다");
  assert.ok(r.out.includes(join(s.proj, FILE)), "찾은 상황판의 절대 경로를 안 알려 준다");
  assert.match(r.out, /§2/, "이 세션이 §2 를 안 쓴다는 사실을 안 알려 준다");
  assert.ok(!/상황판\(`status.md`\)이 없습니다/.test(r.out), "있는데 없다고 말했다");
});

test("위에 있는데 여기에 또 만들려 하면 그 자리에서 알린다(본보기 표시가 있어도)", () => {
  // 🛑 본보기에는 `chageun:auto` 가 있어 `armed` 로 잡히고, 작업방은 뿌리와 같은 무시 규칙을
  //    공유해 차단이 통과한다. 그 순간부터 기계가 작업방 파일에 쓰고 뿌리 상황판은 멈춘다.
  const s = scene("br-dup-", { board: true });
  const r = runHook("pretooluse.js", {
    tool_name: "Write", cwd: s.nested, session_id: "br-dup1",
    tool_input: { file_path: join(s.nested, FILE), content: TEMPLATE },
  }, { ...s.env, XDG_CACHE_HOME: tmpDir("br-cache12-") });
  assert.equal(r.code, 0, "차단이 아니라 안내다");
  assert.match(r.out, /이미/, "이미 위에 있다는 말이 없다");
  assert.ok(r.out.includes(join(s.proj, FILE)), "어디에 있는지 절대 경로를 안 준다");
});

test("위에 없으면 새로 만드는 편집 안내는 옛 모양 그대로", () => {
  // 표시 없는 새 파일 → 무시 절차 안내 · 표시 있는 새 파일 → 조용(옛 조건).
  const s = scene("br-new-");
  const mk = (content, sid) => runHook("pretooluse.js", {
    tool_name: "Write", cwd: s.proj, session_id: sid,
    tool_input: { file_path: join(s.proj, FILE), content },
  }, { ...s.env, XDG_CACHE_HOME: tmpDir("br-cache13-") });
  assert.match(mk("# 손으로 만든 판\n", "br-new1").out, /무시 절차/, "표시 없는 새 파일 안내가 사라졌다");
  const armed = mk(TEMPLATE, "br-new2").out;
  assert.ok(!/이미/.test(armed), "위에 아무것도 없는데 '이미 있다'고 했다");
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
const fireAuto = (s, sid, cache, cwd) => runHook("posttooluse.js", {
  session_id: sid, transcript_path: s.tpath, cwd,
  tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "ok",
}, { ...s.env, XDG_CACHE_HOME: cache });

test("행동층: 뿌리 세션은 §2 를 쓴다(경계 한 줄이 정상 갈래까지 막지 않았다)", () => {
  const s = autoScene("br-k-", FILE);
  assert.equal(fireAuto(s, "br-k1", tmpDir("br-cache4-"), s.repo).code, 0);
  assert.match(readFileSync(s.board, "utf8"), /상황판 자동 갱신/, "뿌리 세션이 §2 를 못 썼다");
});

test("행동층: 작업방 세션은 뿌리 상황판 §2 를 안 건드린다(세션끼리 서로 지우는 것을 막는다)", () => {
  // 🛑 찾기를 위로 넓히면 뿌리 세션과 그 아래 작업방 세션들이 **같은 파일 하나**를 대상으로
  //    삼는다. 세션마다 장부가 따로라 각자 자기 목록으로 §2 전체를 갈아 끼운다: 서로의 줄을
  //    조용히 지운다. 하위 세션은 읽기만 한다.
  const s = autoScene("br-l-", FILE);
  const before = readFileSync(s.board, "utf8");
  assert.equal(fireAuto(s, "br-l1", tmpDir("br-cache5-"), s.nested).code, 0);
  assert.equal(readFileSync(s.board, "utf8"), before,
    "작업방 세션이 뿌리 상황판을 갈아 끼웠다 - 뿌리 세션의 §2 줄이 조용히 지워진다");
  assert.ok(!existsSync(join(s.nested, FILE)), "작업방 안에 상황판을 새로 만들었다");
});

// ── 모듈이 없어져도 차단은 산다 ──────────────────────────────────────────────
//
// 🛑 최상위 require 는 **모듈 로드 시점**에 던져서 훅 안 어떤 try/catch 도 못 잡는다. 훅이
//    종료코드 1 로 죽으면 하네스는 "막지 않는 오류"로 보고 도구를 그대로 실행한다: 상황판과
//    아무 상관 없는 비밀값·push·무인 park 차단이 그 세션 내내 통째로 꺼지고 화면에는 아무
//    표시도 안 난다. 이 칸이 없으면 그 사고가 검사에 안 걸린다.

// src 한 벌을 임시로 복사하고 파일 하나를 뺀다(훅이 형제 모듈과 ../skills 를 부른다).
function srcWithout(prefix, rel) {
  const dir = tmpDir(prefix);
  cpSync(SRC, dir, { recursive: true });
  rmSync(join(dir, rel), { force: true });
  return join(dir, "hooks");
}

const DESTRUCTIVE = { tool_name: "Bash", tool_input: { command: "psql -c 'DROP TABLE users;'" }, cwd: "/srv/app" };

for (const missing of ["hooks/board-root-core.js", "hooks/board-ignore-core.js", "hooks/tool-ledger-core.js"]) {
  test(`${missing.split("/")[1]} 가 없어도 PreToolUse 차단은 종료코드 2 를 낸다`, () => {
    const hooks = srcWithout("br-miss-", missing);
    const r = spawnSync(process.execPath, [join(hooks, "pretooluse.js")],
      { input: JSON.stringify(DESTRUCTIVE), env: BASE, encoding: "utf8" });
    assert.equal(r.status, 2,
      `종료코드 ${r.status} - 2가 아니면 하네스가 도구를 그대로 실행한다(차단이 통째로 꺼진 것): ` +
      JSON.stringify((r.stderr || "").slice(0, 200)));
  });
}

for (const missing of ["hooks/board-root-core.js", "hooks/statusboard-auto-core.js"]) {
  test(`${missing.split("/")[1]} 가 없어도 PostToolUse 의 .env 가리기는 산다`, () => {
    const hooks = srcWithout("br-miss2-", missing);
    const proj = tmpDir("br-env-");
    const value = "sk-" + "9f2b7c41aa";                 // 가짜 열쇠(값은 보고에 안 적는다)
    writeFileSync(join(proj, ".env"), "API_KEY=" + value + "\n");
    const r = spawnSync(process.execPath, [join(hooks, "posttooluse.js")], {
      input: JSON.stringify({ cwd: proj, tool_name: "Bash", tool_input: { command: "cat .env" },
        tool_response: "API_KEY=" + value }),
      env: BASE, encoding: "utf8",
    });
    assert.equal(r.status, 0, "훅이 죽었다: " + JSON.stringify((r.stderr || "").slice(0, 200)));
    assert.ok(r.stdout.includes("updatedToolOutput"), "가리기가 통째로 꺼졌다");
    assert.ok(!r.stdout.includes(value), "가린다면서 값이 그대로 나갔다");
  });
}

// ── 하드 차단이 제품이 가리키는 상황판을 본다 ────────────────────────────────

test("작업방에서 뿌리 상황판에 비밀값을 넣는 편집이 차단된다", () => {
  // 🛑 상황판은 평문 업무 보고서이고 웹으로도 보인다. 접속 정보가 적히는 것을 막는 겹이
  //    이 차단뿐인데, 켠 폴더만 보던 판에서는 작업방 세션의 그 편집이 통째로 밖에 있었다.
  // 🛑 `.env` 는 **저장소 뿌리에만** 둔다 - 이것이 실제 작업방 모양이다. `git worktree add` 는
  //    추적 안 하는 파일을 안 옮기므로 새 작업방에는 `.env` 가 없다. 켠 폴더에 심어 두고 재면
  //    "차단이 돈다"가 아니라 "심어 둔 것을 봤다"를 재는 검사가 된다(2회차 게이트 지적).
  //    같은 모양이 `<저장소>/frontend` 처럼 평범한 하위 폴더 세션에도 그대로 있다.
  const s = scene("br-leak-", { board: MARK + "\n| 무엇 | 언제 |\n" });
  const value = "sk-" + "live-3c81d0aa27";              // 가짜 열쇠(값은 보고에 안 적는다)
  writeFileSync(join(s.proj, ".env"), "DB_URL=" + value + "\n");
  const r = runHook("pretooluse.js", {
    tool_name: "Edit", cwd: s.nested, session_id: "br-leak1",
    tool_input: { file_path: join(s.proj, FILE), old_string: "| 무엇 | 언제 |", new_string: "| 접속 | " + value + " |" },
  }, { ...s.env, XDG_CACHE_HOME: tmpDir("br-cache7-") });
  assert.equal(r.code, 2, "작업방에서 뿌리 상황판에 비밀값을 넣는 편집이 안 막혔다");
  assert.match(r.err, /값은 여기 다시 적지 않습니다/, "비밀값 전용 사유가 아니라 다른 차단에 걸렸다");
  assert.ok(!r.err.includes("되돌리기 어려운 고위험 명령"), "일반 문구로 떨어졌다");
  assert.ok(!r.err.includes(value), "차단하면서 값을 다시 적었다");
});

test("작업방에서 git 이 안 막은 뿌리 상황판을 고치면 차단된다", () => {
  // 이쪽 겹은 `.env` 와 무관해서 작업방 세션을 온전히 덮는다: 무시 판정은 **찾은 상황판의
  // 폴더**에서 짓는다(`path.dirname(boardTarget.abs)`).
  const home = tmpDir("br-unign-");
  const repo = join(home, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);                            // 무시 줄을 일부러 안 넣는다
  writeFileSync(join(repo, FILE), MARK + "\n| 무엇 | 언제 |\n");
  const nested = join(repo, ".claude", "worktrees", "agent-abc123");
  mkdirSync(nested, { recursive: true });
  const r = runHook("pretooluse.js", {
    tool_name: "Edit", cwd: nested, session_id: "br-unign1",
    tool_input: { file_path: join(repo, FILE), old_string: "| 무엇 | 언제 |", new_string: "| 한 일 | 오늘 |" },
  }, { HOME: home, XDG_CACHE_HOME: tmpDir("br-cache9-") });
  assert.equal(r.code, 2, "안 막힌 뿌리 상황판을 작업방에서 고치는 편집이 통과했다");
  assert.match(r.err, /check-ignore|무시/, "무시 전용 사유가 아니라 다른 차단에 걸렸다");
  assert.ok(!r.err.includes("되돌리기 어려운 고위험 명령"), "일반 문구로 떨어졌다");
});

test("켠 폴더에만 `.env` 가 있어도 그대로 차단된다(합집합의 다른 쪽)", () => {
  const s = scene("br-leak2-", { board: MARK + "\n| 무엇 | 언제 |\n" });
  const value = "sk-" + "live-77aa10bb43";
  writeFileSync(join(s.nested, ".env"), "DB_URL=" + value + "\n");
  const r = runHook("pretooluse.js", {
    tool_name: "Edit", cwd: s.nested, session_id: "br-leak2a",
    tool_input: { file_path: join(s.proj, FILE), old_string: "| 무엇 | 언제 |", new_string: "| 접속 | " + value + " |" },
  }, { ...s.env, XDG_CACHE_HOME: tmpDir("br-cache10-") });
  assert.equal(r.code, 2, "켠 폴더 쪽 사전이 사라졌다");
  assert.ok(!r.err.includes(value), "차단하면서 값을 다시 적었다");
});

test("남의 팀 status.md 오차단은 그대로 0(내용 신호가 없으면 안 막는다)", () => {
  // 저장소 뿌리에 원래부터 status.md 를 두고 git 으로 추적하는 프로젝트가 정확히 그 경로다.
  const s = scene("br-other-", { board: "# 우리 팀 상태\n\n아무 표시 없음\n" });
  const value = "sk-" + "live-3c81d0aa27";
  writeFileSync(join(s.proj, ".env"), "DB_URL=" + value + "\n");
  const r = runHook("pretooluse.js", {
    tool_name: "Edit", cwd: s.nested, session_id: "br-other1",
    tool_input: { file_path: join(s.proj, FILE), old_string: "아무 표시 없음", new_string: "고침" },
  }, { ...s.env, XDG_CACHE_HOME: tmpDir("br-cache8-") });
  assert.equal(r.code, 0, "표시 없는 남의 status.md 를 막았다 - 오차단이 이 저장소의 최대 실패 양식이다");
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
