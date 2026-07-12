// chageun: SessionStart hook — reap stale (folder-deleted) dev servers to reclaim memory.
// Each vibe-coding session tends to spawn a `next dev`/vite server; when its folder is
// later deleted/rebuilt the server keeps running as a multi-GB zombie. This sweeps those
// at session START only (matcher "startup", not resume/clear/compact). Linux/WSL only.
// Best-effort & FAIL-OPEN: any error is swallowed and the session is never blocked. Reaps
// only processes that are BOTH a dev server AND have a deleted working directory
// (see reap-dev-servers-core.js). Kill list is re-checked per-pid right before SIGTERM.
"use strict";

const fs = require("fs");
const { selectReapable } = require("./reap-dev-servers-core.js");

function scanProc() {
  const procs = [];
  let entries;
  try { entries = fs.readdirSync("/proc"); } catch (_) { return procs; }

  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const base = "/proc/" + name;
    try {
      // Owner uid — skip anything we can't stat (gone / other user).
      let uid = null;
      try { uid = fs.statSync(base).uid; } catch (_) { continue; }

      // Cheap pre-filter: only deleted-cwd processes can ever be reaped, so bail early
      // otherwise. This also keeps us from reading comm/cmdline for hundreds of PIDs.
      let cwd = "";
      try { cwd = fs.readlinkSync(base + "/cwd"); } catch (_) { continue; }
      if (!/ \(deleted\)$/.test(cwd)) continue;
      // (Fable5 finding 3b) A folder LITERALLY named "… (deleted)" is not deleted — if a
      // real folder exists at that exact path, the server is live; skip it.
      try { if (fs.existsSync(cwd)) continue; } catch (_) {}

      let comm = "";
      try { comm = fs.readFileSync(base + "/comm", "utf8").trim(); } catch (_) {}
      let cmdline = "";
      try { cmdline = fs.readFileSync(base + "/cmdline", "utf8").replace(/\0/g, " ").trim(); } catch (_) {}

      let ppid = 0;
      try {
        const st = fs.readFileSync(base + "/stat", "utf8");
        // comm (field 2) is parenthesized and may contain spaces/parens; ppid is the
        // field right after the state char, which follows the LAST ')'.
        const rp = st.lastIndexOf(")");
        if (rp !== -1) ppid = Number(st.slice(rp + 2).split(" ")[1]) || 0;
      } catch (_) {}

      procs.push({ pid: Number(name), ppid, uid, comm, cmdline, cwd });
    } catch (_) { /* per-pid isolation */ }
  }
  return procs;
}

// pid-reuse guard (Fable5 finding 6): confirm the pid STILL has a deleted cwd right
// before we SIGTERM it, so a pid recycled between scan and kill is never hit.
function stillDeleted(pid) {
  try { return / \(deleted\)$/.test(fs.readlinkSync("/proc/" + pid + "/cwd")); } catch (_) { return false; }
}

function main() {
  if (process.platform !== "linux") return; // /proc semantics assumed (WSL/Linux)

  let ownUid = null;
  try { if (typeof process.getuid === "function") ownUid = process.getuid(); } catch (_) {}

  const procs = scanProc();
  const targets = selectReapable(procs, ownUid, { selfPid: process.pid });
  if (!targets.length) return;

  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const killed = [];
  for (const pid of targets) {
    if (!stillDeleted(pid)) continue; // pid-reuse guard
    try { process.kill(pid, "SIGTERM"); killed.push(pid); } catch (_) { /* already gone */ }
  }
  if (killed.length) {
    // (Fable5 finding 4) include each victim's cmdline so a wrong kill is diagnosable
    // after the fact (the /proc entry is gone once killed). Synchronous write so the
    // notice survives process exit. Emitted only when something was actually reaped.
    const lines = killed.map((pid) => {
      const p = byPid.get(pid);
      const cmd = p ? String(p.cmdline || p.comm || "").slice(0, 120) : "";
      return "  [PID " + pid + "] " + cmd;
    });
    try {
      fs.writeSync(
        1,
        "차근: 안 쓰는(작업 폴더가 삭제된) 개발 서버 " + killed.length +
        "개를 정리해 메모리를 회수했습니다.\n" + lines.join("\n") + "\n"
      );
    } catch (_) {}
  }
}

try { main(); } catch (_) { /* never block session start */ }
