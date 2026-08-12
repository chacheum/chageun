// 상황판 훅(v0.65.0 F-27): 안내 한 번(soft) + 하드 차단 둘(비밀 값 · 안 막힌 상황판).
//
// 🛑 **차단이 도는지 재는 칸의 임시 `status.md` 에는 경계 표시(`chageun:auto`)를 넣는다.**
//    두 차단은 경로만 보지 않고 **내용 신호**까지 본다(8판 B-H1). 표시가 없는 붙임 파일을 쓰면
//    "차단" 칸들이 전부 통과로 뒤집혀 **검사가 아무것도 안 잡는다.** 회복 뒤 0을 기대하는 칸
//    ("스스로 풀림"·"추적 끊으면 풀린다")도 마찬가지다 — 표시 없이 0이 나오면 회복이 아니라
//    애초에 안 돈 것이라 아무것도 증명 못 한다. 일부러 표시가 없어야 하는 칸은 셋뿐이다:
//    "표시 없는 남의 루트 status.md" 와 "만드는 편집" 두 칸.
//
// 🛑 **임시 `XDG_CACHE_HOME` 에 `chageun/board-notice` 를 미리 만들지 않는다.** 미리 만들면
//    `mkdirSync` 를 빼먹은 구현도 초록으로 통과하고, 정작 새 사용자 기계에서만 조용히 안 울린다.
//
// ⚠ **안내 칸의 편집 대상은 `/tmp` 밖 경로로 준다.** 임시 폴더가 `/tmp` 아래라 그대로 쓰면
//    `statusboardTrigger` 의 스크래치 규칙에 걸려 안내가 영영 안 나가고, 그 칸이 늘 통과한다.
//    반대로 하드 차단과 "만드는 편집" 안내는 스크래치를 안 보므로 임시 저장소 안에서 잰다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { tmpDir } from "./support-tmpdir.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse.js");
const MARK = "<!-- chageun:auto -->";
const SECRET = "sk-live-9f2b7c41aa";           // 길이 6 이상이어야 findLeaks 가 본다
const OUTSIDE = "/srv/app/a.txt";               // 스크래치가 아닌 편집 대상
const BOARD_TEXT = MARK + "\n| 무엇 | 언제 |\n";

const BASE = { ...process.env };
for (const k of Object.keys(BASE)) { if (k.startsWith("CHAGEUN_")) delete BASE[k]; }

function run(input, opts = {}) {
  const env = { ...BASE, ...(opts.env || {}) };
  env.XDG_CACHE_HOME = opts.cache || tmpDir("cache-");
  if (opts.path !== undefined) env.PATH = opts.path;
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input), env, encoding: "utf8", cwd: opts.spawnCwd,
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// 가짜 git: 부르면 표식 파일에 한 줄 남기고 1로 끝난다.
// 🛑 "PATH 에서 git 을 빼기"로는 못 잰다 — 없으면 `execFileSync` 가 ENOENT 로 던져 판정이
//    "unknown"(통과)이 되어, **불렀는데도 초록**이 된다. 부른 사실 자체를 파일로 남긴다.
function fakeGit() {
  const dir = tmpDir("nogit-");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const mark = join(dir, "called");
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(mark)}\nexit 1\n`);
  chmodSync(join(bin, "git"), 0o755);
  return { path: bin, called: () => existsSync(mark) };
}

const GIT_ID = ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"];
function git(dir, args) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + " 실패: " + (r.stderr || r.stdout || ""));
  return r;
}
function repo(prefix) { const d = tmpDir(prefix); git(d, ["init", "-q"]); return d; }
function ignoreBoard(dir) { appendFileSync(join(dir, ".git", "info", "exclude"), "status.md\n"); }

// 켠 폴더의 status.md 를 고치는 편집 하나.
const editBoard = (dir, newString, file) => ({
  tool_name: "Edit",
  tool_input: { file_path: file || join(dir, "status.md"), old_string: "옛 줄", new_string: newString },
  cwd: dir,
  session_id: "sb-" + Math.random().toString(36).slice(2),
});

// ── 안내(soft) ───────────────────────────────────────────────────────────────

const editOutside = (proj, sid) => ({
  tool_name: "Edit",
  tool_input: { file_path: OUTSIDE, old_string: "a", new_string: "b" },
  cwd: proj, session_id: sid,
});

test("첫 편집: 상황판 없는 폴더에서 안내가 나가고 막지 않는다", () => {
  const proj = tmpDir("proj-");
  const r = run(editOutside(proj, "s1"));
  assert.equal(r.code, 0, "안내는 차단이 아니다");
  assert.match(r.out, /작업 상황판/, "안내가 stdout 으로 나간다");
});

test("표식 폴더 없음: 빈 캐시 폴더에서도 안내가 나가고 폴더가 새로 생긴다", () => {
  const proj = tmpDir("proj-");
  const cache = tmpDir("cache-");              // 🛑 board-notice 를 미리 만들지 않는다
  const r = run(editOutside(proj, "s2"), { cache });
  assert.equal(r.code, 0);
  assert.match(r.out, /작업 상황판/);
  assert.ok(existsSync(join(cache, "chageun", "board-notice")), "표식 폴더를 스스로 만든다");
});

test("순서 못박음: 안내문이 파일보다 스킬을 먼저 열라고 말한다", () => {
  const r = run(editOutside(tmpDir("proj-"), "s3"));
  for (const frag of ["파일부터 만들지 말고", "chageun:statusboard", "먼저"]) {
    assert.ok(r.out.includes(frag), "안내문에 없음: " + frag);
  }
});

test("첫 위임: 파일을 안 만지고 위임만 해도 안내가 나간다", () => {
  const proj = tmpDir("proj-");
  const r = run({ tool_name: "Task", tool_input: { subagent_type: "general-purpose", prompt: "x" }, cwd: proj, session_id: "s4" });
  assert.equal(r.code, 0);
  assert.match(r.out, /작업 상황판/);
});

test("양보 ①: 앞 리마인더가 이기면 침묵하고 표식도 안 만든다", () => {
  const proj = tmpDir("proj-");
  const cache = tmpDir("cache-");
  const tpath = join(proj, "t.jsonl");
  writeFileSync(tpath, JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "위임 준비" }] } }) + "\n");
  // ⚠ `tool_input.subagent_type`(누구에게 위임하는가)만 채운다. `agent_type`(훅이 서브에이전트
  //    안에서 도는가)을 채우면 다른 이유로 침묵해 아무것도 안 잡는다.
  const r = run({
    tool_name: "Task", tool_input: { subagent_type: "code-implementer", prompt: "x" },
    cwd: proj, session_id: "s5", transcript_path: tpath,
  }, { cache });
  assert.equal(r.code, 0);
  assert.match(r.out, /chageun:routing/, "라우팅 리마인더가 나간다");
  assert.ok(!/작업 상황판/.test(r.out), "상황판 안내는 양보한다");
  const dir = join(cache, "chageun", "board-notice");
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], [], "표식도 안 만든다");
});

test("양보 ②: 미룸이지 취소가 아니다 — 다음 편집에서 다시 나간다", () => {
  const proj = tmpDir("proj-");
  const cache = tmpDir("cache-");
  const tpath = join(proj, "t.jsonl");
  writeFileSync(tpath, JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "위임 준비" }] } }) + "\n");
  run({ tool_name: "Task", tool_input: { subagent_type: "code-implementer", prompt: "x" }, cwd: proj, session_id: "s6", transcript_path: tpath }, { cache });
  const r = run(editOutside(proj, "s6"), { cache });
  assert.match(r.out, /작업 상황판/, "양보한 세션에서 다음 편집에 다시 나가야 한다");
});

test("두 번째 호출: 같은 세션에서는 한 번만", () => {
  const proj = tmpDir("proj-");
  const cache = tmpDir("cache-");
  assert.match(run(editOutside(proj, "s7"), { cache }).out, /작업 상황판/);
  assert.equal(run(editOutside(proj, "s7"), { cache }).out, "", "두 번째는 침묵");
});

test("상황판 있음 · 서브에이전트 · Bash · 스크래치: 아무 말도 안 한다", () => {
  const withBoard = tmpDir("proj-");
  writeFileSync(join(withBoard, "status.md"), BOARD_TEXT);
  assert.equal(run(editOutside(withBoard, "s8")).out, "", "상황판이 있으면 침묵");

  const proj = tmpDir("proj-");
  const sub = { ...editOutside(proj, "s9"), agent_type: "code-implementer" };
  assert.equal(run(sub).out, "", "서브에이전트 안에서는 침묵");

  assert.equal(run({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: proj, session_id: "s10" }).out, "", "Bash 는 착수 신호가 아니다");

  const scratch = { tool_name: "Edit", tool_input: { file_path: "/tmp/x/a.txt", old_string: "a", new_string: "b" }, cwd: proj, session_id: "s11" };
  assert.equal(run(scratch).out, "", "스크래치 편집은 착수가 아니다");
});

test("표식 불가: 캐시를 못 써도 조용히 넘어가고 절대 안 막는다", () => {
  const proj = tmpDir("proj-");
  const blocked = join(tmpDir("cache-"), "notafolder");
  writeFileSync(blocked, "");                  // 파일이라 그 아래로 폴더를 못 판다
  const r = run(editOutside(proj, "s12"), { cache: blocked });
  assert.equal(r.code, 0, "표식을 못 만들어도 차단은 없다");
  assert.equal(r.out, "", "중복을 못 막으면 아예 말하지 않는다");
});

// ── 하드 차단 1: 비밀 값 ──────────────────────────────────────────────────────

function secretProj() {
  const dir = tmpDir("secret-");             // git 저장소가 아니다 → 무시 판정은 unknown(통과)
  writeFileSync(join(dir, ".env"), "API_TOKEN=" + SECRET + "\n");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  return dir;
}

test("비밀 값: 새로 쓰는 글에 있으면 차단 · 다른 파일이나 값 없으면 통과", () => {
  const dir = secretProj();
  assert.equal(run(editBoard(dir, "열쇠는 " + SECRET + " 입니다")).code, 2, "상황판에 새로 들어가면 차단");
  assert.equal(run(editBoard(dir, "오늘 한 일 세 가지")).code, 0, "값이 없으면 통과");
  writeFileSync(join(dir, "other.md"), BOARD_TEXT);
  assert.equal(run(editBoard(dir, "열쇠는 " + SECRET + " 입니다", join(dir, "other.md"))).code, 0, "상황판이 아니면 이 차단 밖");
});

test("비밀 값: 회복 경로 — 이미 든 값을 빼는 편집은 통과한다", () => {
  const dir = secretProj();
  writeFileSync(join(dir, "status.md"), BOARD_TEXT + "옛 열쇠 " + SECRET + "\n");
  const r = run(editBoard(dir, "옛 열쇠 (지움)"));
  assert.equal(r.code, 0, "파일 전체를 재면 여기서 빨개진다 — 회복이 막히면 안 된다");
});

test("비밀 값: 문구가 전용 사유이고 값이 본문에 안 적힌다", () => {
  const dir = secretProj();
  const r = run(editBoard(dir, "열쇠는 " + SECRET + " 입니다"));
  assert.equal(r.code, 2);
  assert.match(r.err, /값은 여기 다시 적지 않습니다/, "전용 사유 문구");
  assert.ok(!r.err.includes("되돌리기 어려운 고위험 명령"), "일반 문구로 떨어지면 안 된다");
  assert.ok(!r.err.includes(SECRET), "차단하면서 값을 다시 적으면 안 된다");
  assert.match(r.err, /위반: API_TOKEN/, "걸린 열쇠 이름만 붙는다");
});

// ── 하드 차단 2: 무시가 확인 안 된 상황판 ─────────────────────────────────────

test("무시 안 됨: 차단되고, 무시 줄을 넣으면 스스로 풀린다", () => {
  const dir = repo("repo-");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  assert.equal(run(editBoard(dir, "오늘 한 일")).code, 2, "무시 줄이 없으면 차단");
  ignoreBoard(dir);
  assert.equal(run(editBoard(dir, "오늘 한 일")).code, 0, "무시 줄을 넣으면 스스로 풀린다");
});

test("추적 중이면 무시 줄이 있어도 여전히 차단 · 추적을 끊으면 풀린다", () => {
  const dir = repo("repo-");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  git(dir, ["add", "status.md"]);
  git(dir, ["commit", "-q", "-m", "board"]);
  ignoreBoard(dir);
  assert.equal(run(editBoard(dir, "오늘 한 일")).code, 2, "이미 올라간 상황판은 무시 줄만으로 안 풀린다");
  git(dir, ["rm", "-q", "--cached", "status.md"]);
  assert.equal(run(editBoard(dir, "오늘 한 일")).code, 0, "회복은 두 걸음이다");
});

test("무시 안 됨: git 밖이면 통과(fail-open)", () => {
  const dir = tmpDir("nogit-proj-");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  assert.equal(run(editBoard(dir, "오늘 한 일")).code, 0, "판정을 못 하면 막지 않는다");
});

test("무시 안 됨: 상황판이 아닌 편집에는 git 을 아예 안 부른다", () => {
  const dir = repo("repo-");
  const g = fakeGit();
  writeFileSync(join(dir, "notes.md"), "한 줄");
  const r = run(editBoard(dir, "한 줄 더", join(dir, "notes.md")), { path: g.path });
  assert.equal(r.code, 0);
  assert.equal(g.called(), false, "대상이 아니면 자식 프로세스 비용이 0이다");
});

test("무시 안 됨: 문구에 추적 끊는 두 걸음이 들어 있다", () => {
  const dir = repo("repo-");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  const r = run(editBoard(dir, "오늘 한 일"));
  assert.equal(r.code, 2);
  assert.match(r.err, /git rm --cached/, "추적 중인 사용자에게 명령을 보여 준다");
  assert.match(r.err, /추적을 끊은 뒤에 무시 절차를 한 번 더/, "이 문장이 없으면 막다른 길이다");
  assert.ok(!r.err.includes("되돌리기 어려운 고위험 명령"), "일반 문구로 떨어지면 안 된다");
});

// ── 대상 좁히기 ───────────────────────────────────────────────────────────────

test("대상 좁히기: 하위 폴더의 status.md 는 남의 문서다", () => {
  const dir = repo("repo-");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "status.md"), BOARD_TEXT);
  writeFileSync(join(dir, ".env"), "API_TOKEN=" + SECRET + "\n");
  const r = run(editBoard(dir, "열쇠 " + SECRET, join(dir, "sub", "status.md")));
  assert.equal(r.code, 0, "두 차단 모두 안 돈다");
});

test("대상 좁히기: 상대 경로도 켠 폴더 기준으로 판정한다", () => {
  const dir = repo("repo-");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  assert.equal(run(editBoard(dir, "오늘 한 일", "./status.md")).code, 2, "절대화해서 같은 판정");
  // 훅 프로세스의 cwd 를 다른 폴더로 두어도 판정이 안 흔들린다(입력의 cwd 를 본다).
  const other = tmpDir("elsewhere-");
  assert.equal(run(editBoard(dir, "오늘 한 일", "./status.md"), { spawnCwd: other }).code, 2);
});

test("대상 좁히기: 표시 없는 남의 루트 status.md 는 통과하고 git 도 안 부른다", () => {
  const dir = repo("repo-");
  const g = fakeGit();
  writeFileSync(join(dir, "status.md"), "# 팀 현황\n\n원래부터 저장소에 있던 문서다.\n");
  const r = run(editBoard(dir, "한 줄 더"), { path: g.path });
  assert.equal(r.code, 0, "루트에 status.md 를 두고 추적하는 프로젝트를 통째로 막으면 안 된다");
  assert.equal(g.called(), false, "내용 신호에서 끝나 git 을 안 부른다");
});

test("대상 좁히기: 표시가 있으면 여전히 차단 · 표시를 넣는 그 편집도 차단", () => {
  const dir = repo("repo-");
  writeFileSync(join(dir, "status.md"), "# 팀 현황\n");
  assert.equal(run(editBoard(dir, MARK + "\n지금 도는 것\n")).code, 2, "표시를 넣는 편집 자체가 무장 시점이다");
  writeFileSync(join(dir, "status.md"), BOARD_TEXT);
  assert.equal(run(editBoard(dir, "오늘 한 일")).code, 2, "표시가 있으면 그 뒤 편집도 차단");
});

// ── 만드는 편집(표시 없이 손으로 만드는 길) ───────────────────────────────────

test("만드는 편집: 막지 않고 안내 한 줄 · git 은 안 부른다", () => {
  const dir = repo("repo-");
  const g = fakeGit();
  const r = run({
    tool_name: "Write", tool_input: { file_path: join(dir, "status.md"), content: "# 작업 상황판\n\n오늘 할 일\n" },
    cwd: dir, session_id: "s20",
  }, { path: g.path });
  assert.equal(r.code, 0, "차단이 아니다");
  assert.match(r.out, /chageun:statusboard/);
  assert.match(r.out, /무시 절차/);
  assert.equal(g.called(), false, "표시가 없어 내용 신호에서 끝난다");
});

test("만드는 편집: 이미 있는 남의 문서에는 잔소리하지 않는다", () => {
  const dir = repo("repo-");
  writeFileSync(join(dir, "status.md"), "# 팀 현황\n");
  const r = run({
    tool_name: "Write", tool_input: { file_path: join(dir, "status.md"), content: "# 팀 현황\n\n한 줄 더\n" },
    cwd: dir, session_id: "s21",
  });
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes("무시 절차"), "이미 있는 파일에는 안 낸다");
});

// ── 무인 모드 ─────────────────────────────────────────────────────────────────

function unattended(dir) {
  mkdirSync(join(dir, ".chageun"), { recursive: true });
  writeFileSync(join(dir, ".chageun", "token"), JSON.stringify({ nonce: "abc123" }));
  return { CHAGEUN_UNATTENDED: "1", CHAGEUN_UNATTENDED_TOKEN: "abc123", CHAGEUN_ROOT: dir };
}

test("무인 모드: 두 차단 모두 전용 문구를 그대로 낸다(일반 park 아님)", () => {
  const s = tmpDir("unatt-secret-");
  writeFileSync(join(s, ".env"), "API_TOKEN=" + SECRET + "\n");
  writeFileSync(join(s, "status.md"), BOARD_TEXT);
  const r1 = run(editBoard(s, "열쇠는 " + SECRET), { env: unattended(s), spawnCwd: s });
  assert.equal(r1.code, 2);
  assert.match(r1.err, /값은 여기 다시 적지 않습니다/);
  assert.ok(!r1.err.includes("park하고 사람 복귀를 기다립니다"), "회복 문구가 통째로 사라지면 안 된다");

  const g = repo("unatt-git-");
  writeFileSync(join(g, "status.md"), BOARD_TEXT);
  const r2 = run(editBoard(g, "오늘 한 일"), { env: unattended(g), spawnCwd: g });
  assert.equal(r2.code, 2);
  assert.match(r2.err, /추적을 끊은 뒤에 무시 절차를 한 번 더/);
  assert.ok(!r2.err.includes("park하고 사람 복귀를 기다립니다"));
});
