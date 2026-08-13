// chageun G7 - Claude PostToolUse guard: redact .env secret values from tool output before the model sees it.
// Task-0 spike (CC 2.1.207) confirmed: updatedToolOutput takes the full (redacted) tool_response value directly,
// it replaces the persisted transcript entry (no raw leak on --resume), and is honored above the 10K stdout cap.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { collectSecrets, redact } = require("./secret-scan-core.js");
// 🛑 **상황판 계열 require 는 감싼다.** 최상위 require 는 모듈 로드 시점에 던져서 아래 어떤
//   try/catch 도 못 잡고 훅이 통째로 죽는다. 이 훅의 본업은 `.env` 값 가리기(G7)라, 편의
//   기능의 파일 하나가 없어지는 것으로 **비밀값이 그대로 모델에 흘러가면 안 된다.**
//   못 부르면 상황판 갈래만 잠들고(아래 autoBoard 첫 줄) 가리기는 그대로 돈다.
let boardIgnoreVerdict = () => "unknown";   // 계약: ok 가 아니면 PostToolUse 는 안 쓴다
let boardRoot = null, auto = null;
try {
  ({ boardIgnoreVerdict } = require("./board-ignore-core.js"));
  boardRoot = require("./board-root-core.js");
  auto = require("./statusboard-auto-core.js");
} catch (e) {
  process.stderr.write("chageun: 상황판 모듈을 못 불렀다(.env 가리기는 그대로 산다): " + e.message + "\n");
}

function redactDeep(node, secrets, stats) {
  if (typeof node === "string") { const r = redact(node, secrets); stats.count += r.count; return r.text; }
  if (Array.isArray(node)) return node.map((n) => redactDeep(n, secrets, stats));
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) out[k] = redactDeep(node[k], secrets, stats);
    return out;
  }
  return node;
}
function touchesEnv(input) {
  try {
    const fp = input && (input.file_path || input.path);
    if (typeof fp === "string" && /\.env(\.|\b)/.test(fp)) return true;
    const cmd = input && input.command;
    if (typeof cmd === "string" && /\.env(\.|\b)/.test(cmd)) return true;
  } catch (_) {}
  return false;
}
const SUPPRESS = { hookSpecificOutput: { hookEventName: "PostToolUse",
  updatedToolOutput: "[chageun: .env output suppressed - redaction failed]" } };

const MAX_SCAN = 5 * 1024 * 1024; // 5MB: beyond this, skip to avoid 10s timeout → fail-open
function decide(input) {
  if (!input || input.tool_response == null) return null;
  const cwd = input.cwd || process.cwd();
  let secrets;
  try { secrets = collectSecrets(cwd); }
  catch (_) { return touchesEnv(input.tool_input) ? SUPPRESS : null; }
  if (!secrets.length) return null;
  let serialized;
  try { serialized = typeof input.tool_response === "string" ? input.tool_response : JSON.stringify(input.tool_response); }
  catch (_) { serialized = ""; }
  if (serialized.length > MAX_SCAN) return touchesEnv(input.tool_input) ? SUPPRESS : null; // fail-closed on .env, else pass
  const stats = { count: 0 };
  let updated;
  try { updated = redactDeep(input.tool_response, secrets, stats); }
  catch (_) { return touchesEnv(input.tool_input) ? SUPPRESS : null; }
  if (stats.count === 0) return null;
  return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } };
}

// ── 상황판 §2 자동 갱신(v0.65.0 F-27 · T2c) ──────────────────────────────────
// 🛑 **stdout 에 아무것도 안 쓴다.** 이 훅의 stdout 은 위 G7 가리기의 `updatedToolOutput`
//    계약이 쓰는 자리다: 여기 한 글자라도 얹으면 그 계약이 깨진다. 이 절의 출력은 **파일 하나**뿐이다.
// 🛑 **모든 실패는 침묵**이다(파일 못 씀 · git 없음 · 경계 깨짐 · 캐시 못 씀). 차단·park 사유가
//    아니다. 대신 마지막으로 쓴 `마지막 확인` 절대 시각이 **얼어붙어** 낡은 것이 눈에 보인다.
// 🛑 **트랜스크립트를 통째로 안 읽는다.** `pretooluse.js` §1.6 이 금지한 비용(실측 418ms)을
//    다른 훅에서 되살리지 않는다: 늘어난 만큼만 바이트 자리로 읽는다.
// ⚠ **도구 이름으로 안 거른다.** 읽는 것은 `tool_response` 가 아니라 `transcript_path` 라,
//    이 절은 "PostToolUse 가 Agent 호출에서도 도는가"에 안 걸린다(안 돌면 다음 호출이 따라잡는다).
const BOARD_FILE = boardRoot ? boardRoot.FILE : "status.md";
const TAIL_BYTES = 512 * 1024;          // 자리를 못 믿을 때 다시 보는 꼬리
const MAX_DELTA = 4 * 1024 * 1024;      // 한 회차에 보는 최대량
const FP_WINDOW = 64 * 1024;            // 지문 대조용 창
const OK_CACHE_MS = 5 * 60 * 1000;      // 통과 캐시(차단은 세션 내내)
const KEEP_MS = 7 * 24 * 3600 * 1000;

function boardStateDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "chageun", "board-tasks");
}
function boardSessionKey(input) {
  const raw = input.session_id || (input.transcript_path ? path.basename(input.transcript_path) : "");
  return raw ? String(raw).replace(/[^A-Za-z0-9_-]/g, "-") : null;
}
function readJson(file) {
  try { const o = JSON.parse(fs.readFileSync(file, "utf8")); return o && typeof o === "object" ? o : {}; }
  catch (_) { return {}; }
}
function sweepOld(dir) {
  try {
    const cutoff = Date.now() - KEEP_MS;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (_) { /* 개별 격리 */ }
    }
  } catch (_) { /* 정리 실패는 침묵 */ }
}
// 바이트 자리로만 읽는다(파일 전체를 메모리에 안 올린다).
function readRange(file, from, to) {
  if (to <= from) return "";
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(to - from);
    const n = fs.readSync(fd, buf, 0, buf.length, from);
    return { buf: buf.slice(0, n), from };
  } finally { fs.closeSync(fd); }
}
// 마지막 줄바꿈까지만 소비한다: 다음 회차가 **반쪽 줄에서 시작하지 않게**.
function consume(r) {
  if (!r || !r.buf || !r.buf.length) return { text: "", next: r ? r.from : 0 };
  const nl = r.buf.lastIndexOf(0x0a);
  if (nl === -1) return { text: r.buf.toString("utf8"), next: r.from + r.buf.length };
  return { text: r.buf.slice(0, nl + 1).toString("utf8"), next: r.from + nl + 1 };
}
const sha16 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

// 무시 판정 캐시는 **비대칭**이다: 통과는 5분, 차단은 세션 내내.
// 세션당 1회로 굳히면, 도중에 사용자가 `git add status.md` 를 했을 때 사람 편집은 PreToolUse 가
// 즉시 막는데 기계만 옛 통과값으로 계속 써서, 그 차단이 막으려던 결과가 그 창에서 성립한다.
function boardIgnorePasses(st, dir, now) {
  if (st.repoDir === dir) {
    if (st.ignoreVerdict === "blocked") return false;
    if (st.ignoreVerdict && now - (Number(st.ignoreVerdictAt) || 0) < OK_CACHE_MS) return st.ignoreVerdict === "ok";
  }
  const v = boardIgnoreVerdict(dir);
  st.repoDir = dir;
  st.ignoreVerdict = v;
  st.ignoreOk = v === "ok";
  st.ignoreVerdictAt = now;
  return st.ignoreOk;
}

function autoBoard(input) {
  if (!boardRoot || !auto) return;      // 상황판 모듈이 없으면 이 갈래만 잠든다(위 머리 주석)
  const cwd = input.cwd || process.cwd();
  const key = boardSessionKey(input);
  const tpath = input.transcript_path;
  if (!key || !tpath) return;
  const dir = boardStateDir();
  // ⚠ 상위 폴더를 먼저 만든다: 새 기계엔 없고, 없으면 ENOENT 로 조용히 실패해
  //   **새 사용자에게 이 기능이 한 번도 안 돈다**(표식 폴더·board.json 과 똑같은 구멍).
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, key + ".json");
  const fresh = !fs.existsSync(file);
  if (fresh) sweepOld(dir);
  const st = fresh ? {} : readJson(file);
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(st)); } catch (_) { /* 침묵 */ } };

  // 상황판이 없으면 여기서 끝이다. 🛑 만들지 않는다.
  // 판정은 훅 셋이 같은 부품으로 짓는다(board-root-core.js): 켠 폴더 한 곳이 아니라 경계까지
  //   위로 걷는다. 없는 프로젝트의 상시 비용은 `existsSync` 한 번에서 **최대 12번**으로 는다
  //   (MAX_UP). 이 자리는 이미 mkdir 한 번과 상태 파일 읽기를 지난 뒤라 델타가 그 안에 묻힌다.
  const boardDir = boardRoot.findBoardDir(cwd);
  if (boardDir === null) return;
  // 🛑 **쓰는 것은 켠 폴더가 그 폴더일 때만 한다.** 찾기를 위로 넓히면 뿌리 세션과 그 아래
  //    작업방 세션들이 **같은 파일 하나**를 대상으로 삼는데, 세션마다 장부가 따로라 각자
  //    자기 목록으로 §2 전체를 갈아 끼운다: 서로의 줄을 조용히 지운다. 하위 세션은 상황판을
  //    읽기만 한다(있다는 사실은 안내·부록이 이미 알려 준다).
  //    ⚠ 이 한 줄이 **읽기와 쓰기의 경계**다. 지우면 겹쳐 쓰기가 그날로 돌아온다.
  if (path.resolve(cwd) !== boardDir) return;
  const board = path.join(boardDir, BOARD_FILE);

  const size = fs.statSync(tpath).size;
  let from = Number(st.offset) || 0;
  // 자리를 못 믿는 세 경우: 처음 보는 세션 · 파일이 줄었다(압축·교체) · 지문이 안 맞는다.
  // 🛑 지문을 함께 보는 이유: 이 훅은 **자기가 트랜스크립트를 고쳐 쓴다**(G7 가리기가 기록된
  //    항목을 대체한다). 가려진 글이 원문보다 짧으면 **크기가 줄지 않고도** 뒤 바이트가 밀려
  //    조각이 반쪽 줄에서 시작하고, 이 판의 실패는 전부 침묵이라 한 건이 조용히 빠진다.
  let trusted = from > 0 && from <= size && !!st.offsetFingerprint;
  if (trusted) {
    const w = readRange(tpath, Math.max(0, from - FP_WINDOW), from);
    trusted = auto.fingerprintOf(w ? w.buf.toString("utf8") : "") === st.offsetFingerprint;
  }
  if (!trusted) from = Math.max(0, size - TAIL_BYTES);
  if (size - from > MAX_DELTA) from = size - MAX_DELTA;
  if (size < from) from = 0;

  const got = consume(readRange(tpath, from, size));
  const chunk = got.text;
  if (chunk) { st.offset = got.next; st.offsetFingerprint = auto.fingerprintOf(chunk); }

  // 조기 탈출: 장부에 도는 것이 없고 조각에 두 낱말이 없으면 **JSON 을 한 줄도 안 판다**.
  if (!auto.shouldParse(chunk, st)) { save(); return; }

  const now = Date.now();
  const tasks = st.tasks && typeof st.tasks === "object" ? st.tasks : {};
  const delta = auto.parseDelta(chunk);
  let secrets = [];
  try { secrets = collectSecrets(cwd); } catch (_) { secrets = []; }
  let changed = false;
  for (const s of delta.spawns) {
    const cur = tasks[s.agentId];
    if (!cur) { tasks[s.agentId] = { name: auto.safeName(s.name, secrets), spawnedAt: s.at || now, status: "" }; changed = true; }
    else if (s.name && cur.name === "(이름 없음)") { cur.name = auto.safeName(s.name, secrets); changed = true; }
  }
  for (const e of delta.ends) {
    const cur = tasks[e.taskId];
    if (!cur) continue;             // 🛑 장부에 없는 알림으로 줄을 만들지 않는다(창 밖·다른 통로)
    if (cur.status !== e.status || !cur.endedAt) { cur.status = e.status; cur.endedAt = e.at || now; changed = true; }
    if (e.quoted && cur.name === "(이름 없음)") { cur.name = auto.safeName(e.quoted, secrets); changed = true; }
  }
  if (changed) {
    const ids = Object.keys(tasks).sort((a, b) => (Number(tasks[b].spawnedAt) || 0) - (Number(tasks[a].spawnedAt) || 0));
    for (const id of ids.slice(auto.MAX_TASKS)) delete tasks[id];
  }
  st.tasks = tasks;

  // 사람 칸 대조는 **파일 내용으로** 한다(모델 기억 아님). 🛑 바뀌었다고 그 자리에서 쓰지
  //   않는다: 편집 도구는 읽은 뒤 파일이 바뀌면 그 편집을 거부해서, 상황판을 연달아 고치는
  //   흐름이 매번 한 번씩 실패한다. 달라진 값은 캐시에만 적고 **다음 장부 변화 때** 함께 나간다.
  let text = null;
  try { text = fs.readFileSync(board, "utf8"); } catch (_) { text = null; }
  if (text != null) {
    const h = sha16(auto.humanText(text));
    // 🛑 첫 회차에 `지금` 을 안 채운다: 방금 깐 기계가 몇 주 묵은 §1을 "방금 확인함"으로 만든다.
    if (!st.humanHash) st.humanHash = h;
    else if (st.humanHash !== h) { st.humanHash = h; st.humanSeenAt = now; }
  }

  // 이번 도구 호출의 대상이 상황판이었으면 이 회차에는 안 쓴다(경로만 본다: 안 쓰는 쪽으로
  //   기우는 판정이라 넓어도 안전하다). [Read status.md → 기계가 씀 → 그 Edit 이 거부됨] 을 막는다.
  //   🛑 밀린 쓰기를 잃지 않게 `pendingWrite` 로 다음 회차에 넘긴다.
  const ti = input.tool_input || {};
  const targetIsBoard = !!(ti && ti.file_path && path.resolve(cwd, String(ti.file_path)) === board);
  const wantWrite = changed || st.pendingWrite === true;
  if (!wantWrite) { save(); return; }
  // 무시 판정은 **상황판이 있는 폴더**에서 짓는다. `boardIgnoreVerdict` 는 그 폴더에서
  //   `git ls-files/check-ignore status.md` 를 돌려 **상대 경로 하나**를 묻기 때문이다.
  //   위 경계 한 줄 덕분에 여기서는 boardDir === cwd 가 이미 참이지만, 묻는 대상을 이름으로
  //   적어 둔다: 나중에 그 줄이 풀리면 이 자리가 조용히 엉뚱한 파일을 묻게 된다.
  if (targetIsBoard || text == null || !boardIgnorePasses(st, boardDir, now)) { st.pendingWrite = true; save(); return; }

  let out = text;
  const s2 = auto.spliceBlock(out, auto.renderBlock(st.tasks, now), "chageun:auto");
  if (s2 !== null) out = s2;
  const s1 = auto.spliceBlock(out, auto.renderHead(now, st.humanSeenAt), "chageun:auto:head");
  if (s1 !== null) out = s1;
  // 표시가 깨졌거나 아예 없으면 out === text 다: 한 글자도 안 쓴다. 그 사실을 사람에게
  // 알리는 일은 세션 시작 부록이 하고, 여기서는 자리를 짐작해 끼워 넣지 않는다.
  if (out !== text) { try { fs.writeFileSync(board, out); } catch (_) { /* 침묵 */ } }
  st.pendingWrite = false;
  save();
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let input = null;
    try {
      input = JSON.parse(raw);
      const out = decide(input);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (_) { /* fail-open */ }
    // 자체 try/catch 로 격리한다: 예외가 위 G7 경로로 새면 안 된다.
    try { if (input) autoBoard(input); } catch (_) { /* 침묵 */ }
    process.exit(0);
  });
}
module.exports = { decide, autoBoard };
