import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./support-tmpdir.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SKILL_DIR = join(SRC, "skills", "statusboard");
const { start, hostFor, isLoopback } = await import(join(SKILL_DIR, "board-server.mjs"));

const OLD_NAME = ["상황판", ".md"].join("");
const HONORIFIC = "사장님";

function board(root, name, text = "## 1. 지금 하실 것: 2건\n\n- 하나\n") {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "status.md"), text);
  return p;
}

// 포트 0으로 띄운다(8095는 사용자가 쓰는 자리라 검사가 안 건드린다).
// XDG_CACHE_HOME 도 임시 폴더로 준다 — 상태 파일 자리가 고정 한 곳이라, 안 바꾸면
// 사용자가 띄워 둔 서버의 주소를 덮어쓴다.
async function up(cwd, extra = {}) {
  const cache = tmpDir("cache-");
  const env = { XDG_CACHE_HOME: cache, HOME: "/nowhere-home", ...extra };
  const h = await start({ cwd, env, port: 0 });
  return { ...h, cache, env };
}

async function body(url) {
  const r = await fetch(url);
  return { r, text: await r.text() };
}

// 시각은 매 응답 달라진다. 이 검사가 보는 것은 **요청 문자열이 응답을 바꾸는가**이지
// 시각이 아니다. 🛑 `t` 를 고정값으로 바꿔 푸는 것은 금지 — 새로고침 버튼이 두 번째부터
// 안 듣는다. `ago()` 가 내는 네 형태를 **전부** 지운다(한 시간만 지나도 빗나간다).
const norm = (s) => s
  .replace(/t=\d+/g, "t=0")
  .replace(/방금|\d+분 전|\d+시간 전|\d+일 전/g, "<때>");

test("메서드: GET·HEAD 외에는 405", async () => {
  const root = tmpDir("root-"); board(root, "a");
  const h = await up(join(root, "a"));
  try {
    const r = await fetch(h.url, { method: "POST" });
    assert.equal(r.status, 405);
  } finally { h.close(); }
});

test("경로·질의를 바꿔도 응답이 같다(요청 문자열로 경로를 안 만든다)", async () => {
  const root = tmpDir("root-"); board(root, "a"); board(root, "b");
  const h = await up(join(root, "a"), { CHAGEUN_BOARD_ROOT: root });
  try {
    const one = norm((await body(h.url)).text);
    const two = norm((await body(h.url + "무엇이든")).text);
    const three = norm((await body(h.url + "?f=../../etc/passwd")).text);
    assert.equal(one, two);
    assert.equal(one, three);
  } finally { h.close(); }
});

test("안전장치 끝에서 끝까지: 홈이 부모면 형제 상황판이 응답에 안 나온다", async () => {
  const home = tmpDir("home-");
  const mine = board(home, "mine");
  board(home, "sibling");
  const h = await start({ cwd: mine, env: { XDG_CACHE_HOME: tmpDir("cache-"), HOME: home }, port: 0 });
  try {
    const { text } = await body(h.url);
    assert.ok(text.includes("mine"), "내 상황판이 안 보인다");
    assert.ok(!text.includes("sibling"), "형제 상황판이 딸려 왔다 — 서버가 opts 를 안 넘겼다");
  } finally { h.close(); }
});

test("기본 바인딩은 loopback · 무인이면 host 설정을 무시한다", () => {
  assert.equal(hostFor({}), "127.0.0.1");
  assert.equal(hostFor({ CHAGEUN_BOARD_HOST: "0.0.0.0" }), "0.0.0.0");
  assert.equal(hostFor({ CHAGEUN_BOARD_HOST: "0.0.0.0", CHAGEUN_UNATTENDED: "1" }), "127.0.0.1");
  // 명시 목록 판정 — 127.0.0.2 는 loopback 으로 안 본다(넓히면 경고 없이 밖에 열린다)
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("localhost"), true);
  for (const h of ["127.0.0.2", "0.0.0.0", ""]) assert.equal(isLoopback(h), false, h);
});

test("헤더 6종 + 마커 · CSP 에 script-src 'none' · 본문에 <script 없음", async () => {
  const root = tmpDir("root-"); board(root, "a");
  const h = await up(join(root, "a"));
  try {
    const { r, text } = await body(h.url);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.match(r.headers.get("x-robots-tag"), /noindex/);
    assert.match(r.headers.get("content-security-policy"), /script-src 'none'/);
    assert.equal(r.headers.get("x-chageun-board"), "1");
    assert.ok(!text.includes("<script"), "CSP 와 본문이 어긋난다");
  } finally { h.close(); }
});

test("공개 경고: loopback 이 아니면 본문에 띠가 뜬다", async () => {
  const root = tmpDir("root-"); board(root, "a");
  // 127.0.0.2 는 이 기계에서 바인딩되지만 명시 목록 밖이라 경고가 떠야 한다.
  const h = await up(join(root, "a"), { CHAGEUN_BOARD_HOST: "127.0.0.2" });
  try {
    const { text } = await body(`http://127.0.0.2:${h.port}/`);
    assert.ok(text.includes("이 컴퓨터 밖에서도 열립니다"), "경고 띠가 없다");
  } finally { h.close(); }
});

test("빈 목록도 200 이고 안내에 status.md 가 들어 있다", async () => {
  const empty = tmpDir("empty-");
  const h = await up(join(empty, "nothing"), { CHAGEUN_BOARD_ROOT: empty });
  try {
    const { r, text } = await body(h.url);
    assert.equal(r.status, 200);
    assert.ok(text.includes("아직 상황판이 없습니다"));
    assert.ok(text.includes("status.md"));
    assert.ok(!text.includes(OLD_NAME), "옛 이름이 따라왔다");
  } finally { h.close(); }
});

test("응답 본문에 사용자 호칭이 없다", async () => {
  const root = tmpDir("root-"); board(root, "a");
  const h = await up(join(root, "a"));
  try {
    const { text } = await body(h.url);
    assert.ok(!text.includes(HONORIFIC));
  } finally { h.close(); }
});

test("mtime 라벨: `파일 바뀜` 이고 `갱신`·`최신` 이 아니다 · 정렬은 mtime 내림차순", async () => {
  const root = tmpDir("root-");
  const older = board(root, "older");
  const newer = board(root, "newer");
  utimesSync(join(older, "status.md"), new Date(1e9), new Date(1e9));
  utimesSync(join(newer, "status.md"), new Date(2e9), new Date(2e9));
  const h = await up(join(root, "older"), { CHAGEUN_BOARD_ROOT: root });
  try {
    const { text } = await body(h.url);
    assert.ok(text.includes("파일 바뀜"), "라벨이 없다");
    assert.ok(!/(갱신|최신)/.test(text), "mtime 옆에 갱신·최신 이 다시 붙었다");
    assert.ok(text.indexOf("newer") < text.indexOf("older"), "mtime 내림차순이 아니다");
  } finally { h.close(); }
});

test("머리 표시가 화면에 안 보이고 그 안 두 줄은 보인다", async () => {
  const root = tmpDir("root-");
  board(root, "a", [
    "# a 작업 상황판", "", "> 자리 비우신 동안 무슨 일이 있었는지",
    "<!-- chageun:auto:head -->",
    "> 기계가 이 파일을 마지막으로 고친 때 **2026-08-11 20:44**",
    "> 사람이 쓰는 칸은 **적어도 2026-08-11 12:20 부터** 안 바뀌었습니다",
    "<!-- /chageun:auto:head -->", "", "## 1. 지금 하실 것: 0건",
  ].join("\n"));
  const h = await up(join(root, "a"));
  try {
    const { text } = await body(h.url);
    assert.ok(!text.includes("chageun:auto:head"), "표시가 글자로 샌다");
    assert.ok(!text.includes("&lt;!--"), "주석이 이스케이프돼 화면에 뜬다");
    assert.ok(text.includes("2026-08-11 20:44") && text.includes("2026-08-11 12:20"));
  } finally { h.close(); }
});

test("새로고침 링크는 판마다 하나이고 각각 자기 조각을 단다", async () => {
  const root = tmpDir("root-"); board(root, "a"); board(root, "b");
  const h = await up(join(root, "a"), { CHAGEUN_BOARD_ROOT: root });
  try {
    const { text } = await body(h.url);
    const links = text.match(/<a href="\/\?t=\d+#[^"]*">새로고침<\/a>/g) || [];
    assert.equal(links.length, 2, "판 수만큼이 아니다(머리띠 한 개면 첫 탭으로 튄다)");
    assert.ok(links.some((l) => l.includes("#a")) && links.some((l) => l.includes("#b")));
  } finally { h.close(); }
});

test("탭 조각 짝맞춤: 빈칸·특수문자가 든 이름도 href 와 id 가 같다", async () => {
  const root = tmpDir("root-");
  board(root, "my project"); board(root, "다른 판");
  const h = await up(join(root, "my project"), { CHAGEUN_BOARD_ROOT: root });
  try {
    const { text } = await body(h.url);
    const hrefs = [...text.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]);
    const ids = [...text.matchAll(/<section class="panel" id="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(hrefs.sort(), ids.sort());
    for (const s of ids) assert.ok(!/\s/.test(s), "조각에 빈칸이 있다: " + s);
    assert.ok(text.includes("my project"), "화면 글자가 원래 이름이 아니다");
    assert.ok(text.includes("다른 판"), "한글 이름이 조각으로 바뀌어 보인다");
  } finally { h.close(); }
});

test("실행 상태 파일: 쓰고, 내 pid 일 때만 지운다", async () => {
  const root = tmpDir("root-"); board(root, "a");
  const h = await up(join(root, "a"));
  const stateFile = join(h.cache, "chageun", "board.json");
  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.port, h.port);
  assert.equal(saved.pid, process.pid);
  // 남의 pid 로 바꿔 두면 지우지 않는다(사용자가 띄워 둔 서버 주소를 안 덮어쓴다)
  writeFileSync(stateFile, JSON.stringify({ ...saved, pid: saved.pid + 1 }));
  h.close();
  assert.ok(readFileSync(stateFile, "utf8").includes('"pid"'), "남의 상태 파일을 지웠다");
});

// 성공 기준 E — **포지티브 화이트리스트**. 목록 밖 파일 시스템 호출이 하나라도 있으면 빨간불.
// ⚠ 계획서는 `fs.` 접두사를 세라고 적었는데 두 파일은 ESM 이름 가져오기라 그 접두사가
//   아예 없다(그대로 재면 늘 초록인 헛검사다). 그래서 **`node:fs` 에서 가져온 이름 전부**를
//   본다. 소스 스캔이라 `fs["write"+"FileSync"]` 같은 우회는 못 잡는다(정직 고지).
test("쓰기 0건: 읽기 화이트리스트 밖 호출은 허용 상수 인자일 때만", () => {
  const READ_OK = new Set(["readFileSync", "readdirSync", "statSync", "lstatSync",
    "existsSync", "realpathSync", "openSync", "readSync", "closeSync"]);
  const WRITE_OK = { mkdirSync: "STATE_DIR", writeFileSync: "STATE_FILE", unlinkSync: "STATE_FILE", rmSync: "STATE_FILE" };
  for (const f of ["board-core.mjs", "board-server.mjs"]) {
    const src = readFileSync(join(SKILL_DIR, f), "utf8");
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"node:fs[^"]*"/g)]
      .flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const members = [...src.matchAll(/\bfs\.([A-Za-z]+)\s*\(/g)].map((m) => m[1]);
    for (const name of [...imports, ...members]) {
      if (READ_OK.has(name)) continue;
      const allowed = WRITE_OK[name];
      assert.ok(allowed, `${f}: 화이트리스트 밖 파일 시스템 호출 — ${name}`);
      // 그 이름의 **모든 호출**이 허용 상수를 첫 인자로 받아야 한다.
      for (const call of [...src.matchAll(new RegExp("\\b" + name + "\\s*\\(([^,)]*)", "g"))]) {
        assert.ok(call[1].includes(allowed), `${f}: ${name} 의 인자가 허용 상수(${allowed})가 아니다 — ${call[1]}`);
      }
    }
  }
});
