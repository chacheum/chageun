// 상황판 보는 페이지: 여러 프로젝트의 status.md 를 모아 한 장으로 보여 준다.
//
// 왜 있나: 자리를 비운 사이 여러 세션이 뒤에서 일한다. 돌아왔을 때 "무엇이 끝났고 내가
// 무엇을 해야 하나"가 한눈에 안 보이면 대화를 거슬러 올라가며 다시 읽어야 한다.
//
// 🛑 **기본은 이 컴퓨터에서만 열린다**(127.0.0.1). 비밀번호가 없으므로 밖으로 여는 것은
//    사용자가 직접 정한다. 무인 모드에서는 그 설정을 무시하고 loopback 으로 고정한다.
// 🛑 **읽기만 한다.** 요청 문자열로 경로를 만들지 않는다: 목록은 매번 폴더를 직접 훑어
//    서버가 만든다. 쓰는 자리는 아래 실행 상태 파일 **한 곳**뿐이고 그 경로는 이 파일
//    맨 위 STATE_DIR·STATE_FILE 에서만 정한다.
// 🛑 **자바스크립트를 안 쓴다.** 스크립트를 쓰면 CSP 에 `script-src 'unsafe-inline'` 을
//    열어야 하는데, 그 상태로 "밖으로 데이터를 보낼 통로가 없다"고 적는 것은 사실이 아니다
//    (`default-src 'none'` 은 인라인 스크립트의 화면 이동을 안 막는다).
import { createServer, request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveRoot, listBoards, slugify, todoCount, esc, md, ago, FILE } from "./board-core.mjs";

// 쓰기가 허용된 유일한 자리. 다른 어떤 경로도 이 파일에서 안 만든다(성공 기준 E).
const STATE_DIR = (env) => join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "chageun");
const STATE_FILE = (env) => join(STATE_DIR(env), "board.json");

const DEFAULT_PORT = 8095;
const PORT_TRIES = 10;            // 8095 ~ 8104
// loopback 판정은 **명시 목록 셋**뿐이다. 규칙을 넓히면(예: `127.` 로 시작하면 전부)
// 경고 없이 밖에 열리는 조합이 생긴다. 좁게 잡으면 최악이 "안 위험한데 경고가 뜬다"다.
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export const isLoopback = (h) => LOOPBACK.has(String(h));

export function hostFor(env) {
  if (env.CHAGEUN_UNATTENDED === "1") return "127.0.0.1";   // 사람 없는 사이에 밖으로 열지 않는다
  return env.CHAGEUN_BOARD_HOST || "127.0.0.1";
}

const CSS = `
:root{--bg:#faf9f7;--surface:#fff;--line:#e3e0da;--ink:#1c1b19;--ink2:#56534d;--ink3:#8a867e;--accent:#9a5b12;--accentSoft:#fdf3e4;--alert:#b4341c;--alertSoft:#fbe6e1}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--surface:#1e1d1a;--line:#34322d;--ink:#f0eee9;--ink2:#b3aea4;--ink3:#837e74;--accent:#e0a355;--accentSoft:#2b2216;--alert:#e8836b;--alertSoft:#3a1f18}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.65;
 font-family:-apple-system,"Segoe UI","Noto Sans KR","Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:32px 24px 80px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.top b{font-size:1.15rem;letter-spacing:-.01em}
.top span{color:var(--ink3);font-size:.8rem;font-variant-numeric:tabular-nums}
.warn{background:var(--alertSoft);color:var(--alert);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:.85rem}
.layout{display:grid;grid-template-columns:246px minmax(0,1fr);gap:20px;align-items:start}
.tabs{display:flex;flex-direction:column;gap:8px;position:sticky;top:20px}
.tabs a{display:block;text-decoration:none;background:var(--surface);border:1px solid var(--line);
 border-radius:10px;padding:11px 13px;color:var(--ink2)}
.tabs a:hover{border-color:var(--ink3)}
.tabs a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tabs .nm{display:block;font-size:.92rem;font-weight:600;letter-spacing:-.01em;
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabs .meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px}
.tabs .when{font-size:.75rem;color:var(--ink3);font-variant-numeric:tabular-nums}
.tabs .todo{min-width:19px;height:19px;padding:0 6px;border-radius:10px;background:var(--alertSoft);color:var(--alert);
 font-size:.72rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px 26px 26px;margin-bottom:16px}
/* 탭 전환은 :target 으로만 한다. :has() 를 모르는 브라우저에서는 이 규칙이 통째로 안 걸려
   **모든 판이 다 보이는 쪽**으로 무너진다(아무것도 안 보이는 쪽이 아니라). */
@supports selector(:has(*)){
  body:has(.panel:target) .panel{display:none}
  body:has(.panel:target) .panel:target{display:block}
}
@media (max-width:880px){
  .layout{grid-template-columns:minmax(0,1fr)}
  .tabs{flex-direction:row;position:static;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
  .tabs a{flex:0 0 auto;min-width:150px}
}
h1{font-size:1.35rem;font-weight:650;letter-spacing:-.02em;margin:18px 0 2px;text-wrap:balance}
h2{font-size:1rem;font-weight:650;margin:26px 0 8px;letter-spacing:-.01em}
h3{font-size:.9rem;font-weight:650;margin:20px 0 6px;color:var(--ink2)}
p{margin:8px 0}
hr{border:0;border-top:1px solid var(--line);margin:20px 0}
blockquote{margin:10px 0;padding:12px 16px;background:var(--accentSoft);border-radius:8px;color:var(--ink2);font-size:.9rem}
ul,ol{margin:8px 0;padding-left:22px}
li{margin:3px 0}
code{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:.85em}
.tw{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink3);font-weight:600;font-size:.78rem}
.foot{color:var(--ink3);font-size:.75rem;margin-top:14px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.foot a{color:var(--ink2)}
.empty{color:var(--ink3);padding:48px 20px;text-align:center;background:var(--surface);
 border:1px solid var(--line);border-radius:12px;margin-top:18px}
.note{color:var(--ink3);font-size:.75rem;margin-top:24px;text-align:center}
`;

/** 목록 → 페이지 한 장. 순수 함수(요청 문자열을 안 본다). */
export function renderPage(list, opts = {}) {
  const slugs = slugify(list.map((b) => b.name));
  const todo = list.reduce((n, b) => n + (todoCount(b.text) || 0), 0);
  const t = opts.now || Date.now();
  // 새로고침은 **판마다 하나**, 그 판의 조각을 뒤에 붙인다. 주소 뒤 `#` 는 서버에 안 가므로
  // 머리띠에 하나만 두면 누를 때마다 첫 탭으로 튄다.
  const reload = (slug) => `<a href="/?t=${t}${slug ? "#" + slug : ""}">새로고침</a>`;

  const tabs = list.map((b, i) => {
    const n = todoCount(b.text);
    return `<a href="#${slugs[i]}"><span class="nm">${esc(b.name)}</span>` +
      `<span class="meta"><span class="when">${ago(b.mtime)}</span>` +
      (n ? `<span class="todo" title="하실 것 ${n}건">${n}</span>` : "") +
      "</span></a>";
  }).join("");

  const panels = list.map((b, i) =>
    `<section class="panel" id="${slugs[i]}">${md(b.text)}` +
    // 전체 경로는 안 적는다: 계정 이름이 드러난다.
    // ⚠ mtime 라벨은 `파일 바뀜` 이다. 기계가 §2를 쓰기 시작하면 이 값은 "기계가 마지막으로
    //   건드린 때"라, `갱신`·`최신` 이라 적으면 §1이 몇 주 묵어도 "방금 갱신"이 된다.
    //   상황판이 언제 기준인가는 파일 안 머리 블록이 원본이고 페이지는 그것을 그냥 렌더한다.
    `<div class="foot"><span>${esc(b.name)}/${esc(FILE)} · 파일 바뀜 ${ago(b.mtime)}` +
    (b.truncated ? " · 잘림(앞부분만)" : "") + `</span>${reload(slugs[i])}</div></section>`
  ).join("");

  const body = list.length
    ? `<div class="layout"><nav class="tabs">${tabs}</nav><div>${panels}</div></div>`
    : `<div class="empty">아직 상황판이 없습니다. 각 프로젝트 폴더에 <code>${esc(FILE)}</code> 를 두면 여기 목록에 모입니다. ${reload("")}</div>`;

  const warn = opts.exposed
    ? '<div class="warn">이 페이지는 이 컴퓨터 밖에서도 열립니다 · 비밀번호 없음</div>' : "";

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="30">
<title>작업 상황판</title><style>${CSS}</style></head><body>
<div class="wrap">
<div class="top"><b>작업 상황판</b><span>세션 ${list.length}개${todo ? ` · 하실 것 ${todo}건` : ""} · 30초마다 새로고침</span></div>
${warn}${body}
<div class="note">이 페이지엔 비밀번호가 없습니다 · 비밀·고객 정보는 적지 마세요</div>
</div>
</body></html>`;
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'",
  "x-chageun-board": "1",
};

/** 서버 하나를 띄운다. 검사는 이 함수를 직접 부른다(포트 0). */
export function start(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const host = opts.host || hostFor(env);
  const exposed = !isLoopback(host);
  const { root, single } = resolveRoot(cwd, env);

  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8", "x-chageun-board": "1" });
      return res.end("읽기 전용입니다.");
    }
    // 🛑 요청 문자열(경로·질의)을 **안 읽는다.** 목록은 서버가 직접 훑어 만든다.
    let list = [];
    try { list = listBoards(root, { single }); } catch (_) { list = []; }
    res.writeHead(200, HEADERS);
    if (req.method === "HEAD") return res.end();
    res.end(renderPage(list, { exposed }));
  });

  const started = (resolve) => {
    const port = server.address().port;
    if (exposed) {
      process.stderr.write("[chageun] 상황판이 이 컴퓨터 밖에서도 열립니다(비밀번호 없음): " + host + ":" + port + "\n");
    }
    // 실행 상태 파일: 답장 끝 사다리가 여기서 주소를 읽는다(포트를 손으로 박지 않는다).
    let wrote = false;
    try {
      mkdirSync(STATE_DIR(env), { recursive: true });
      writeFileSync(STATE_FILE(env), JSON.stringify({ host, port, root, pid: process.pid }));
      wrote = true;
    } catch (_) { /* 상태 파일을 못 써도 서버는 그대로 돈다 */ }
    resolve({ server, host, port, url: `http://${host}:${port}/`, wrote, close: () => closeAll(server, env) });
  };

  return new Promise((resolve, reject) => {
    const want = opts.port != null ? Number(opts.port)
      : (env.CHAGEUN_BOARD_PORT ? Number(env.CHAGEUN_BOARD_PORT) : DEFAULT_PORT);
    let tries = 0;
    const tryListen = (p) => {
      server.removeAllListeners("error");
      server.once("error", async (e) => {
        if (e && e.code === "EADDRINUSE" && p !== 0) {
          // 이미 쓰는 중이면 **내 서버인지 헤더로 확인**한다. 맞으면 새로 안 띄운다.
          if (await isOwnBoard(host, p)) return reject(Object.assign(new Error("already"), { already: true, host, port: p }));
          if (++tries < PORT_TRIES) return tryListen(want + tries);
        }
        reject(e);
      });
      server.listen(p, host, () => started(resolve));
    };
    tryListen(want);
  });
}

function isOwnBoard(host, port) {
  return new Promise((resolve) => {
    const req = httpRequest({ host, port, method: "HEAD", path: "/", timeout: 1000 }, (res) => {
      resolve(String(res.headers["x-chageun-board"] || "") === "1");
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// 🛑 상태 파일은 **내 pid 일 때만** 지운다. 자리가 고정 한 곳이라, 검증용으로 하나 더
//    띄웠다 끄면 사용자가 띄워 둔 서버의 주소를 지우게 된다: 그 서버는 멀쩡히 떠 있는데
//    사다리가 못 찾아 조용히 1단으로 떨어진다.
function closeAll(server, env) {
  try {
    const cur = JSON.parse(readFileSync(STATE_FILE(env), "utf8"));
    if (cur && cur.pid === process.pid) unlinkSync(STATE_FILE(env));
  } catch (_) { /* 남의 것이거나 없으면 그대로 둔다 */ }
  try { server.close(); } catch (_) {}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().then((h) => {
    process.stdout.write(`상황판 서버: http://${h.host}:${h.port}/\n`);
    const bye = (code) => { h.close(); process.exit(code); };
    process.on("SIGINT", () => bye(130));
    process.on("SIGTERM", () => bye(143));
    process.on("exit", () => { try { h.close(); } catch (_) {} });
  }).catch((e) => {
    if (e && e.already) {
      process.stdout.write(`상황판 서버가 이미 떠 있습니다: http://${e.host}:${e.port}/\n`);
      process.exit(0);
    }
    process.stderr.write("상황판 서버를 못 띄웠습니다: " + (e && e.message ? e.message : e) + "\n");
    process.exit(1);
  });
}

export { STATE_DIR, STATE_FILE, DEFAULT_PORT };
