// chageun: stale dev-server reaper — shared pure logic (Claude SessionStart hygiene).
// A process is reaped ONLY when it is BOTH a known dev server AND its working
// directory was deleted out from under it (readlink → "… (deleted)"). The
// deleted-cwd requirement is the safety anchor. No side effects here; the hook wraps
// the real /proc scan + kill around selectReapable.
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

const MAX_KILL = 50; // backstop against a pathological mass-kill

// procs: [{ pid, ppid, uid, comm, cmdline, cwd }] (uid/ppid may be null/0 if unknown).
// ownUid: only own-user processes are eligible (null → skip the uid filter).
// opts.selfPid: never reap this pid (the hook's own process).
// Returns a sorted, de-duped, capped list of pids to SIGTERM.
function selectReapable(procs, ownUid, opts) {
  opts = opts || {};
  const selfPid = opts.selfPid;
  if (!Array.isArray(procs)) return [];

  const byPid = new Map();
  for (const p of procs) if (p && Number.isInteger(p.pid)) byPid.set(p.pid, p);

  const eligible = (p) =>
    p && Number.isInteger(p.pid) && p.pid > 1 &&
    !(selfPid && p.pid === selfPid) &&
    !(ownUid != null && p.uid != null && p.uid !== ownUid);

  const kill = new Set();
  for (const p of procs) {
    if (!eligible(p)) continue;
    if (!isDevServer(p.comm, p.cmdline)) continue;
    if (!isDeleted(p.cwd)) continue;              // safety anchor
    kill.add(p.pid);
    // Also reap the orphaned launcher parent, but ONLY if it too has a deleted cwd AND
    // itself looks like a dev server or dev launcher (never a generic node daemon).
    const parent = byPid.get(p.ppid);
    if (parent && eligible(parent) && isDeleted(parent.cwd) &&
        (isDevServer(parent.comm, parent.cmdline) || isDevLauncher(parent.cmdline))) {
      kill.add(parent.pid);
    }
  }
  return [...kill].sort((a, b) => a - b).slice(0, MAX_KILL);
}

module.exports = { isDevServer, isDevLauncher, isDeleted, selectReapable, MAX_KILL };
