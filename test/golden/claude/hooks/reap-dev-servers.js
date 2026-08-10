// chageun: SessionStart hook — reap dev servers nobody is using, to reclaim memory.
// Each vibe-coding session tends to spawn a `next dev`/vite server; those keep running
// long after the session (or the folder) is gone, each holding hundreds of MB. This
// sweeps them at session START only (matcher "startup"). Linux/WSL only.
// Best-effort & FAIL-OPEN: any error is swallowed and the session is never blocked.
//
// Reaped: a dev server whose folder was deleted, OR one that is idle + orphaned + old
// (no established connection on its listening port, no live `claude` ancestor, 2h+).
// The rules and the reasoning live in reap-dev-servers-core.js; this file only gathers
// the facts (/proc, `ss`) and does the killing. Every fact we fail to gather is passed
// through as "unknown", which the core reads as "do not kill".
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");
const { selectReapableDetailed, parseStat, ageMsFromStat, parseSsNet } = require("./reap-dev-servers-core.js");

// Seconds since boot — the reference for every process age. null → no age is known.
function readUptimeSec() {
  try {
    const v = Number(String(fs.readFileSync("/proc/uptime", "utf8")).trim().split(/\s+/)[0]);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (_) { return null; }
}

// Listening/established TCP sockets with their owning pids. null → we could not look,
// which the core treats as "everything has clients" (so nothing is reaped for idleness).
// `ss` may sit outside a hook's PATH, hence the explicit fallbacks.
const SS_PATHS = ["ss", "/usr/sbin/ss", "/sbin/ss", "/usr/bin/ss"];
function readNet() {
  for (const bin of SS_PATHS) {
    try {
      const out = execFileSync(bin, ["-H", "-tan", "-p"], {
        encoding: "utf8", timeout: 3000, maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const net = parseSsNet(out);
      if (net) return net;
    } catch (_) { /* missing / no permission / timed out → try the next path */ }
  }
  return null;
}

// Full /proc sweep. It is deliberately NOT pre-filtered any more: the parent chain walk
// needs every process (a dev server is only "orphaned" once we can prove no live claude
// ancestor), so filtering early would make unrelated processes look like orphans.
function scanProc(uptimeSec) {
  const procs = [];
  let entries;
  try { entries = fs.readdirSync("/proc"); } catch (_) { return procs; }

  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const base = "/proc/" + name;
    try {
      // Owner uid — skip anything we can't stat (gone / unreadable).
      let uid = null;
      try { uid = fs.statSync(base).uid; } catch (_) { continue; }

      let comm = "";
      try { comm = fs.readFileSync(base + "/comm", "utf8").trim(); } catch (_) {}
      let cmdline = "";
      try { cmdline = fs.readFileSync(base + "/cmdline", "utf8").replace(/\0/g, " ").trim(); } catch (_) {}

      let ppid = 0, startTicks = null, ageMs = null;
      try {
        const st = fs.readFileSync(base + "/stat", "utf8");
        const parsed = parseStat(st);
        ppid = parsed.ppid;
        startTicks = parsed.startTicks;
        ageMs = uptimeSec == null ? null : ageMsFromStat(st, uptimeSec);
      } catch (_) {}

      // cwd is only readable for our own processes; an unreadable cwd is simply "" and
      // therefore never counts as deleted.
      let cwd = "";
      try { cwd = fs.readlinkSync(base + "/cwd"); } catch (_) {}
      // (Fable5 finding 3b) A folder LITERALLY named "… (deleted)" is not deleted — if a
      // real folder exists at that exact path, the server is live; drop the suffix claim.
      if (cwd && / \(deleted\)$/.test(cwd)) {
        try { if (fs.existsSync(cwd)) cwd = cwd.replace(/ \(deleted\)$/, ""); } catch (_) {}
      }

      procs.push({ pid: Number(name), ppid, uid, comm, cmdline, cwd, ageMs, startTicks });
    } catch (_) { /* per-pid isolation */ }
  }
  return procs;
}

// pid-reuse guard (Fable5 finding 6): a pid recycled between scan and kill must never be
// hit. Start time is the strongest identity check available — it changes with the pid.
function stillSameProcess(p) {
  try {
    const now = parseStat(fs.readFileSync("/proc/" + p.pid + "/stat", "utf8"));
    return p.startTicks != null && now.startTicks != null && now.startTicks === p.startTicks;
  } catch (_) { return false; }
}

// The original anchor, re-checked at kill time for the deleted-folder branch.
function stillDeleted(pid) {
  try {
    const cwd = fs.readlinkSync("/proc/" + pid + "/cwd");
    if (!/ \(deleted\)$/.test(cwd)) return false;
    return !fs.existsSync(cwd);
  } catch (_) { return false; }
}

function main() {
  if (process.platform !== "linux") return; // /proc semantics assumed (WSL/Linux)

  let ownUid = null;
  try { if (typeof process.getuid === "function") ownUid = process.getuid(); } catch (_) {}

  const uptimeSec = readUptimeSec();
  const procs = scanProc(uptimeSec);
  const opts = { selfPid: process.pid, net: readNet() };
  let targets = selectReapableDetailed(procs, ownUid, opts);
  if (!targets.length) return;

  // A browser tab opened in the second between the socket snapshot and the kill would
  // make an "idle" verdict wrong, so idle victims must survive a SECOND, fresh socket
  // reading. (Folder-deleted victims need no such confirmation.)
  if (targets.some((t) => t.reason === "idle")) {
    const again = new Set(
      selectReapableDetailed(procs, ownUid, { selfPid: process.pid, net: readNet() }).map((t) => t.pid)
    );
    targets = targets.filter((t) => t.reason === "deleted" || again.has(t.pid));
    if (!targets.length) return;
  }

  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const killed = [];
  for (const t of targets) {
    const p = byPid.get(t.pid);
    if (!p || !stillSameProcess(p)) continue;                       // pid-reuse guard
    if (t.reason === "deleted" && !stillDeleted(t.pid)) continue;   // anchor re-check
    try { process.kill(t.pid, "SIGTERM"); killed.push(t); } catch (_) { /* already gone */ }
  }
  if (killed.length) {
    // (Fable5 finding 4) include each victim's cmdline and WHY it was picked, so a wrong
    // kill is diagnosable after the fact (the /proc entry is gone once killed).
    // Synchronous write so the notice survives process exit.
    const why = { deleted: "작업 폴더 삭제됨", idle: "접속 0·주인 세션 없음·2시간+" };
    const lines = killed.map((t) => {
      const p = byPid.get(t.pid);
      const cmd = p ? String(p.cmdline || p.comm || "").slice(0, 120) : "";
      return "  [PID " + t.pid + "] " + (why[t.reason] || t.reason) + " — " + cmd;
    });
    try {
      fs.writeSync(
        1,
        "차근: 안 쓰는 개발 서버 " + killed.length +
        "개를 정리해 메모리를 회수했습니다.\n" + lines.join("\n") + "\n"
      );
    } catch (_) {}
  }
}

try { main(); } catch (_) { /* never block session start */ }
