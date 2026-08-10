// chageun: stale dev-server reaper — shared pure logic (Claude SessionStart hygiene).
// A process is reaped only when it is a known dev server AND one of two things is true:
//   (a) its working directory was deleted out from under it (readlink → "… (deleted)"), or
//   (b) it is idle AND ownerless AND old — no established connection on the port it
//       listens on, no live `claude` session that owns it (by parent chain OR by working
//       folder), and 2h+ alive (all three, AND).
// No side effects here; the hook wraps the real /proc scan + kill around selectReapable.
//
// Why (b) exists (2026-08-10 measurement): a vite server had been up 6h39m with 0
// connections, 144s CPU and 299MB RSS, and its owning session was long gone — but its
// folder still existed, so rule (a) never touched it. Why THESE three conditions:
//   1. connections — vite/next hold an HMR socket open for every live browser tab, so
//      "someone is looking at it" shows up as an established connection and we back off.
//      A curl-once-in-a-while user leaves no connection; condition 2 covers that case.
//   2. owner session — a server that belongs to a live claude session is still someone's,
//      however quiet it is. Belonging is read two ways (ppid chain, working folder)
//      because the first one alone measured as "never owned" — see ownerAlive.
//   3. 2 hours — a just-started server is between requests, not abandoned.
// Every unknown falls to "do NOT kill": no socket data (ss missing/failed) counts as
// connected, an unreadable parent chain counts as owner-alive, an unknown age counts as
// young. Reading a failure as "idle" would reap every dev server on the machine.
//
// Matcher discipline (Fable5 audit): identification is TOKEN-based, not substring —
// a token's basename must BE the launcher (…/next, …/vite.js) and (where the tool
// has one-off subcommands) the NEXT arg must be the dev subcommand. Plus `comm` must
// be node-family. This rejects `python3 ~/dev/next-gen/train.py`, an open vim, a
// `tail` on a next-*.log, a nextcloud backup daemon, `--url foo.ng … serve`, etc.
"use strict";

// Is this token the given launcher by basename? e.g. tokenIs("/app/.bin/next","next")
// matches "/app/.bin/next" and "next" but NOT "nextcloud" or "next-gen".
function tokenIs(tok, name) {
  return new RegExp("(?:^|/)" + name + "(?:\\.[cm]?js)?$").test(String(tok || ""));
}

// A dev server: comm is node-family (or the Next.js worker renames itself next-server),
// AND a cmdline token is a known dev launcher with the right dev subcommand.
function isDevServer(comm, cmdline) {
  const c = String(comm || "");
  if (c === "next-server") return true;                 // Next.js worker renames its own comm — reliable
  const cl = String(cmdline || "");
  if (!cl) return false;
  if (!/^node(js)?$/.test(c)) return false;             // dev servers run on node — kills python/tail/vim/bash FPs
  const toks = cl.split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], nx = toks[i + 1] || "";
    if (t === "next-server" || tokenIs(t, "next-server")) return true; // worker in cmdline
    if (tokenIs(t, "next") && nx === "dev") return true;               // next dev
    if (tokenIs(t, "nuxt") && nx === "dev") return true;               // nuxt dev
    if (tokenIs(t, "astro") && nx === "dev") return true;              // astro dev
    if (tokenIs(t, "vite") && !/^(build|preview|optimize)$/.test(nx)) return true; // vite (dev is default)
    if (tokenIs(t, "webpack-dev-server")) return true;                 // webpack-dev-server
    if (/(?:^|\/)react-scripts\/.*start(?:\.[cm]?js)?$/.test(t)) return true; // react-scripts start
    if (tokenIs(t, "ng") && nx === "serve") return true;               // angular ng serve
  }
  return false;
}

// A dev-server LAUNCHER (for parent reaping) — npm/yarn/pnpm run dev, or nodemon.
// Narrower than isDevServer so a generic node daemon parent is never reaped.
function isDevLauncher(cmdline) {
  const toks = String(cmdline || "").split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/(?:^|\/)(npm|yarn|pnpm)(?:-cli\.js)?$/.test(t) && toks[i + 1] === "run" && toks[i + 2] === "dev") return true;
    if (tokenIs(t, "nodemon")) return true;
  }
  return false;
}

// readlink on /proc/<pid>/cwd appends " (deleted)" when the directory is gone.
// (The hook additionally verifies no live folder literally sits at that path.)
function isDeleted(cwd) {
  return typeof cwd === "string" && / \(deleted\)$/.test(cwd);
}

// A live Claude session (the thing that launches dev servers). Deliberately GENEROUS:
// every extra match here only makes us keep MORE servers alive, never fewer.
function isClaudeSession(comm, cmdline) {
  if (String(comm || "") === "claude") return true;          // observed comm of the CLI
  const cl = String(cmdline || "");
  if (!cl) return false;
  for (const t of cl.split(/\s+/)) if (tokenIs(t, "claude")) return true;
  return /@anthropic-ai\/claude-code/.test(cl);              // run via node .../cli.js
}

// Does `base` contain `target` (same folder, or an ancestor of it)? Compared on path
// SEGMENTS, never as a raw string prefix: "/a/b".startsWith("/a/b") would also swallow
// the unrelated sibling "/a/bc", handing one project's session ownership of another's.
function pathCovers(base, target) {
  const strip = (s) => String(s == null ? "" : s).replace(/\/+$/, "");
  const b = strip(base), t = strip(target);
  if (!String(base || "").trim() || !String(target || "").trim()) return false;
  if (b === "" ) return String(target).startsWith("/");   // base was "/" → covers all
  if (b === t) return true;
  return t.startsWith(b + "/");                            // the "/" IS the boundary check
}

// ── parsers for the raw files/commands the hook feeds in ────────────────────────────
// /proc/<pid>/stat: comm (field 2) is parenthesized and may contain spaces AND parens
// ("node (vitest 1)"), so every field is counted from the LAST ')'. After that slice,
// index 0 is the state char (field 3) → ppid = index 1, starttime = index 19 (field 22).
function parseStat(statText) {
  const s = String(statText || "");
  const rp = s.lastIndexOf(")");
  if (rp === -1) return { ppid: 0, startTicks: null };
  const f = s.slice(rp + 2).split(/\s+/);
  const ppid = Number(f[1]);
  const ticks = Number(f[19]);
  return {
    ppid: Number.isFinite(ppid) ? ppid : 0,
    startTicks: Number.isFinite(ticks) && ticks >= 0 ? ticks : null,
  };
}

// USER_HZ in /proc is 100 on Linux regardless of the kernel's CONFIG_HZ.
const USER_HZ = 100;

// Age from starttime (ticks since boot) + /proc/uptime seconds. null = unknown → the
// caller treats it as "too young to reap".
function ageMsFromStat(statText, uptimeSec) {
  const { startTicks } = parseStat(statText);
  if (startTicks == null) return null;
  if (!Number.isFinite(uptimeSec) || uptimeSec <= 0) return null;
  const ageSec = uptimeSec - startTicks / USER_HZ;
  if (!Number.isFinite(ageSec) || ageSec < 0) return null;   // clock nonsense → unknown
  return Math.round(ageSec * 1000);
}

// `ss -H -tan -p` output → { listen: [{pid, port}], estab: [{pid, port}] }.
// Returns null when there is nothing to trust (no/blank output) — the caller reads null
// as "assume connected". A socket can be held by several pids (fork), so all are kept;
// a line with no users:(…) (no permission to attribute) yields pid null but keeps the
// port, which is enough to block a kill.
function parseSsNet(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return null;
  const listen = [], estab = [];
  for (const raw of s.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const tok = line.split(/\s+/);
    const state = tok[0];
    const bucket = state === "LISTEN" ? listen : state === "ESTAB" ? estab : null;
    if (!bucket) continue;                       // TIME-WAIT/CLOSE-WAIT/… are not users
    const local = tok[3] || "";
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    if (!Number.isInteger(port) || port <= 0) continue;
    const pids = [...line.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    if (!pids.length) bucket.push({ pid: null, port });
    else for (const pid of pids) bucket.push({ pid, port });
  }
  return { listen, estab };
}

const MAX_KILL = 50;                    // backstop against a pathological mass-kill
const IDLE_MIN_AGE_MS = 2 * 60 * 60 * 1000; // 2h — below this a quiet server is just idle
const MAX_PARENT_HOPS = 64;             // pid chains are shallow; also a cycle backstop

// procs: [{ pid, ppid, uid, comm, cmdline, cwd, ageMs }] (uid/ppid/ageMs may be
//   null/0/undefined if unknown — every unknown resolves to "do not kill").
// ownUid: only own-user processes are eligible (null → skip the uid filter).
// opts.selfPid: never reap this pid (the hook's own process).
// opts.net: parseSsNet() output, or null/absent when sockets could not be listed.
// Returns [{ pid, reason }] sorted by pid, de-duped, capped. reason: "deleted" | "idle".
function selectReapableDetailed(procs, ownUid, opts) {
  opts = opts || {};
  const selfPid = opts.selfPid;
  if (!Array.isArray(procs)) return [];

  const byPid = new Map();
  for (const p of procs) if (p && Number.isInteger(p.pid)) byPid.set(p.pid, p);

  const eligible = (p) =>
    p && Number.isInteger(p.pid) && p.pid > 1 &&
    !(selfPid && p.pid === selfPid) &&
    !(ownUid != null && p.uid != null && p.uid !== ownUid);

  // Socket facts. netKnown=false means we could not look, which counts as "connected".
  const net = opts.net;
  const netKnown = !!(net && Array.isArray(net.listen) && Array.isArray(net.estab));
  const listenByPid = new Map(), estabPorts = new Set(), estabPids = new Set();
  if (netKnown) {
    for (const e of net.listen) {
      if (!e || !Number.isInteger(e.pid)) continue;
      if (!listenByPid.has(e.pid)) listenByPid.set(e.pid, new Set());
      listenByPid.get(e.pid).add(e.port);
    }
    for (const e of net.estab) {
      if (!e) continue;
      if (Number.isInteger(e.port)) estabPorts.add(e.port);
      if (Number.isInteger(e.pid)) estabPids.add(e.pid);
    }
  }

  // "Nobody is connected." Any doubt → false (= someone is, so leave it alone).
  function noClients(p) {
    if (!netKnown) return false;                       // could not list sockets
    const ports = listenByPid.get(p.pid);
    if (!ports || !ports.size) return false;           // its listening port is unknown
    if (estabPids.has(p.pid)) return false;            // it holds an established socket
    for (const port of ports) if (estabPorts.has(port)) return false; // …or someone is on its port
    return true;
  }

  // Working folders of the live Claude sessions that could own one of our processes.
  // Only own-user sessions: another user's session can never own a process we may kill
  // (and we cannot read its cwd anyway, which would otherwise freeze the whole rule).
  // A session whose cwd we cannot read makes ownership UNKNOWABLE → nothing is reaped.
  const claudeCwds = [];
  let claudeCwdUnknown = false;
  for (const p of procs) {
    if (!p || !Number.isInteger(p.pid)) continue;
    if (ownUid != null && p.uid != null && p.uid !== ownUid) continue;
    if (!isClaudeSession(p.comm, p.cmdline)) continue;
    const cwd = typeof p.cwd === "string" ? p.cwd.trim() : "";
    if (cwd) claudeCwds.push(cwd);
    else claudeCwdUnknown = true;
  }

  // "The session that launched it is still around." Any doubt → true (= keep it).
  //
  // Two ways to be owned, OR'd. The parent chain alone is NOT enough: measured
  // 2026-08-10, all three dev servers on the machine were orphans by ppid because Claude
  // Code backgrounds them and the launching shell exits first — so the chain answers
  // "no owner" almost always, silently reducing the three safety conditions to two.
  // The second way is the folder: a live session sitting in the server's folder (or in a
  // folder above it — a session at <project> owns the server in <project>/web) owns it.
  // Known gap, left as is: a worktree is a SIBLING folder, not a child, so a server
  // started inside one is not matched here (connections + age still guard it).
  function ownerAlive(p) {
    if (claudeCwdUnknown) return true;                 // cannot know which folders are open
    const cwd = typeof p.cwd === "string" ? p.cwd.trim() : "";
    if (!cwd) return true;                             // cannot read the server's folder
    for (const c of claudeCwds) if (pathCovers(c, cwd)) return true;

    let cur = p;
    for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
      const ppid = cur.ppid;
      if (!Number.isInteger(ppid) || ppid <= 1) return false; // reparented to init = orphan
      const parent = byPid.get(ppid);
      if (!parent) return true;                        // cannot read the chain → assume alive
      if (isClaudeSession(parent.comm, parent.cmdline)) return true;
      cur = parent;
    }
    return true;                                       // cycle/too deep → assume alive
  }

  const oldEnough = (p) => Number.isFinite(p.ageMs) && p.ageMs >= IDLE_MIN_AGE_MS;

  const reasons = new Map(); // pid → reason ("deleted" wins: it needs no other evidence)
  const mark = (pid, reason) => { if (!reasons.has(pid)) reasons.set(pid, reason); };

  for (const p of procs) {
    if (!eligible(p)) continue;
    if (!isDevServer(p.comm, p.cmdline)) continue;
    if (isDeleted(p.cwd)) {
      reasons.set(p.pid, "deleted");
      // Also reap the orphaned launcher parent, but ONLY if it too has a deleted cwd AND
      // itself looks like a dev server or dev launcher (never a generic node daemon).
      // Intentionally NOT extended to the idle branch: an idle server's parent is left
      // alone (npm/sh exit on their own once the child dies).
      const parent = byPid.get(p.ppid);
      if (parent && eligible(parent) && isDeleted(parent.cwd) &&
          (isDevServer(parent.comm, parent.cmdline) || isDevLauncher(parent.cmdline))) {
        reasons.set(parent.pid, "deleted");
      }
    } else if (noClients(p) && !ownerAlive(p) && oldEnough(p)) {
      mark(p.pid, "idle");
    }
  }
  return [...reasons.entries()]
    .map(([pid, reason]) => ({ pid, reason }))
    .sort((a, b) => a.pid - b.pid)
    .slice(0, MAX_KILL);
}

// Same selection, pids only.
function selectReapable(procs, ownUid, opts) {
  return selectReapableDetailed(procs, ownUid, opts).map((r) => r.pid);
}

module.exports = {
  isDevServer, isDevLauncher, isDeleted, isClaudeSession, pathCovers,
  parseStat, ageMsFromStat, parseSsNet,
  selectReapable, selectReapableDetailed,
  MAX_KILL, IDLE_MIN_AGE_MS,
};
