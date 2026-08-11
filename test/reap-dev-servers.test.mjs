import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  isDevServer, isDevLauncher, isDeleted, selectReapable, MAX_KILL,
  isClaudeSession, parseSsNet, parseStat, ageMsFromStat, selectReapableDetailed, MIN_PROCESS_AGE_MS,
  pathCovers,
} = require("../src/hooks/reap-dev-servers-core.js");

const UID = 1000;
const del = (p) => p + " (deleted)";

// ── 놀고 있는(주인 없는) 개발 서버 정리용 공통 픽스처 ────────────────────────────
const HOUR = 60 * 60 * 1000;
// 기본형: 살아있는 폴더 · 3시간째 · 부모는 init(1) = 띄운 세션 소멸 · 5173 을 듣고 있음
const vite = (over) => Object.assign({
  pid: 700, ppid: 1, uid: UID, comm: "node",
  cmdline: "node /app/web/node_modules/.bin/vite",
  cwd: "/app/web", ageMs: 3 * HOUR,
}, over || {});
const net = (over) => Object.assign({ listen: [{ pid: 700, port: 5173 }], estab: [] }, over || {});
const pick = (procs, opts) => selectReapable(procs, UID, Object.assign({ selfPid: 9 }, opts));

test("isDevServer: recognizes next-server by comm and cmdline", () => {
  assert.equal(isDevServer("next-server", ""), true);
  assert.equal(isDevServer("node", "next-server (v16.2.4)"), true);
});

test("isDevServer: recognizes common node dev servers (token + subcommand)", () => {
  assert.equal(isDevServer("node", "node /app/node_modules/.bin/next dev"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/vite/bin/vite.js"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/webpack-dev-server/bin/webpack-dev-server.js"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/react-scripts/scripts/start.js"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/nuxt/bin/nuxt.mjs dev"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/.bin/astro dev"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/.bin/ng serve"), true);
});

test("isDevServer: does NOT match one-off builds or unrelated node", () => {
  assert.equal(isDevServer("node", "node /app/node_modules/vite/bin/vite.js build"), false);
  assert.equal(isDevServer("node", "vite preview"), false);
  assert.equal(isDevServer("node", "node server.js"), false);
  assert.equal(isDevServer("claude", "claude"), false);
  assert.equal(isDevServer("node", ""), false);
});

// Fable5 audit: substring matching wrongly flagged these. Token+comm gate must reject them.
test("isDevServer: rejects Fable5 false-positives (substring surface closed)", () => {
  assert.equal(isDevServer("python3", "python3 /home/u/dev/next-gen-model/train.py"), false); // ML 학습
  assert.equal(isDevServer("tail", "tail -f /home/u/dev/next-app.log"), false);               // 로그 tail
  assert.equal(isDevServer("vim", "vim node_modules/next/dist/server/next-server.js"), false); // 편집 중 vim
  assert.equal(isDevServer("node", "node /home/u/dev/nextcloud-backup/sync.js"), false);       // 백업 데몬
  assert.equal(isDevServer("node", "node poll.js --url https://api.foo.ng --mode serve"), false); // .ng 도메인
  assert.equal(isDevServer("bash", "bash /home/u/dev/scripts/nightly.sh --next-run daily"), false); // 야간 배치
  assert.equal(isDevServer("node", "node /home/u/dev/app/build.js"), false);                   // /dev/ 경로 + node
});

test("isDevLauncher: only npm/yarn/pnpm run dev or nodemon", () => {
  assert.equal(isDevLauncher("npm run dev"), true);
  assert.equal(isDevLauncher("node /app/.bin/nodemon server.js"), true);
  assert.equal(isDevLauncher("node /srv/scheduler.js"), false);   // 범용 node 데몬
  assert.equal(isDevLauncher("npm run build"), false);
  assert.equal(isDevLauncher("yarn test"), false);
});

test("isDeleted: only true for the ' (deleted)' suffix", () => {
  assert.equal(isDeleted("/home/u/app/web (deleted)"), true);
  assert.equal(isDeleted("/home/u/app/web"), false);
  assert.equal(isDeleted("/home/u/deleted-things/web"), false); // 'deleted' in name, not suffix
  assert.equal(isDeleted(null), false);
});

test("selectReapable: reaps a dev server ONLY when its cwd is deleted", () => {
  const live = { pid: 100, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: "/app/web" };
  const stale = { pid: 200, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([live, stale], UID, { selfPid: 9 }), [200]);
});

test("selectReapable: reaps the deleted-cwd launcher parent (npm run dev)", () => {
  const parent = { pid: 300, ppid: 1, uid: UID, comm: "node", cmdline: "npm run dev", cwd: del("/app/web") };
  const child = { pid: 301, ppid: 300, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([parent, child], UID, { selfPid: 9 }), [300, 301]);
});

test("selectReapable: does NOT reap a generic node daemon parent (Fable5 finding 2)", () => {
  const parent = { pid: 300, ppid: 1, uid: UID, comm: "node", cmdline: "node /srv/scheduler.js", cwd: del("/tmp/x") };
  const child = { pid: 301, ppid: 300, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([parent, child], UID, { selfPid: 9 }), [301]); // only the child
});

test("selectReapable: does NOT reap a live parent even if child is stale", () => {
  const parent = { pid: 300, ppid: 1, uid: UID, comm: "node", cmdline: "npm run dev", cwd: "/app/web" };
  const child = { pid: 301, ppid: 300, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([parent, child], UID, { selfPid: 9 }), [301]);
});

test("selectReapable: never reaps self, pid<=1, or other users", () => {
  const self = { pid: 9, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app") };
  const init = { pid: 1, ppid: 0, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app") };
  const other = { pid: 500, ppid: 1, uid: 0, comm: "next-server", cmdline: "next-server", cwd: del("/app") };
  assert.deepEqual(selectReapable([self, init, other], UID, { selfPid: 9 }), []);
});

test("selectReapable: caps output at MAX_KILL", () => {
  const many = [];
  for (let i = 0; i < MAX_KILL + 20; i++) {
    many.push({ pid: 1000 + i, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/" + i) });
  }
  assert.equal(selectReapable(many, UID, { selfPid: 9 }).length, MAX_KILL);
});

test("selectReapable: tolerates junk input", () => {
  assert.deepEqual(selectReapable(null, UID, {}), []);
  assert.deepEqual(selectReapable([null, undefined, {}, { pid: "x" }], UID, {}), []);
});

// ══ 놀고 있는(주인 없는) 개발 서버 ═══════════════════════════════════════════════
// 2026-08-10 실측이 계기: vite 하나가 6시간 39분 · 접속 0 · 주인 세션 소멸 상태로 299MB 를
// 붙들고 있었는데 폴더가 멀쩡해서 기존 규칙("폴더 삭제")으로는 안 꺼졌다.
// 세 조건 AND(접속 0 · 주인 세션 소멸 · 2시간+) — 아래 테스트는 전부 **안 끄는 쪽**을 지킨다.

test("놀고 있는 개발 서버: 접속 0 · 주인 세션 소멸 · 2시간+ 이면 끈다", () => {
  assert.deepEqual(pick([vite()], { net: net() }), [700]);
});

test("놀고 있는 개발 서버: 접속이 있으면 안 끈다 (그 pid 가 established 를 쥐고 있음)", () => {
  // 브라우저 탭이 열려 있으면 vite·next 는 HMR 연결을 유지한다 = 사람이 보고 있다.
  assert.deepEqual(pick([vite()], { net: net({ estab: [{ pid: 700, port: 5173 }] }) }), []);
});

test("놀고 있는 개발 서버: pid 를 못 붙인 established 라도 듣는 포트면 안 끈다", () => {
  // ss 가 권한 때문에 users:(...) 를 못 붙이는 경우 — 포트만으로도 접속으로 본다.
  assert.deepEqual(pick([vite()], { net: net({ estab: [{ pid: null, port: 5173 }] }) }), []);
});

test("놀고 있는 개발 서버: 상관없는 포트의 접속은 보호가 되지 않는다", () => {
  assert.deepEqual(pick([vite()], { net: net({ estab: [{ pid: 999, port: 443 }] }) }), [700]);
});

test("놀고 있는 개발 서버: 주인 claude 세션이 살아있으면 안 끈다", () => {
  const claude = { pid: 500, ppid: 400, uid: UID, comm: "claude", cmdline: "claude", cwd: "/app" };
  const sh = { pid: 600, ppid: 500, uid: UID, comm: "sh", cmdline: "sh -c vite", cwd: "/app/web" };
  const p = vite({ ppid: 600 });
  assert.deepEqual(pick([claude, sh, p], { net: net() }), []); // 손자여도 거슬러 올라가 찾는다
});

test("놀고 있는 개발 서버: 부모를 목록에서 못 찾으면 '주인 살아있음'으로 본다", () => {
  assert.deepEqual(pick([vite({ ppid: 4242 })], { net: net() }), []);
});

// ── 주인 판정 두 번째 통로: 폴더 대조 ────────────────────────────────────────────
// 2026-08-10 실측(오너 확인): 이 기계의 개발 서버 3개가 **전부** 부모 체인상 고아였다.
// Claude Code 가 백그라운드로 띄우면 띄운 셸이 먼저 빠져 부모가 init 이 되기 때문이다.
// 즉 부모 체인만으로는 "주인 없음"이 사실상 상수라 3중 안전장치가 2중으로 줄어든다.
// 그래서 살아있는 claude 세션의 **작업 폴더**로도 주인을 찾는다(OR).
const claudeAt = (cwd, over) => Object.assign({ pid: 500, ppid: 1, uid: UID, comm: "claude", cmdline: "claude", cwd }, over || {});

test("주인 폴더: 세션 작업 폴더가 서버 폴더와 같으면 안 끈다", () => {
  assert.deepEqual(pick([claudeAt("/app/web"), vite()], { net: net() }), []);
});

test("주인 폴더: 세션이 서버 폴더의 조상 폴더에 있어도 안 끈다", () => {
  // 실측 근거: 서버 cwd 는 <프로젝트>/web 인데 세션은 <프로젝트> 에 있었다.
  assert.deepEqual(pick([claudeAt("/app"), vite()], { net: net() }), []);
  assert.deepEqual(pick([claudeAt("/"), vite()], { net: net() }), []);
});

test("주인 폴더: 이름만 겹치는 이웃 폴더는 남이다(문자열 접두어 비교 금지)", () => {
  // '/app/web' 세션이 '/app/website' 서버의 주인이 되면 안 된다.
  assert.deepEqual(pick([claudeAt("/app/web"), vite({ cwd: "/app/website" })], { net: net() }), [700]);
  // 반대 방향(서버가 더 위)도 남이다.
  assert.deepEqual(pick([claudeAt("/app/web/inner"), vite()], { net: net() }), [700]);
});

test("주인 폴더: 남의 폴더에서 도는 세션뿐이면 그대로 끈다", () => {
  assert.deepEqual(pick([claudeAt("/other/proj"), vite()], { net: net() }), [700]);
});

test("주인 폴더: claude 세션의 작업 폴더를 못 읽으면 아무것도 안 끈다", () => {
  assert.deepEqual(pick([claudeAt(""), vite()], { net: net() }), []);
  assert.deepEqual(pick([claudeAt(null), vite()], { net: net() }), []);
});

test("주인 폴더: 서버 자신의 작업 폴더를 못 읽으면 안 끈다", () => {
  assert.deepEqual(pick([claudeAt("/other"), vite({ cwd: "" })], { net: net() }), []);
});

test("주인 폴더: 다른 유저의 claude 세션은 대조에 넣지 않는다", () => {
  // 남의 세션은 내 프로세스의 주인이 될 수 없다(애초에 남의 프로세스는 안 끈다).
  const stranger = claudeAt("/app/web", { pid: 501, uid: 0 });
  assert.deepEqual(pick([stranger, vite()], { net: net() }), [700]);
  // 남의 세션 폴더를 못 읽는 것도 내 판정을 막지 않는다.
  assert.deepEqual(pick([claudeAt(null, { pid: 502, uid: 0 }), vite()], { net: net() }), [700]);
});

test("주인 폴더: 작업방(worktree)은 여전히 주인 없음 — 접속·나이가 받친다", () => {
  // 작업방은 원본의 하위 폴더가 아니라 형제 폴더라 이 대조로는 안 잡힌다(의도).
  assert.deepEqual(pick([claudeAt("/app/web"), vite({ cwd: "/app/web-wt" })], { net: net() }), [700]);
});

test("pathCovers: 세그먼트 경계까지 확인한다", () => {
  assert.equal(pathCovers("/a/b", "/a/b"), true);
  assert.equal(pathCovers("/a/b", "/a/b/c"), true);
  assert.equal(pathCovers("/a/b/", "/a/b/c"), true);   // 끝 슬래시 정규화
  assert.equal(pathCovers("/a/b", "/a/bc"), false);    // 경계 미확인 시 뚫리는 자리
  assert.equal(pathCovers("/a/b/c", "/a/b"), false);   // 방향이 반대
  assert.equal(pathCovers("/", "/a/b"), true);
  assert.equal(pathCovers("", "/a/b"), false);
  assert.equal(pathCovers("/a/b", ""), false);
  assert.equal(pathCovers(null, null), false);
});

test("놀고 있는 개발 서버: 2시간이 안 됐으면 안 끈다", () => {
  assert.deepEqual(pick([vite({ ageMs: MIN_PROCESS_AGE_MS - 1 })], { net: net() }), []);
  assert.deepEqual(pick([vite({ ageMs: MIN_PROCESS_AGE_MS })], { net: net() }), [700]);
});

test("놀고 있는 개발 서버: 나이를 모르면(ageMs 없음) 안 끈다", () => {
  assert.deepEqual(pick([vite({ ageMs: null })], { net: net() }), []);
  assert.deepEqual(pick([vite({ ageMs: undefined })], { net: net() }), []);
});

test("놀고 있는 개발 서버: 개발 서버가 아니면 안 끈다", () => {
  const daemon = vite({ cmdline: "node /srv/scheduler.js" });      // 범용 node 데몬
  const build = vite({ cmdline: "node /app/web/node_modules/.bin/vite build" }); // 일회성 빌드
  assert.deepEqual(pick([daemon, build], { net: net({ listen: [{ pid: 700, port: 5173 }] }) }), []);
});

test("놀고 있는 개발 서버: 연결 조회가 실패하면(net 없음) 아무것도 안 끈다", () => {
  assert.deepEqual(pick([vite()], { net: null }), []);
  assert.deepEqual(pick([vite()], {}), []);
});

test("놀고 있는 개발 서버: 듣는 포트를 못 찾으면 안 끈다", () => {
  assert.deepEqual(pick([vite()], { net: net({ listen: [] }) }), []);
});

test("놀고 있는 개발 서버: 다른 유저·자기 자신·pid<=1 은 그대로 제외", () => {
  const other = vite({ pid: 701, uid: 0 });
  const self = vite({ pid: 9 });
  const init = vite({ pid: 1, ppid: 0 });
  const n = net({ listen: [{ pid: 701, port: 1 }, { pid: 9, port: 2 }, { pid: 1, port: 3 }] });
  assert.deepEqual(pick([other, self, init], { net: n }), []);
});

test("놀고 있는 개발 서버: 부모 체인이 순환해도 멈추고 안 끈다", () => {
  const a = vite({ pid: 700, ppid: 701 });
  const b = vite({ pid: 701, ppid: 700 });
  assert.deepEqual(pick([a, b], { net: net({ listen: [{ pid: 700, port: 5173 }, { pid: 701, port: 5174 }] }) }), []);
});

test("폴더 삭제는 그대로 OR — 접속·주인·나이를 안 봐도 끈다", () => {
  const p = vite({ cwd: del("/app/web"), ageMs: 60 * 1000, ppid: 500 });
  const claude = { pid: 500, ppid: 1, uid: UID, comm: "claude", cmdline: "claude", cwd: "/app" };
  assert.deepEqual(pick([claude, p], { net: net({ estab: [{ pid: 700, port: 5173 }] }) }), [700]);
});

test("selectReapableDetailed: 왜 껐는지(reason)를 함께 돌려준다", () => {
  const stale = { pid: 800, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  const idle = vite();
  assert.deepEqual(selectReapableDetailed([stale, idle], UID, { selfPid: 9, net: net() }), [
    { pid: 700, reason: "idle" },
    { pid: 800, reason: "deleted" },
  ]);
});

test("selectReapableDetailed: 두 조건에 다 걸리면 폴더 삭제로 표기", () => {
  const both = vite({ cwd: del("/app/web") });
  assert.deepEqual(selectReapableDetailed([both], UID, { selfPid: 9, net: net() }), [{ pid: 700, reason: "deleted" }]);
});

test("놀고 있는 개발 서버도 MAX_KILL 상한을 넘지 않는다", () => {
  const many = [], listen = [];
  for (let i = 0; i < MAX_KILL + 20; i++) {
    many.push(vite({ pid: 1000 + i }));
    listen.push({ pid: 1000 + i, port: 5000 + i });
  }
  assert.equal(pick(many, { net: net({ listen }) }).length, MAX_KILL);
});

test("isClaudeSession: claude 세션은 넓게 인정한다(넓게 볼수록 덜 끈다)", () => {
  assert.equal(isClaudeSession("claude", ""), true);
  assert.equal(isClaudeSession("node", "/usr/local/bin/claude --continue"), true);
  assert.equal(isClaudeSession("node", "node /opt/n/lib/node_modules/@anthropic-ai/claude-code/cli.js"), true);
  assert.equal(isClaudeSession("bash", "bash -c npm run dev"), false);
  assert.equal(isClaudeSession("node", "node /app/claude-helper.js"), false); // 이름만 비슷
  assert.equal(isClaudeSession("", ""), false);
});

// ── /proc·ss 파서 (실제 출력 형식으로 고정) ──────────────────────────────────────
test("parseStat: 마지막 ')' 뒤부터 세어 ppid·시작시각을 뽑는다", () => {
  // 실제 /proc/<pid>/stat 형식. comm 은 괄호 안이고 공백·괄호를 품을 수 있다.
  const line = "2000680 (cat) R 2000648 2000680 2000648 0 -1 4194304 468 0 0 0 0 0 0 0 20 0 1 0 11433767 16629760 1824";
  assert.deepEqual(parseStat(line), { ppid: 2000648, startTicks: 11433767 });
  const paren = "1963965 (node (vitest 1)) S 1963841 1963796 5017 0 -1 4194304 9 0 0 0 3 1 0 0 20 0 11 0 11419312 999";
  assert.deepEqual(parseStat(paren), { ppid: 1963841, startTicks: 11419312 });
  assert.deepEqual(parseStat("깨진 줄"), { ppid: 0, startTicks: null });
});

test("ageMsFromStat: uptime 과 시작 tick 으로 나이를 재고, 못 재면 null", () => {
  const line = "1 (x) S 0 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 360000 0 0"; // 3600초에 시작
  assert.equal(ageMsFromStat(line, 114337.67), Math.round((114337.67 - 3600) * 1000));
  assert.equal(ageMsFromStat(line, 100), null);      // 부팅보다 나중 = 못 믿음 → null
  assert.equal(ageMsFromStat(line, NaN), null);
  assert.equal(ageMsFromStat("깨진 줄", 1000), null);
});

test("parseSsNet: 실제 ss -H -tanp 출력에서 LISTEN·ESTAB 과 pid 를 뽑는다", () => {
  const out = [
    "LISTEN     0      511                     *:5182                   *:*     users:((\"node\",pid=1862213,fd=30))",
    "LISTEN     0      4096        127.0.0.53%lo:53               0.0.0.0:*",
    "ESTAB      0      0                   [::1]:5182               [::1]:57806 users:((\"node\",pid=1862213,fd=32))",
    "ESTAB      0      0           10.0.0.2:57000      160.79.104.10:443   users:((\"claude\",pid=305204,fd=21))",
    "TIME-WAIT  0      0                127.0.0.1:5182          127.0.0.1:57810",
    "",
  ].join("\n");
  const parsed = parseSsNet(out);
  assert.deepEqual(parsed.listen, [{ pid: 1862213, port: 5182 }, { pid: null, port: 53 }]);
  assert.deepEqual(parsed.estab, [{ pid: 1862213, port: 5182 }, { pid: 305204, port: 57000 }]);
  assert.equal(parseSsNet(""), null);          // 빈 출력 = 못 믿음 → null(안 끄는 쪽)
  assert.equal(parseSsNet(null), null);
});

test("parseSsNet: 한 소켓을 여러 프로세스가 쥐면 전부 센다", () => {
  const line = "LISTEN 0 511 *:3000 *:* users:((\"node\",pid=11,fd=30),(\"node\",pid=12,fd=30))";
  assert.deepEqual(parseSsNet(line).listen, [{ pid: 11, port: 3000 }, { pid: 12, port: 3000 }]);
});

// ── 통합: 훅 파일을 통째로 돌린다 (선택 → 죽이기 배선) ────────────────────────
//
// 위 검사들은 전부 판정 함수(core)만 부른다. 그런데 **위험은 core 에 없다** — 두 번째
// 접속 확인 · pid 재사용 가드 · `process.kill` 은 지금까지 한 줄도 안 시험됐다.
// 이 저장소는 "검사는 초록인데 검사와 멈춤 사이 배선이 틀린" 사고를 이미 겪었다.
// 선례: test/pretooluse.test.mjs 가 훅 파일을 spawnSync 로 통째로 돌린다.
//
// 🛑 이 검사는 **진짜 프로세스를 죽인다.** 그래서 희생자를 우리가 직접 만든다 —
// 임시 폴더에 가짜 vite 를 놓고, 그걸 detached 로 띄워 부모를 init 으로 만든다
// (그래야 "주인 없음"이 된다). 남의 프로세스는 건드리지 않는다.
import { spawnSync } from "node:child_process";
import nfs from "node:fs";
import nos from "node:os";
import npath from "node:path";
import nnet from "node:net";

const HOOK = npath.join(process.cwd(), "src", "hooks", "reap-dev-servers.js");
const linux = process.platform === "linux";

function runHook(env) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: "utf8", timeout: 20000,
    env: { ...process.env, ...env },
  });
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitGone = (pid, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!alive(pid)) return true; spawnSync("sleep", ["0.1"]); }
  return !alive(pid);
};

/** 가짜 개발 서버 하나. 포트를 하나 열고 가만히 있는다. 부모는 init 이 된다. */
function startVictim() {
  const dir = nfs.mkdtempSync(npath.join(nos.tmpdir(), "chageun-reap-"));
  const fake = npath.join(dir, "node_modules", "vite", "bin");
  nfs.mkdirSync(fake, { recursive: true });
  const script = npath.join(fake, "vite.js");
  nfs.writeFileSync(script, "require('net').createServer().listen(0,'127.0.0.1',function(){" +
    "require('fs').writeFileSync(process.argv[2], String(this.address().port));});" +
    "setInterval(function(){}, 1e9);\n");
  const portFile = npath.join(dir, "port");
  const pidFile = npath.join(dir, "pid");
  // 🛑 두 번 갈라 낳는다(double fork). `detached: true` 만으로는 **부모가 안 바뀐다** —
  // 낳은 쪽이 살아 있는 동안 ppid 는 그대로라, 부모 사슬을 타면 검사 프로세스 → 그 위의
  // claude 세션이 나와 "주인 있음"이 된다. 중간 프로세스를 곧바로 죽여야 init 이 받는다.
  spawnSync(process.execPath, ["-e",
    "const cp=require('child_process');const fs=require('fs');" +
    "const c=cp.spawn(process.argv[1],[process.argv[2],process.argv[3]]," +
    "{cwd:process.argv[4],detached:true,stdio:'ignore'});c.unref();" +
    "fs.writeFileSync(process.argv[5],String(c.pid));",
    process.execPath, script, portFile, dir, pidFile,
  ], { stdio: "ignore" });
  const end = Date.now() + 5000;
  while (Date.now() < end && !nfs.existsSync(portFile)) spawnSync("sleep", ["0.05"]);
  const port = Number(nfs.readFileSync(portFile, "utf8"));
  const pid = Number(nfs.readFileSync(pidFile, "utf8"));
  return { pid, port, dir };
}
function cleanup(v) {
  try { process.kill(v.pid, "SIGKILL"); } catch {}
  try { nfs.rmSync(v.dir, { recursive: true, force: true }); } catch {}
}

test("훅 통합: 끄는 스위치가 켜지면 아무것도 안 죽인다", { skip: !linux }, () => {
  const v = startVictim();
  try {
    const r = runHook({ CHAGEUN_SKIP_REAP: "1", CHAGEUN_REAP_MIN_AGE_MS: "0" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "", "스위치가 켜졌는데 뭔가 출력했다");
    assert.ok(alive(v.pid), "스위치가 켜졌는데 죽였다");
  } finally { cleanup(v); }
});

test("훅 통합: 접속이 붙어 있으면 안 죽인다", { skip: !linux }, async () => {
  const v = startVictim();
  const conn = nnet.connect(v.port, "127.0.0.1");
  try {
    await new Promise((ok, no) => { conn.once("connect", ok); conn.once("error", no); });
    const r = runHook({ CHAGEUN_REAP_MIN_AGE_MS: "0" });
    assert.equal(r.status, 0);
    assert.ok(alive(v.pid), "붙어 있는 접속이 있는데 죽였다");
  } finally { conn.destroy(); cleanup(v); }
});

// 이 한 건이 "실제로 죽는다"를 보는 유일한 검사다. 환경 때문에 판정이 안 서면
// **조용히 통과시키지 않고** 무엇 때문에 못 봤는지 말하고 실패시킨다.
test("훅 통합: 주인 없고 접속 없고 문턱을 넘으면 실제로 죽는다", { skip: !linux }, () => {
  const v = startVictim();
  let killedIt = false;
  try {
    const r = runHook({ CHAGEUN_REAP_MIN_AGE_MS: "0" });
    assert.equal(r.status, 0);
    killedIt = waitGone(v.pid, 5000);
    assert.ok(
      killedIt,
      "가짜 개발 서버가 안 죽었다. 배선이 끊겼거나, 이 기계에서 주인 판정이 늘 '주인 있음'으로 " +
      "떨어지는 것이다(살아 있는 claude 세션의 작업 폴더를 하나라도 못 읽으면 그렇게 된다). " +
      "훅 출력: " + JSON.stringify(r.stdout.slice(0, 300))
    );
    assert.match(r.stdout, /정리 신호를 보냈습니다/);
    assert.match(r.stdout, /CHAGEUN_SKIP_REAP=1/, "끄는 법을 안내문에 안 적었다");
  } finally { if (!killedIt) cleanup(v); else { try { nfs.rmSync(v.dir, { recursive: true, force: true }); } catch {} } }
});
