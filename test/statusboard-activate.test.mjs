// 세션 시작 주입: 상황판이 **있는** 프로젝트에만 한 조각이 붙는다.
// 🛑 모든 케이스가 `cwd` 를 임시 폴더로 명시한다 — 안 잡으면 검사가 저장소 루트에서
//    도는데 거기엔 실제 status.md 가 있어 "있는 폴더" 케이스가 우연히 초록이 된다.
// 🛑 실제 배선(src/hooks/hooks.claude.json)은 조각 번호 1~6 을 인자로 준다. 그래서 여기서도
//    **조각 6**(조건부 부록 조각)을 불러 잰다. 인자 없이 부르는 옛 경로로만 재면, 상황판 부록이
//    조각 6 에서 통째로 빠져도 이 검사는 초록이다 — 실제로 쓰이는 경로를 안 재는 검사가 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpDir } from "./support-tmpdir.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "src", "hooks", "activate.js");
const APPENDIX = join(ROOT, "src", "rules", "statusboard-appendix.md");
// 구분 표식·자리표시자는 **코어에서만** 읽는다. 여기서 문자열을 다시 적으면 코어가 바뀌었을 때
// 검사만 옛 문자열을 보며 초록으로 남는다.
const core = require("../src/hooks/activate-core.js");

const BASE = { ...process.env };
delete BASE.CHAGEUN_UNATTENDED;
delete BASE.CLAUDE_PLUGIN_ROOT;

const PIECE = String(core.APPENDIX_PIECE);

function run(cwd, env = {}, arg = PIECE) {
  const args = arg === null ? [HOOK] : [HOOK, arg];
  return spawnSync(process.execPath, args, { cwd, env: { ...BASE, ...env }, encoding: "utf8" });
}

const HEAD_OPEN = "<!-- chageun:auto:head -->", HEAD_CLOSE = "<!-- /chageun:auto:head -->";
const AUTO_OPEN = "<!-- chageun:auto -->", AUTO_CLOSE = "<!-- /chageun:auto -->";
const NO_MARKERS_LINE = "기계 칸 표시가 없습니다";
const SPLIT = core.APPENDIX_SPLIT;
const INTACT = [HEAD_OPEN, HEAD_CLOSE, AUTO_OPEN, AUTO_CLOSE].join("\n");

function boardDir(text) {
  const d = tmpDir("proj-");
  writeFileSync(join(d, "status.md"), text);
  return d;
}

test("상황판이 없는 폴더: 부록 조각이 아무것도 안 낸다(상시 비용 0)", () => {
  const r = run(tmpDir("empty-"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "상황판도 무인도 아닌데 부록 조각이 뭔가를 냈다");
});

test("상황판이 있어도 본문 조각 1~5 는 글자 하나 안 달라진다", () => {
  // 🛑 "상시 비용 0" 의 진짜 뜻. 부록을 엉뚱한 조각에 붙이면 그 조각만 길어지는데,
  //    그건 상황판 프로젝트에서**만** 잘리는 가장 늦게 발견되는 방향의 사고다.
  const empty = tmpDir("empty2-"), board = boardDir(INTACT);
  for (const n of core.PIECES.map((p) => String(p.n)))
    assert.equal(run(board, {}, n).stdout, run(empty, {}, n).stdout,
      `조각 ${n} 이 상황판 유무에 따라 달라진다 — 부록이 본문 조각에 새어 들어갔다`);
});

test("상황판이 있는 폴더: 부록 본문 + board-server.mjs 절대 경로", () => {
  const r = run(boardDir(INTACT));
  assert.equal(r.status, 0);
  assert.ok(r.stdout.startsWith("차근 워크플로우 활성"), "표식이 첫 줄 맨 앞에 없다");
  assert.ok(r.stdout.includes("상황판 `status.md`"), "부록 본문이 안 붙었다");
  const abs = join(ROOT, "src", "skills", "statusboard", "board-server.mjs");
  assert.ok(r.stdout.includes(abs), "board-server.mjs 절대 경로가 안 박혔다");
  assert.ok(!r.stdout.includes(core.BOARD_SERVER_SLOT), "자리표시자가 그대로 남았다");
});

test("작업방(worktree)처럼 몇 단 아래에서 켜도 저장소 뿌리의 상황판을 찾는다", () => {
  // 이 저장소 자체가 켠 폴더를 `<repo>/.claude/worktrees/<이름>` 로 3단 깊이 중첩한다.
  // status.md 는 켠 폴더가 아니라 그 위 저장소 뿌리에 있으므로, 켠 폴더 한 곳만 보면
  // 있는데도 "없다"고 오판한다.
  const repo = boardDir(INTACT);
  const nested = join(repo, ".claude", "worktrees", "agent-abc123");
  mkdirSync(nested, { recursive: true });
  const r = run(nested);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("상황판 `status.md`"),
    "몇 단 위 저장소 뿌리의 status.md 를 못 찾아 부록이 안 붙었다");
});

test("무인 + 상황판: 한 조각에 둘 다 붙고 무인이 먼저다", () => {
  const r = run(boardDir(INTACT), { CHAGEUN_UNATTENDED: "1" });
  const iu = r.stdout.indexOf("무인 모드 켜는 법");
  const ib = r.stdout.indexOf("상황판 `status.md`");
  assert.ok(iu !== -1 && ib !== -1, "둘 중 하나가 안 붙었다");
  assert.ok(iu < ib, "무인 부록이 뒤에 왔다");
});

test("무시 확인 줄이 부록에 있다", () => {
  assert.ok(readFileSync(APPENDIX, "utf8").includes("git check-ignore"),
    "성공 기준 K 의 촉발점이 통째로 빠졌다");
});

test("(f) 표시가 두 벌 다 온전하면 안 붙고 구분 표시도 안 샌다", () => {
  const r = run(boardDir([HEAD_OPEN, HEAD_CLOSE, "", AUTO_OPEN, AUTO_CLOSE].join("\n")));
  assert.ok(!r.stdout.includes(NO_MARKERS_LINE), "표시가 온전한데 안내가 붙었다");
  assert.ok(!r.stdout.includes(SPLIT), "구분 표시가 출력에 샌다");
});

test("(f) 표시가 하나도 없으면 붙는다", () => {
  const r = run(boardDir("# 손으로 만든 상황판\n\n## 1. 지금 하실 것: 0건\n"));
  assert.ok(r.stdout.includes(NO_MARKERS_LINE), "표시 없는 기존 상황판에 아무 말도 안 나갔다");
  assert.ok(!r.stdout.includes(SPLIT), "구분 표시가 출력에 샌다");
});

test("(f) 한 벌만 있어도 붙는다(머리만 있고 §2 표시가 없는 모양)", () => {
  const r = run(boardDir([HEAD_OPEN, HEAD_CLOSE, "", "## 2. 지금 뒤에서 도는 것: 0건"].join("\n")));
  assert.ok(r.stdout.includes(NO_MARKERS_LINE), "짝 판정을 두 벌 각각으로 안 했다");
  // 반대 방향도 같다
  const r2 = run(boardDir([AUTO_OPEN, AUTO_CLOSE].join("\n")));
  assert.ok(r2.stdout.includes(NO_MARKERS_LINE), "머리 표시 없음을 안 봤다");
});

test("(f) 표시가 깨져 있어도 붙는다(순서 뒤바뀜·짝이 둘)", () => {
  const flipped = run(boardDir([HEAD_CLOSE, HEAD_OPEN, AUTO_OPEN, AUTO_CLOSE].join("\n")));
  assert.ok(flipped.stdout.includes(NO_MARKERS_LINE), "순서가 뒤바뀐 표시를 온전하다고 봤다");
  const twice = run(boardDir([HEAD_OPEN, HEAD_CLOSE, AUTO_OPEN, AUTO_CLOSE, AUTO_OPEN, AUTO_CLOSE].join("\n")));
  assert.ok(twice.stdout.includes(NO_MARKERS_LINE), "짝이 둘인 파일을 온전하다고 봤다");
});

// 옛 배선(인자 없음)으로 불려도 상황판 부록은 따라온다. 설치본 배선이 옛것인 기계에서
// 규칙은 잘리더라도 **상황판 지침이 통째로 사라지지는 않게** 한다.
test("인자 없는 옛 경로에서도 상황판 부록이 따라온다", () => {
  const r = run(boardDir(INTACT), {}, null);
  assert.ok(r.stdout.includes("상황판 `status.md`"), "옛 경로에서 상황판 부록이 빠졌다");
});

// 🛑 크기 핀은 **(f)를 포함한 최악 판**으로 잰다. 조건부라 평소엔 더 짧은데,
//    짧은 쪽으로 재면 헛핀이다. 주입 핀은 합성 경로 200바이트로 잰다 —
//    검사기가 도는 기계마다 설치 경로 길이가 달라 실제 값으로 재면 같은 코드가
//    어디선 통과하고 어디선 실패한다.
//    다듬기는 **코어 함수**(core.renderStatusboard)를 부른다. 여기서 replace 를 다시 짜면
//    훅이 실제로 내는 글이 아니라 내가 뽑은 중간 결과를 재게 된다.
const normBytes = (s) => Buffer.byteLength(s.replace(/\r\n/g, "\n"), "utf8");

test("크기 핀: 템플릿 800B 이하 · 주입 후 1,000B 이하", () => {
  const t = readFileSync(APPENDIX, "utf8");
  assert.ok(t.includes(NO_MARKERS_LINE), "최악 판을 재려면 (f)가 파일에 있어야 한다");
  const tpl = normBytes(t);
  const injected = normBytes(core.renderStatusboard(t, "표식깨짐", { boardServer: "x".repeat(200) }));
  assert.ok(tpl <= 800, `템플릿 ${tpl}B > 800B — 핀을 올리지 말고 문장을 줄인다`);
  assert.ok(injected <= 1000, `주입 ${injected}B > 1,000B — 핀을 올리지 말고 문장을 줄인다`);
});

// 🛑 설치가 깨졌을 때 침묵하지 않는다 — 무인 부록과 **같은 갈래**다(test/activate.test.mjs).
//    조각 6 은 부록이 전부라, 상황판 프로젝트에서 부록 파일만 없어지면 그 조각이 통째로
//    빈 값이 되고 나머지 5조각이 정상 도착해 세션이 완전히 정상으로 보인다.
test("설치가 깨져도(statusboard-appendix.md 없음) 상황판 조각 6이 침묵하지 않는다", () => {
  const { mkdirSync, copyFileSync } = require("node:fs");
  const root = tmpDir("sb-broken-");
  mkdirSync(join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, "rules"), { recursive: true });
  for (const [dir, f] of [["hooks", "activate.js"], ["hooks", "activate-core.js"],
                          ["rules", "operating-rules.md"]])
    copyFileSync(join(ROOT, "src", dir, f), join(root, dir, f));
  const hook = join(root, "hooks", "activate.js");
  const r = spawnSync(process.execPath, [hook, PIECE],
    { cwd: boardDir(INTACT), env: BASE, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("statusboard-appendix.md"),
    `어느 부록이 없는지 이름이 없다: ${JSON.stringify(r.stdout)}`);
  assert.ok(r.stdout.includes("설치를 확인하세요"), "설치를 의심하라는 안내가 없다");
});
