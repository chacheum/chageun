// src/skills/retrospect/retrospect-scan.mjs
// chageun retrospect scanner — deterministic, no LLM, no always-on logging (reads existing transcripts once).
// v1 Claude transcript format only. Values never logged/emitted raw (masked before output).
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// shared masking core (src & dist layouts both resolve this relative path)
const { collectSecrets, redact, isSecret } = require("../../hooks/secret-scan-core.js");

const MAX_SESSIONS = 30, MAX_BYTES = 20 * 1024 * 1024;

// Claude Code stores per-project transcripts under ~/.claude/projects/<encoded cwd>/, where the
// encoding replaces every non-alphanumeric char with '-' (C4). Verified: /home/mokgam/projects/honclwd
// → -home-mokgam-projects-honclwd. Task 0 confirms; a glob fallback (match a projects/* dir whose
// transcripts' cwd field == target cwd) covers dot/special-char paths — add per C4.
function transcriptDir(cwd) {
  return join(homedir(), ".claude", "projects", String(cwd).replace(/[^A-Za-z0-9]/g, "-"));
}

// C4 fallback: the encoded dir is normally correct, but an exotic path (or a `cwd` string that doesn't
// round-trip through the encoding, e.g. two distinct real paths colliding after non-alnum→'-') could miss
// it. If the encoded dir is absent, glob every sibling under ~/.claude/projects/* and read the FIRST
// .jsonl in each candidate; Claude Code stamps a top-level `cwd` field on most transcript lines (confirmed
// on real honclwd transcripts, Task-0 spike-adjacent check) — match the candidate whose transcript's `cwd`
// equals the target. Any glob/read error, or no match found anywhere, fails safe back to the encoded path.
function resolveTranscriptDir(cwd) {
  const encoded = transcriptDir(cwd);
  if (existsSync(encoded)) return encoded;
  try {
    const root = join(homedir(), ".claude", "projects");
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      let names;
      try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch (_) { continue; }
      if (!names.length) continue;
      const objs = parseSession(join(dir, names[0]));
      const match = objs.find((o) => o && typeof o === "object" && typeof o.cwd === "string" && o.cwd === cwd);
      if (match) return dir;
    }
  } catch (_) { /* fail-safe → fall back to encoded */ }
  return encoded;
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
    let o;
    try { o = JSON.parse(s); } catch (_) { continue; } // skip malformed
    // FIX 4: a bare `null`/number/string is valid JSON but not a transcript record — every downstream
    // consumer assumes an object (`o.type`, `o.message`, ...) and would crash on a literal null. Skip it
    // here so the fail-safe lives in one place instead of every caller re-guarding.
    if (o && typeof o === "object") objs.push(o);
  }
  return objs;
}

const GATES = [
  // requireScoring (FIX 1 / C3): honclwd DEVELOPS the gates, so 끝점검/완료/자가점검 wording appears
  // constantly in ordinary dev chatter → context-only matching over-counts. Mirror finish-work.js's
  // battle-tested shouldBlockSkillGap heuristic (FINISH_TEXT_RE + marks>=2 + !LIGHT_RE): only flag a
  // finish-check gap when the assistant text ALSO carries ≥2 ✅/❌ scoring marks and isn't LIGHT-labeled.
  { gate: "finish-check", skill: "chageun:finish-check", ctx: /끝\s*점검|자가점검|마무리(했|합니다|하겠)|다\s*됐|완료(했|됐|됨|입니다)|모두\s*충족/, requireScoring: true },
  { gate: "run-verify",  skill: "chageun:run-verify",  ctx: /실구동|구동\s*검증|띄워\s*(보|봤|서)|화면[^\n]{0,10}(확인|점검)/ },
  // spec-gate: context (ambiguous new-feature request) is a coarser signal — conservative slot, precision deferred.
  { gate: "spec-gate",   skill: "chageun:spec-gate",   ctx: /스펙\s*확인|한눈에[^\n]{0,10}🙋/ },
];
const SCORING_MARKS_RE = /[✅❌]/g;
const SCORING_LIGHT_RE = /LIGHT/;
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
  const scored = (text.match(SCORING_MARKS_RE) || []).length >= 2 && !SCORING_LIGHT_RE.test(text);
  const out = [];
  for (const g of GATES) {
    if (!g.ctx.test(text)) continue;
    if (g.requireScoring && !scored) continue; // FIX 1 / C3: tighten finish-check to avoid dev-chatter over-count
    if (skillLoaded(objs, g.skill)) continue;
    const m = text.match(g.ctx);
    out.push({ type: "gate-gap", gate: g.gate, sessionId, evidence: (m ? m[0] : "").slice(0, 120) });
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

// Near-miss = a chageun safety net that actually reverted a model attempt. Task-0 spike: BOTH block kinds
// land ONLY as type:"user" entries — a PreToolUse deny as a tool_result with is_error + hook-error marker,
// or a Stop block as text starting "Stop hook feedback:". Anchor to user-role STRUCTURE — assistant text,
// attachments, or bare rule phrases (which appear verbatim in this repo's own docs) would false-positive (C1).
const DENY_MARKER_RE = /PreToolUse:[^\n]*hook error|무인 모드 차단:|(?:^|[\s:`])차단:/;
function detectNearMisses(objs, sessionId) {
  const out = [];
  for (const o of objs) {
    const role = o.type || (o.message && o.message.role);
    if (role !== "user") continue;                       // real block records are user entries only
    const c = (o.message || o).content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === "tool_result" && b.is_error) { // PreToolUse deny
        const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content || "");
        if (DENY_MARKER_RE.test(t)) {
          out.push({ type: "near-miss", rule: (t.match(/차단:[^\n`]{0,40}/) || ["hook-deny"])[0].trim(), sessionId, evidence: t.slice(0, 200) });
        }
      } else if (b && b.type === "text" && /^\s*Stop hook feedback:/.test(b.text || "")) { // Stop block
        out.push({ type: "near-miss", rule: "stop-block", sessionId, evidence: (b.text || "").slice(0, 200) });
      }
    }
  }
  return out;
}
function driftSignal(cwd) {
  // Heuristic pointer only — deep map↔code comparison stays in finish-check 1-hop / monitoring.
  // Limit: directory-mtime proxy only changes on direct child add/remove; editing a file's contents
  // in place doesn't bump the dir mtime. Signal only (C6).
  const spec = join(cwd, "docs", "feature-spec.md");
  if (!existsSync(spec)) return null;
  try {
    const specM = statSync(spec).mtimeMs;
    // "recent code work" proxy: any tracked source newer than the spec by > 14 days.
    const srcDirs = ["src", "app", "lib"].map(d => join(cwd, d)).filter(existsSync);
    let newest = 0;
    for (const d of srcDirs) { try { newest = Math.max(newest, statSync(d).mtimeMs); } catch (_) {} }
    if (newest - specM > 14 * 24 * 3600 * 1000) {
      return { type: "drift", evidence: "feature-spec.md가 소스보다 14일+ 오래됨 — 드리프트 점검(끝점검 1-hop / monitoring) 권장" };
    }
  } catch (_) {}
  return null;
}

// C6: a parsed session with 0 real user/assistant text lines is "hollow" (session-shell metadata only —
// custom-title/mode/file-history-snapshot/attachment/system/last-prompt/queue-operation, Task-0 spike).
// Hollow sessions must not count toward the isDue threshold ("nothing to analyze" runs).
function hasRealContent(objs) {
  for (const o of objs) {
    const role = o.type || (o.message && o.message.role);
    if (role !== "user" && role !== "assistant") continue;
    const c = (o.message || o).content;
    if (typeof c === "string" && c.trim()) return true;
    if (Array.isArray(c) && c.some(b => b && (
      (b.type === "text" && (b.text || "").trim()) || b.type === "tool_use" || b.type === "tool_result"
    ))) return true;
  }
  return false;
}

// C2: redact() only masks THIS project's .env values. A secret pasted into chat (not in .env) would
// otherwise reach findings raw. maskTokens additionally masks any whitespace-delimited token flagged
// high-entropy by isSecret (key="" — no named-key branch, so only URL-userinfo/token-shape heuristics
// apply). Narrowed honesty: masks .env values AND high-entropy token-shaped strings — not a guarantee
// against every secret form (e.g. multi-word secrets, secrets split across tokens).
function maskTokens(text) {
  if (typeof text !== "string" || !text) return text;
  return text.split(/(\s+)/).map(tok => {
    if (!tok || /^\s+$/.test(tok)) return tok;
    return isSecret("", tok) ? "«token»" : tok;
  }).join("");
}
function maskFindings(findings, secrets) {
  return findings.map(f => {
    const g = { ...f };
    if (typeof g.evidence === "string") g.evidence = maskTokens(redact(g.evidence, secrets).text);
    if (Array.isArray(g.evidence)) g.evidence = g.evidence.map(e => maskTokens(redact(String(e), secrets).text));
    if (typeof g.phrase === "string") g.phrase = maskTokens(redact(g.phrase, secrets).text);
    // FIX 3: `rule` (near-miss detector) is content-derived too — it's sliced straight out of the raw hook
    // deny/block text (detectNearMisses), so a secret quoted in that text could land in `rule` unmasked
    // even though `evidence` was masked. Route it through the same .env + token masking.
    if (typeof g.rule === "string") g.rule = maskTokens(redact(g.rule, secrets).text);
    return g;
  });
}
function aggregate(raw) {
  const byKey = new Map();
  for (const f of raw) {
    const key = `${f.type}::${f.gate || f.rule || f.phrase || ""}`.slice(0, 200);
    const cur = byKey.get(key) || { type: f.type, gate: f.gate, rule: f.rule, phrase: f.phrase, count: 0, sessions: [], evidence: [] };
    cur.count++;
    if (f.sessionId && !cur.sessions.includes(f.sessionId)) cur.sessions.push(f.sessionId);
    if (f.evidence && cur.evidence.length < 3) cur.evidence.push(f.evidence);
    byKey.set(key, cur);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}
function scan(cwd, opts = {}) {
  const dir = opts.transcriptDirOverride || resolveTranscriptDir(cwd); // FIX 2: glob fallback (C4)
  const marker = readMarker(cwd);
  const files = listSessionFiles(dir, { sinceMtime: (marker && marker.lastRunNewestMtime) || 0 });
  const raw = [];
  let newestMtime = (marker && marker.lastRunNewestMtime) || 0;
  let realSessions = 0;
  for (const f of files) {
    newestMtime = Math.max(newestMtime, f.mtime);
    const objs = parseSession(f.path);
    if (!hasRealContent(objs)) continue; // C6: skip metadata-only hollow sessions
    realSessions++;
    const sid = f.path.split("/").pop().replace(/\.jsonl$/, "");
    raw.push(...detectGateGaps(objs, sid), ...detectUserCorrections(objs, sid), ...detectNearMisses(objs, sid));
  }
  const drift = driftSignal(cwd); if (drift) raw.push({ ...drift, sessionId: null });
  let secrets = []; try { secrets = collectSecrets(cwd); } catch (_) {}
  const findings = maskFindings(aggregate(raw), secrets);
  return { findings, meta: { sessionsScanned: realSessions, newestMtime, cwd } };
}

const MARKER = (cwd) => join(cwd, "docs", "retrospect-state.json");
function readMarker(cwd) { try { return JSON.parse(readFileSync(MARKER(cwd), "utf8")); } catch (_) { return null; } }
function writeMarker(cwd, obj) {
  // Creates docs/ if missing (recursive mkdir) so a fresh project can persist the marker on the first
  // run without requiring the caller to pre-create docs/. Any failure (permission, odd path) is caught
  // and silent — fail-safe; a missed marker write just means the next scan re-reads a bit more.
  try {
    mkdirSync(join(cwd, "docs"), { recursive: true });
    writeFileSync(MARKER(cwd), JSON.stringify(obj, null, 2));
  } catch (_) { /* fail-safe */ }
}
function isDue(cwd, opts = {}) {
  const { minSessions = 5, minDays = 1, transcriptDirOverride } = opts;
  const dir = transcriptDirOverride || resolveTranscriptDir(cwd); // FIX 2: glob fallback (C4)
  const marker = readMarker(cwd);
  const since = (marker && marker.lastRunNewestMtime) || 0;
  const freshFiles = listSessionFiles(dir, { sinceMtime: since });
  const fresh = freshFiles.filter(f => hasRealContent(parseSession(f.path))); // C6: hollow sessions don't count
  if (fresh.length >= minSessions) return true;
  if (marker && marker.lastRunAt && fresh.length >= 1) {
    const ageDays = (Date.parse(new Date().toISOString()) - Date.parse(marker.lastRunAt)) / 86400000;
    if (ageDays >= minDays) return true;
  }
  return false;
}

export {
  transcriptDir, resolveTranscriptDir, listSessionFiles, parseSession,
  detectGateGaps, detectUserCorrections, detectNearMisses, driftSignal,
  scan, readMarker, writeMarker, isDue,
};

// Note (marker docs/ dir): writeMarker creates <cwd>/docs/ if missing (recursive mkdir) then writes the
// marker; any failure is caught and silent (fail-safe — a missed marker write never blocks/crashes).
// Note (isDue determinism): new Date() is used at runtime; do NOT call it in workflow scripts, but this
// is a plain CLI/skill module so it's fine.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "--due") {
    process.stdout.write(isDue(args[1] || process.cwd()) ? "DUE" : "NOT_DUE");
  } else {
    process.stdout.write(JSON.stringify(scan(args[0] || process.cwd()), null, 2));
  }
}
