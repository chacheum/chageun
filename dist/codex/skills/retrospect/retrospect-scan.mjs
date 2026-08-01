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

const MAX_SESSIONS = 30;
// Per-file cap (2026-07-27). Without it a single huge transcript eats the shared budget and starves the
// rest — silently. Measured on this project: 48 sessions, 134MB total, median 1MB, fat tail (23·17·16·14·9MB).
// The 23MB file was already excluded by the byte budget, then the 17MB file consumed 85% of it, so only
// 10 of 48 sessions were read and nothing in the output said so. 4MB keeps ordinary sessions (39 of 48 are
// ≤3MB) and excludes outliers. Oversized sessions are skipped WHOLE, never partially read: the detectors
// rely on session-wide state (e.g. "was this skill loaded earlier in this session"), so a truncated read
// would manufacture false gate-gap findings. Skips are reported in meta.sessionsSkipped so the caller can
// read those sessions directly — bounding coverage is fine, hiding that it was bounded is not.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Total-bytes budget, derived (2026-07-27, independent audit). It used to be a flat 20MB, which quietly
// did the deciding: on this project it admitted 19 of 48 sessions and dropped the other 29. Measured what
// that bought — parsing the whole 133.8MB corpus (27,263 records) with every detector takes 1.5s, and the
// worst case this scanner can even reach is MAX_FILE_BYTES × MAX_SESSIONS. So the flat cap was trading
// ~29 sessions of coverage for ~1.2 seconds. Deriving it from the other two caps keeps a hard ceiling on
// work (a project with thousands of transcripts still stops at 30 files × 4MB) while making sure the total
// never binds first — the real limits are "how big is one file" and "how many files", both of which are
// reported when they bite. Bounding coverage is fine; bounding it for nothing is not.
const MAX_BYTES = MAX_FILE_BYTES * MAX_SESSIONS;
// 게이트 층 전용 예산(부모 층과 분리 — 서로 굶기지 않게). 실측(2026-07-30 honclwd): 456파일 87.5MB,
// 중앙값 141KB · 최대 1.2MB. 파일이 작아 **개수 상한이 실질 바운드**이고, 바이트 상한은 한 파일이
// 비정상적으로 큰 경우를 위한 백스톱이다. 아래 '선별' 덕에 바이트는 읽기 비용만 들고 파싱 비용이 안 들어
// (실측 103MB 읽기+선별 3.9초) 상한을 넉넉히 잡는다 — 좁게 잡았더니 발견이 1/3로 줄었다(46 vs 149건).
const MAX_AGENT_FILES = 600;
const MAX_AGENT_BYTES = 128 * 1024 * 1024;
const sessionIdOf = (p) => String(p).split("/").pop().replace(/\.jsonl$/, "");

// Claude Code stores per-project transcripts under ~/.claude/projects/<encoded cwd>/, where the
// encoding replaces every non-alphanumeric char with '-' (C4). Verified: /home/<user>/projects/honclwd
// → -home-<user>-projects-honclwd. Task 0 confirms; a glob fallback (match a projects/* dir whose
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

// 상한 적용은 두 층(부모 세션·게이트)이 공유한다 — 층마다 예산은 다르지만 규칙(파일캡 우선 → 개수캡 →
// 바이트캡)은 같아야 건너뜀 사유 라벨이 층 사이에서 같은 뜻을 갖는다.
function applyCaps(files, { maxSessions, maxBytes, maxFileBytes }, skipped) {
  files.sort((a, b) => b.mtime - a.mtime);
  const out = []; let bytes = 0;
  const drop = (f, reason) => { if (skipped) skipped.push({ path: f.path, size: f.size, reason, parent: f.parent }); };
  for (const f of files) {
    // File cap is checked first so an oversized file is always labelled "file-cap", never "session-cap"
    // just because it happened to arrive past the count limit. isDue counts file-cap drops as real work,
    // so the label has to describe the file, not its position in the list.
    if (f.size > maxFileBytes) { drop(f, "file-cap"); continue; }   // one huge file must not starve the rest
    // session-count cap: keep iterating (not `break`) so the rest is recorded as skipped rather than
    // vanishing — the caller must be able to say what it did not read.
    if (out.length >= maxSessions) { drop(f, "session-cap"); continue; }
    if (bytes + f.size > maxBytes) { drop(f, "budget"); continue; } // byte cap: skip this one, keep scanning smaller ones
    out.push(f); bytes += f.size;
  }
  return out;
}

function listSessionFiles(dir, opts = {}) {
  const { sinceMtime = 0, maxSessions = MAX_SESSIONS, maxBytes = MAX_BYTES,
          maxFileBytes = MAX_FILE_BYTES, skipped = null } = opts;
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
  return applyCaps(files, { maxSessions, maxBytes, maxFileBytes }, skipped);
}

// 게이트(서브에이전트) 층: `<transcriptDir>/<sessionId>/subagents/*.jsonl`.
// **이 층은 v0.41.1까지 한 번도 읽히지 않았다.** plan-validator·pr-reviewer의 보고서 본문과 그들이 실제로
// 무엇에 막혔는지는 전부 여기 있고, 부모 세션엔 요약만 남는다. 실측(2026-07-30): honclwd 456파일 87.5MB ·
// 한 실무 프로젝트의 회고가 "44회"로 보고한 리뷰 차단이 이 층 전수로는 853건이었다(20배). 즉 이 층이 빠지면 회고가
// 축소된 숫자로 판단을 유도한다.
// 예산은 부모 층과 **분리**한다(한 층이 다른 층을 굶기지 않게). 파일이 작아서(실측 중앙값 141KB · 최대
// 1.2MB) 개수 상한이 실질 바운드이고 바이트 상한은 병리적 경우의 백스톱이다.
const AGENT_WALK_MAX_DEPTH = 4;
function walkAgentDir(sub, parent, sinceMtime, files, depth, skipped) {
  // 깊이 초과도 **사유와 함께** 남긴다 — 다른 모든 드롭이 보고되는데 이것만 조용하면, 나중에 구조가 더
  // 깊어졌을 때 v0.41.0 이전과 똑같이 한 층이 소리 없이 빠진다(pr-reviewer low).
  if (depth > AGENT_WALK_MAX_DEPTH) { if (skipped) skipped.push({ path: sub, size: 0, reason: "depth-cap" }); return; }
  let entries;
  try { entries = readdirSync(sub, { withFileTypes: true }); } catch (_) { return; }  // subagents/ 없으면 조용히 종료
  for (const e of entries) {
    const p = join(sub, e.name);
    if (e.isDirectory()) { walkAgentDir(p, parent, sinceMtime, files, depth + 1, skipped); continue; }
    if (!e.name.endsWith(".jsonl")) continue;
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      const mtime = Math.floor(st.mtimeMs / 1000);
      if (mtime <= sinceMtime) continue;
      files.push({ path: p, mtime, size: st.size, parent });
    } catch (_) { /* skip */ }
  }
}
function listAgentFiles(dir, opts = {}) {
  const { sinceMtime = 0, maxSessions = MAX_AGENT_FILES, maxBytes = MAX_AGENT_BYTES,
          maxFileBytes = MAX_FILE_BYTES, skipped = null } = opts;
  const files = [];
  let sessions;
  try { sessions = readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  for (const s of sessions) {
    if (!s.isDirectory()) continue;
    // `subagents/` 아래는 **한 겹이 아니다** — 워크플로우 실행은 `subagents/workflows/<wf_id>/agent-*.jsonl`로
    // 한 단계 더 들어간다(실측 honclwd: 1단계 239 · 워크플로우 층 217 = 전체의 48%). 처음 구현이 1단계만
    // 읽어서, 고치려던 것과 **똑같은 종류의 조용한 누락**을 다시 만들 뻔했다. 그래서 재귀로 훑는다(깊이 상한은
    // 폭주 방지용 — 실측 최대 깊이는 2).
    walkAgentDir(join(dir, s.name, "subagents"), s.name, sinceMtime, files, 0, skipped);
  }
  return applyCaps(files, { maxSessions, maxBytes, maxFileBytes }, skipped);
}

function parseSession(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch (_) { return []; }
  return parseLines(raw);
}
function parseLines(raw) {
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
// land ONLY as type:"user" entries — a PreToolUse deny as a tool_result with is_error + the CC hook-error
// prefix (`<Event>:…hook error`), or a Stop block as text starting "Stop hook feedback:". Anchor to user-role
// STRUCTURE + the hook-error PREFIX — NOT bare "차단:" phrases: a FAILED Edit on a rules file (its is_error
// tool_result echoes the file content, e.g. the REASONS map's "무인 모드 차단:") would else false-positive
// (dry-run caught exactly this). Real chageun denies all carry "PreToolUse:…hook error" via pretooluse.js. (C1)
const DENY_MARKER_RE = /(?:Pre|Post)ToolUse:[^\n]*hook error/;
// 게이트 층 선별식(파싱 전 값싼 필터). **DENY_MARKER_RE와 Stop-블록 접두의 상위집합이어야 한다** —
// 좁히면 조용한 유실이 되고, 넓으면 파싱을 조금 더 할 뿐이다(안전 방향).
const AGENT_SIGNAL_RE = /hook error|Stop hook feedback:/;
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
    // layer를 키에 넣는다 — 같은 규칙이라도 **어느 층에서 몇 번**인지가 판단을 바꾼다(부모 층 요약만 보고
    // "44회"로 보고했던 것이 게이트 층 전수로는 853건이었던 실측 사례).
    const key = `${f.type}::${f.layer || "session"}::${f.gate || f.rule || f.phrase || ""}`.slice(0, 200);
    const cur = byKey.get(key) || { type: f.type, layer: f.layer || "session", gate: f.gate, rule: f.rule, phrase: f.phrase, count: 0, sessions: [], evidence: [] };
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
  const skipped = [];
  const files = listSessionFiles(dir, { sinceMtime: (marker && marker.lastRunNewestMtime) || 0, skipped });
  const raw = [];
  let newestMtime = (marker && marker.lastRunNewestMtime) || 0;
  let realSessions = 0;
  for (const f of files) {
    newestMtime = Math.max(newestMtime, f.mtime);
    const objs = parseSession(f.path);
    if (!hasRealContent(objs)) continue; // C6: skip metadata-only hollow sessions
    realSessions++;
    const sid = sessionIdOf(f.path);
    raw.push(...detectGateGaps(objs, sid), ...detectUserCorrections(objs, sid), ...detectNearMisses(objs, sid));
  }
  // 게이트 층: near-miss만 돌린다. 나머지 두 탐지기는 이 층에서 **뜻이 달라진다** —
  // detectGateGaps는 스킬 로드를 보는데 서브에이전트는 스킬을 안 쓰고, detectUserCorrections의 "user" 역할은
  // 사람이 아니라 **메인 세션이 보낸 프롬프트**라 사람의 교정으로 오독된다. near-miss는 구조(안전훅 deny의
  // tool_result + hook-error 접두)에 걸려 있어 층이 바뀌어도 그대로 참이다(실측 확인).
  // 값싼 선별로 예산을 넓힌다: 이 층에서 돌리는 탐지기가 near-miss 하나뿐이고, 그게 찾는 두 구조는 원문에
  // 반드시 `hook error` 또는 `Stop hook feedback:` 문자열을 남긴다. 그래서 **읽되 대부분 파싱하지 않는다**.
  // 실측(한 실무 프로젝트 전량 323파일 103.5MB): 읽기+선별 3.9초 → 신호 있는 78파일만 파싱 0.2초. 선별 없이 예산
  // 24MB로 잘랐을 땐 near-miss 46건, 선별로 전량을 보니 149건이었다(3배). 선별식은 탐지기가 보는 것의
  // **상위집합**이어야 조용한 유실이 없다 — 테스트가 이 포함관계를 못박는다.
  // 🛑 마커는 **층마다 따로** 쓴다. 부모 마커를 그대로 쓰면 "여기까지 분석했다"가 게이트 층에 대해선
  // 거짓이다(이 층은 v0.41.0까지 한 번도 안 읽혔다) → 업그레이드 후 기존 프로젝트의 게이트 과거분이
  // `sinceMtime`에 걸려 **무보고로 영구 제외**된다. 이 PR이 고치려는 것과 같은 종류의 조용한 유실이라
  // 별도 필드를 둬서 첫 실행 때 상한 안에서 따라잡게 한다(pr-reviewer medium).
  const agentSkipped = [];
  const agentSince = (marker && marker.lastRunNewestAgentMtime) || 0;
  const agentFiles = listAgentFiles(dir, { sinceMtime: agentSince, skipped: agentSkipped });
  let agentScanned = 0, agentWithSignal = 0;
  let newestAgentMtime = agentSince;
  for (const f of agentFiles) {
    newestAgentMtime = Math.max(newestAgentMtime, f.mtime);
    let text;
    try { text = readFileSync(f.path, "utf8"); } catch (_) { continue; }
    agentScanned++;
    if (!AGENT_SIGNAL_RE.test(text)) continue;                  // 신호 없음 → 파싱 생략(읽긴 읽었다)
    const objs = parseLines(text);
    if (!hasRealContent(objs)) continue;
    agentWithSignal++;
    for (const nm of detectNearMisses(objs, f.parent || sessionIdOf(f.path))) raw.push({ ...nm, layer: "gate" });
  }
  // ── 상한 초과 세션의 부분 판독(v0.42) ──────────────────────────────────────
  // 지금까지 4MB 초과 세션은 **통째로** 버려졌다. 통째 스킵의 근거(탐지기가 세션 전체 상태에 기대므로
  // 잘라 읽으면 가짜 게이트 구멍을 만든다)는 gate-gap에 대해서만 참이다. **near-miss는 레코드 단위
  // 독립 판정**이라 부분 판독이 안전하고, 게이트 층이 이미 같은 패턴(읽되 신호 없으면 파싱 생략)을 쓴다.
  // 방식은 **(a) 전체 읽기 + 값싼 선별**이다 — 앞 N바이트 절단 읽기가 아니다. 절단하면 꼬리의 near-miss가
  // 유실되고, 그 파일 mtime이 마커를 전진시켜 **유실이 영구**가 된다(plan-validator F-10).
  // 돌리는 탐지기: near-miss 하나뿐. gate-gap(세션 전체 상태 의존)과 user-correction(이 층에서 뜻이
  // 흔들려 보수적 제외)은 여전히 안 돌린다.
  const partial = skipped.filter((s) => s.reason === "file-cap");
  let partialRead = 0;
  for (const f of partial) {
    let text;
    try { text = readFileSync(f.path, "utf8"); } catch (_) { continue; }
    partialRead++;
    newestMtime = Math.max(newestMtime, f.mtime);   // 부분 판독도 마커를 전진시킨다 — 안 그러면 매 회고마다 재보고
    if (!AGENT_SIGNAL_RE.test(text)) continue;      // 신호 없음 → 파싱 생략(읽긴 읽었다)
    const objs = parseLines(text);
    if (!hasRealContent(objs)) continue;
    // realSessions 에는 **안 센다** — near-miss만 본 부분 판독이라 "분석한 세션"과 뜻이 다르다.
    for (const nm of detectNearMisses(objs, sessionIdOf(f.path))) raw.push({ ...nm, layer: "session-partial" });
  }

  const drift = driftSignal(cwd); if (drift) raw.push({ ...drift, sessionId: null });
  let secrets = []; try { secrets = collectSecrets(cwd); } catch (_) {}
  const findings = maskFindings(aggregate(raw), secrets);
  // Coverage is reported unconditionally. A scan that silently read 10 of 48 sessions reads as
  // "nothing else was there", which is the failure this field exists to prevent. sessionsSkipped is
  // sorted biggest-first because that is the order a caller should read them directly in.
  // v0.42: 상한 초과 파일은 이제 **통째 스킵이 아니라 부분 판독**이다 — 사유 라벨을 그렇게 바꿔
  // 호출자가 "안 읽혔다"로 오해하지 않게 한다. 무엇을 못 봤는지는 여전히 정확히 말한다:
  // 그 파일에서는 안전훅 차단(near-miss)만 봤고 게이트 저발동·사용자 교정은 못 봤다.
  // ⚠ isDue의 가산 필터는 applyCaps가 붙이는 원래 라벨("file-cap")을 그대로 본다 — 여기 출력용
  //   라벨만 바꾼 것이라 그 필터는 안 깨진다. 나중에 applyCaps 쪽 라벨을 바꾸려면 isDue도 함께 고쳐라
  //   (안 그러면 장세션 프로젝트가 조용히 영구 NOT_DUE가 된다).
  const sessionsSkipped = skipped
    .map((s) => ({
      session: sessionIdOf(s.path),
      sizeMB: Math.round((s.size / 1048576) * 10) / 10,
      reason: s.reason === "file-cap" ? "file-cap-partial" : s.reason,
      ...(s.reason === "file-cap" ? { note: "부분 판독: 안전훅 차단(near-miss)만 봄 · 게이트 저발동·사용자 교정은 못 봄" } : {}),
    }))
    .sort((a, b) => b.sizeMB - a.sizeMB);
  return {
    findings,
    meta: {
      sessionsScanned: realSessions,
      sessionsSkipped,
      sessionsPartiallyRead: partialRead,   // v0.42: 상한 초과라 near-miss만 본 세션 수(전량 분석 아님)
      coverage: `${files.length}/${files.length + skipped.length}`,
      // 게이트 층은 **따로** 밝힌다. 한 숫자로 합치면 "4/4 다 읽음"이 부모 층만 센 것인데도 전부 읽은 것처럼
      // 읽힌다(2026-07-30 회고가 정확히 그렇게 보고됐다 — 바이트로는 44%였다).
      agentFilesScanned: agentScanned,
      agentFilesWithSignal: agentWithSignal,
      agentCoverage: `${agentFiles.length}/${agentFiles.length + agentSkipped.length}`,
      agentFilesSkipped: agentSkipped
        .map((s) => ({ file: sessionIdOf(s.path), parent: s.parent || null, sizeMB: Math.round((s.size / 1048576) * 10) / 10, reason: s.reason }))
        .sort((a, b) => b.sizeMB - a.sizeMB),
      newestMtime, newestAgentMtime, cwd,
    },
  };
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
  const skipped = [];
  const freshFiles = listSessionFiles(dir, { sinceMtime: since, skipped });
  const fresh = freshFiles.filter(f => hasRealContent(parseSession(f.path))); // C6: hollow sessions don't count
  // A session too big to scan is still a session that happened, so it must keep counting toward "a
  // retrospect is overdue". Without this, a project made of long sessions would sit at NOT_DUE forever and
  // never surface the coverage report this scanner now emits — the same silent gap, moved to the trigger.
  // Counted without parsing: a multi-MB transcript cannot be hollow, and parsing it is the exact cost the
  // per-file cap exists to avoid. budget/session-cap drops are NOT counted — with the file cap checked
  // first those are always files small enough to parse (so possibly hollow), and they reappear next run.
  // ("budget" is unreachable at the default constants, where MAX_BYTES is derived from the other two.)
  const freshCount = fresh.length + skipped.filter(s => s.reason === "file-cap").length;
  if (freshCount >= minSessions) return true;
  if (marker && marker.lastRunAt && freshCount >= 1) {
    const ageDays = (Date.parse(new Date().toISOString()) - Date.parse(marker.lastRunAt)) / 86400000;
    if (ageDays >= minDays) return true;
  }
  return false;
}

export {
  transcriptDir, resolveTranscriptDir, listSessionFiles, listAgentFiles, parseSession,
  detectGateGaps, detectUserCorrections, detectNearMisses, driftSignal,
  scan, readMarker, writeMarker, isDue,
  MAX_SESSIONS, MAX_FILE_BYTES, MAX_BYTES, // exported so the cap-ordering invariant is testable
  MAX_AGENT_FILES, MAX_AGENT_BYTES, AGENT_SIGNAL_RE,
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
