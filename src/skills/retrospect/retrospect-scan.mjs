// src/skills/retrospect/retrospect-scan.mjs
// chageun retrospect scanner — deterministic, no LLM, no always-on logging (reads existing transcripts once).
// v1 Claude transcript format only. Values never logged/emitted raw (masked before output).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MAX_SESSIONS = 30, MAX_BYTES = 20 * 1024 * 1024;

// Claude Code stores per-project transcripts under ~/.claude/projects/<encoded cwd>/, where the
// encoding replaces every non-alphanumeric char with '-' (C4). Verified: /home/mokgam/projects/honclwd
// → -home-mokgam-projects-honclwd. Task 0 confirms; a glob fallback (match a projects/* dir whose
// transcripts' cwd field == target cwd) covers dot/special-char paths — add per C4.
function transcriptDir(cwd) {
  return join(homedir(), ".claude", "projects", String(cwd).replace(/[^A-Za-z0-9]/g, "-"));
}

function listSessionFiles(dir, opts = {}) {
  const { sinceMtime = 0, maxSessions = MAX_SESSIONS, maxBytes = MAX_BYTES } = opts;
  let names;
  try { names = readdirSync(dir); } catch (_) { return []; }
  const files = [];
  for (const n of names) {
    if (!n.endsWith(".jsonl")) continue;
    try {
      const st = statSync(join(dir, n));
      if (!st.isFile()) continue;
      const mtime = Math.floor(st.mtimeMs / 1000);
      if (mtime <= sinceMtime) continue;
      files.push({ path: join(dir, n), mtime, size: st.size });
    } catch (_) { /* skip */ }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = []; let bytes = 0;
  for (const f of files) {
    if (out.length >= maxSessions || bytes + f.size > maxBytes) break;
    out.push(f); bytes += f.size;
  }
  return out;
}

function parseSession(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch (_) { return []; }
  const objs = [];
  for (const ln of raw.split("\n")) {
    const s = ln.trim(); if (!s) continue;
    try { objs.push(JSON.parse(s)); } catch (_) { /* skip malformed */ }
  }
  return objs;
}

const GATES = [
  { gate: "finish-check", skill: "chageun:finish-check", ctx: /끝\s*점검|자가점검|마무리(했|합니다|하겠)|다\s*됐|완료(했|됐|됨|입니다)|모두\s*충족/ },
  { gate: "run-verify",  skill: "chageun:run-verify",  ctx: /실구동|구동\s*검증|띄워\s*(보|봤|서)|화면[^\n]{0,10}(확인|점검)/ },
  // spec-gate: context (ambiguous new-feature request) is a coarser signal — conservative slot, precision deferred.
  { gate: "spec-gate",   skill: "chageun:spec-gate",   ctx: /스펙\s*확인|한눈에[^\n]{0,10}🙋/ },
];
function assistantText(objs) {
  return objs.filter(o => (o.type === "assistant") || (o.message && o.message.role === "assistant"))
    .map(o => {
      const c = (o.message || o).content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.filter(b => b && b.type === "text").map(b => b.text || "").join("\n");
      return "";
    }).join("\n");
}
function skillLoaded(objs, skillId) {
  for (const o of objs) {
    const c = (o.message || o).content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === "tool_use" && String(b.name || "") === "Skill" &&
          String((b.input && b.input.skill) || "") === skillId) return true; // JSON-precise, exact skill id
    }
  }
  return false;
}
function detectGateGaps(objs, sessionId) {
  const text = assistantText(objs);
  const out = [];
  for (const g of GATES) {
    if (g.ctx.test(text) && !skillLoaded(objs, g.skill)) {
      const m = text.match(g.ctx);
      out.push({ type: "gate-gap", gate: g.gate, sessionId, evidence: (m ? m[0] : "").slice(0, 120) });
    }
  }
  return out;
}

const CORRECTION_RE = /(아니(야|요)?|그게\s*아니|그거\s*말고|말고|다시\s*(해|만들|봐)|하지\s*마|틀렸|왜\s*(그렇게|안)|안\s*돼|되돌려|\bno\b|\bnot\b|instead|actually,|revert|undo|that's wrong)/i;
function userText(o) {
  const c = (o.message || o).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    if (c.length && c.every(b => b && b.type === "tool_result")) return null; // tool-result-only = not a real user msg
    return c.filter(b => b && b.type === "text").map(b => b.text || "").join("\n");
  }
  return "";
}
function detectUserCorrections(objs, sessionId) {
  const out = [];
  for (let i = 1; i < objs.length; i++) {
    const o = objs[i];
    const role = o.type || (o.message && o.message.role);
    if (role !== "user") continue;
    const t = userText(o);
    if (!t) continue;
    const prevRole = objs[i - 1].type || (objs[i - 1].message && objs[i - 1].message.role);
    if (prevRole !== "assistant") continue;         // only reactions to assistant output
    if (t.length > 200) continue;                    // long = new task, not a terse correction
    if (CORRECTION_RE.test(t)) out.push({ type: "user-correction", phrase: t.slice(0, 160), sessionId, evidence: t.slice(0, 160) });
  }
  return out;
}

export { transcriptDir, listSessionFiles, parseSession, detectGateGaps, detectUserCorrections };
