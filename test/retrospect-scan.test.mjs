// test/retrospect-scan.test.mjs — retrospect-scan.mjs is ESM, so import it (do NOT createRequire a .mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptDir, resolveTranscriptDir, listSessionFiles, parseSession,
         MAX_SESSIONS, MAX_FILE_BYTES, MAX_BYTES } from "../src/skills/retrospect/retrospect-scan.mjs";

test("transcriptDir: encodes cwd like Claude Code (slashes → dashes)", () => {
  const d = transcriptDir("/home/mokgam/projects/honclwd");
  assert.ok(d.endsWith("/.claude/projects/-home-mokgam-projects-honclwd"), d);
});
test("resolveTranscriptDir: encoded dir present → returns it directly (no glob needed) (FIX 2)", () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "rs-home-"));
  const targetCwd = "/home/mokgam/projects/honclwd";
  const encoded = join(tmpHome, ".claude", "projects", targetCwd.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(encoded, { recursive: true });
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    assert.equal(resolveTranscriptDir(targetCwd), encoded);
  } finally {
    process.env.HOME = prevHome;
  }
});
test("resolveTranscriptDir: encoded dir absent → globs sibling dirs, matches by transcript cwd field (FIX 2 fallback)", () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "rs-home2-"));
  const projectsRoot = join(tmpHome, ".claude", "projects");
  const targetCwd = "/home/mokgam/projects/weird.path";
  const siblingDir = join(projectsRoot, "-mismatched-encoded-name");
  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(join(siblingDir, "a.jsonl"), JSON.stringify({ type: "user", cwd: targetCwd }) + "\n");
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    assert.equal(resolveTranscriptDir(targetCwd), siblingDir);
  } finally {
    process.env.HOME = prevHome;
  }
});
test("resolveTranscriptDir: no candidate matches anywhere → falls back to the encoded path (FIX 2 fail-safe)", () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "rs-home3-"));
  const projectsRoot = join(tmpHome, ".claude", "projects");
  const targetCwd = "/home/mokgam/projects/never-matched";
  const siblingDir = join(projectsRoot, "-some-other-project");
  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(join(siblingDir, "a.jsonl"), JSON.stringify({ type: "user", cwd: "/completely/different/cwd" }) + "\n");
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const expected = join(tmpHome, ".claude", "projects", targetCwd.replace(/[^A-Za-z0-9]/g, "-"));
    assert.equal(resolveTranscriptDir(targetCwd), expected);
  } finally {
    process.env.HOME = prevHome;
  }
});
test("listSessionFiles: newest-first, sinceMtime filter, maxSessions cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-"));
  for (const [name, t] of [["a.jsonl", 1000], ["b.jsonl", 2000], ["c.jsonl", 3000]]) {
    const p = join(dir, name); writeFileSync(p, "{}\n"); utimesSync(p, t, t);
  }
  writeFileSync(join(dir, "notes.txt"), "x"); // non-jsonl ignored
  const all = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 10, maxBytes: 1e9 });
  assert.deepEqual(all.map(f => f.path.split("/").pop()), ["c.jsonl", "b.jsonl", "a.jsonl"]);
  const since = listSessionFiles(dir, { sinceMtime: 1500, maxSessions: 10, maxBytes: 1e9 });
  assert.deepEqual(since.map(f => f.path.split("/").pop()), ["c.jsonl", "b.jsonl"]);
  const capped = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 2, maxBytes: 1e9 });
  assert.equal(capped.length, 2);
});
test("listSessionFiles: missing dir → [] (fail-safe)", () => {
  assert.deepEqual(listSessionFiles("/nonexistent-xyz-123", {}), []);
});
test("listSessionFiles: maxBytes cap stops adding files once the budget is exceeded (FIX 5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-bytes-"));
  const mk = (name, bytes, t) => {
    const p = join(dir, name);
    writeFileSync(p, "x".repeat(bytes));
    utimesSync(p, t, t);
  };
  mk("a.jsonl", 100, 1000); // newest
  mk("b.jsonl", 100, 900);
  mk("c.jsonl", 100, 800); // oldest — excluded: cumulative 200+100=300 > 250
  const skipped = [];
  const out = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 10, maxBytes: 250, skipped });
  assert.equal(out.length, 2, "third file excluded once cumulative bytes would exceed maxBytes");
  assert.deepEqual(skipped.map(s => [s.path.split("/").pop(), s.reason]), [["c.jsonl", "budget"]],
    "budget drops carry the 'budget' reason — the label the report groups by");
  const totalBytes = out.reduce((s, f) => s + f.size, 0);
  assert.ok(totalBytes <= 250, "total bytes respects the cap");
  assert.deepEqual(out.map(f => f.path.split("/").pop()), ["a.jsonl", "b.jsonl"], "newest-first order preserved under cap");
});
test("caps: the total-bytes budget never binds before the per-file and session caps", () => {
  // The flat 20MB total used to do the deciding: 19 of 48 sessions read, 29 dropped, to save ~1.2s of
  // parsing (measured: 133.8MB / 27,263 records = 1.5s). The total is now derived so the two caps that
  // are actually reported when they bite ("file too big", "too many files") are the ones that decide.
  assert.ok(MAX_BYTES >= MAX_FILE_BYTES * MAX_SESSIONS,
    "a flat total-bytes cap below file-cap × session-cap silently truncates before either reported cap fires");
});
test("caps: at the exact boundary the total budget still does not fire (order + strict >)", () => {
  // The constant-level assert above is an identity once MAX_BYTES is derived, so it only catches someone
  // pinning the total back to a flat number. The property that actually matters lives in the check order
  // and the strict `>` in listSessionFiles: flipping either would push a boundary session into "budget",
  // a reason that should be unreachable at the default constants. This pins that behaviour cheaply.
  const dir = mkdtempSync(join(tmpdir(), "rs-boundary-"));
  for (let i = 0; i < 4; i++) {
    const p = join(dir, `f${i}.jsonl`); writeFileSync(p, "x".repeat(100)); utimesSync(p, 1000 + i, 1000 + i);
  }
  const skipped = [];
  const out = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 3, maxFileBytes: 100, maxBytes: 300, skipped });
  assert.equal(out.length, 3, "exactly-at-budget files are taken, not dropped");
  assert.deepEqual(skipped.map(s => s.reason), ["session-cap"],
    "the leftover is refused by the session cap — 'budget' must not fire at the boundary");
});
test("listSessionFiles: one huge file no longer starves the rest (per-file cap)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-filecap-"));
  const mk = (name, bytes, t) => {
    const p = join(dir, name); writeFileSync(p, "x".repeat(bytes)); utimesSync(p, t, t);
  };
  // Shape of the real failure: the newest transcript is huge and would eat almost the whole budget,
  // leaving nothing for the many small ones behind it.
  mk("huge.jsonl", 900, 3000);  // newest, oversized
  mk("a.jsonl", 100, 2000);
  mk("b.jsonl", 100, 1000);
  const skipped = [];
  const out = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 10, maxBytes: 1000, maxFileBytes: 200, skipped });
  assert.deepEqual(out.map(f => f.path.split("/").pop()), ["a.jsonl", "b.jsonl"],
    "small sessions still get read when a huge one is present");
  assert.deepEqual(skipped.map(s => [s.path.split("/").pop(), s.reason]), [["huge.jsonl", "file-cap"]]);
  // Without the per-file cap the same input starves the small files — this is what regressed before.
  const before = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 10, maxBytes: 1000, maxFileBytes: 1e9 });
  assert.deepEqual(before.map(f => f.path.split("/").pop()), ["huge.jsonl", "a.jsonl"]);
});
test("listSessionFiles: every drop is recorded with a reason (no silent truncation)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-skipreport-"));
  const mk = (name, bytes, t) => {
    const p = join(dir, name); writeFileSync(p, "x".repeat(bytes)); utimesSync(p, t, t);
  };
  mk("a.jsonl", 100, 4000); mk("big.jsonl", 900, 3000); mk("b.jsonl", 100, 2000); mk("c.jsonl", 100, 1000);
  const skipped = [];
  const out = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 2, maxBytes: 1000, maxFileBytes: 200, skipped });
  assert.equal(out.length, 2);
  assert.equal(out.length + skipped.length, 4, "read + skipped accounts for every candidate file");
  const reasons = Object.fromEntries(skipped.map(s => [s.path.split("/").pop(), s.reason]));
  assert.equal(reasons["big.jsonl"], "file-cap");
  assert.equal(reasons["c.jsonl"], "session-cap", "session cap keeps recording instead of breaking out");
});
test("scan: meta reports coverage and skipped sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-meta-"));
  const cwd = mkdtempSync(join(tmpdir(), "rs-meta-cwd-"));
  const line = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } }) + "\n";
  const p1 = join(dir, "small.jsonl"); writeFileSync(p1, line); utimesSync(p1, 1000, 1000);
  const p2 = join(dir, "huge.jsonl"); writeFileSync(p2, line + "x".repeat(6 * 1024 * 1024)); utimesSync(p2, 2000, 2000);
  const res = scan(cwd, { transcriptDirOverride: dir });
  assert.equal(res.meta.coverage, "1/2", "coverage names how much of the candidate set was actually read");
  assert.equal(res.meta.sessionsSkipped.length, 1);
  assert.equal(res.meta.sessionsSkipped[0].session, "huge", "skipped entry carries the session id, not the path");
  assert.equal(res.meta.sessionsSkipped[0].reason, "file-cap");
  assert.ok(res.meta.sessionsSkipped[0].sizeMB >= 6, "size is reported so the caller knows what it is opening");
});
test("parseSession: parses jsonl, skips malformed lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-"));
  const p = join(dir, "s.jsonl");
  writeFileSync(p, '{"type":"user"}\nNOT JSON\n{"type":"assistant"}\n\n');
  const objs = parseSession(p);
  assert.deepEqual(objs.map(o => o.type), ["user", "assistant"]);
});
test("parseSession: skips bare null/scalar valid-JSON lines, keeps real objects (FIX 4 fail-safe)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-null-"));
  const p = join(dir, "n.jsonl");
  writeFileSync(
    p,
    'null\n' +
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }) +
      "\n42\n\"just a string\"\n"
  );
  const objs = parseSession(p);
  assert.equal(objs.length, 1, "null/number/string valid-JSON lines are skipped, not crashed on");
  assert.equal(objs[0].type, "assistant");
});

import { detectGateGaps } from "../src/skills/retrospect/retrospect-scan.mjs";
const A = (t) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
const Skill = (id) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: id } }] } });

test("detectGateGaps: completion claim without finish-check load → gap", () => {
  const objs = [A("기능 다 됐습니다. 끝 점검하겠습니다."), A("자가점검: 성공 기준 ✅✅")];
  const gaps = detectGateGaps(objs, "sess1");
  assert.ok(gaps.some(g => g.gate === "finish-check"), "finish-check gap flagged");
});
test("detectGateGaps: finish-check loaded → no gap (JSON-precise)", () => {
  const objs = [A("다 됐습니다."), Skill("chageun:finish-check"), A("끝 점검 완료 ✅✅")];
  const gaps = detectGateGaps(objs, "sess2");
  assert.ok(!gaps.some(g => g.gate === "finish-check"), "no gap when loaded");
});
test("detectGateGaps: no completion context → no gap (avoids false positive)", () => {
  assert.deepEqual(detectGateGaps([A("작업을 시작하겠습니다.")], "s3"), []);
});
test("detectGateGaps: finish-check completion text without ≥2 ✅/❌ marks → NOT flagged (FIX 1 / C3 scoring)", () => {
  const objs = [A("기능 다 됐습니다. 끝 점검하겠습니다.")]; // 0 marks
  const gaps = detectGateGaps(objs, "s-noscore");
  assert.ok(!gaps.some(g => g.gate === "finish-check"), "no finish-check gap without ≥2 scoring marks");
});
test("detectGateGaps: finish-check text scored but labeled LIGHT → NOT flagged (FIX 1 / C3 scoring)", () => {
  const objs = [A("다 됐습니다. 끝 점검(LIGHT) 자가점검 ✅✅")];
  const gaps = detectGateGaps(objs, "s-light");
  assert.ok(!gaps.some(g => g.gate === "finish-check"), "LIGHT finish-check not flagged even with marks");
});

import { detectUserCorrections } from "../src/skills/retrospect/retrospect-scan.mjs";
const U = (t) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } });
const UResult = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });

test("detectUserCorrections: correction cue after assistant → candidate", () => {
  const objs = [A("이렇게 했습니다"), U("아니 그게 아니라 다시 해줘")];
  const c = detectUserCorrections(objs, "s1");
  assert.equal(c.length, 1);
  assert.equal(c[0].type, "user-correction");
});
test("detectUserCorrections: normal instruction (no cue) → ignored", () => {
  assert.deepEqual(detectUserCorrections([A("done"), U("이제 로그인 화면 만들어줘")], "s2"), []);
});
test("detectUserCorrections: tool-result user turns ignored", () => {
  assert.deepEqual(detectUserCorrections([A("x"), UResult()], "s3"), []);
});

import { detectNearMisses, driftSignal } from "../src/skills/retrospect/retrospect-scan.mjs";
// Real shapes (Task-0 spike, docs/…-retrospect-spike.md): BOTH hook blocks land as type:"user" entries.
const Deny = (reason) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "PreToolUse:Bash hook error: [node pretooluse.js]: " + reason }] } });
const StopBlock = (reason) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: "Stop hook feedback: " + reason }] } });

test("detectNearMisses: PreToolUse deny (user tool_result is_error) → near-miss", () => {
  const nm = detectNearMisses([A("강제 푸시 시도"), Deny("차단: `git push --force`는 되돌리기 어렵습니다")], "s1");
  assert.equal(nm.length, 1);
  assert.equal(nm[0].type, "near-miss");
});
test("detectNearMisses: Stop-block (user text 'Stop hook feedback:') → near-miss", () => {
  const nm = detectNearMisses([A("이제 구현하겠습니다"), StopBlock("직전 응답이 작업을 하겠다고 말만 하고 끝났습니다")], "s2");
  assert.equal(nm.length, 1);
});
test("detectNearMisses: FP guard — ASSISTANT text mentioning the rule is NOT a near-miss (C1)", () => {
  const objs = [A('That "Stop hook feedback" wasn\'t from you'), A("차단: 이 규칙을 설명하면…")];
  assert.deepEqual(detectNearMisses(objs, "s3"), []);
});
test("detectNearMisses: FP guard — a FAILED EDIT echoing a rules file (contains 차단: but NO hook-error prefix) is NOT a near-miss (dry-run catch)", () => {
  // A failed Edit on pretooluse-core.js: the is_error tool_result echoes the REASONS map text ("무인 모드 차단:")
  // but has no "PreToolUse:…hook error" prefix → must not be mistaken for a real deny.
  const failedEdit = { type: "user", message: { role: "user", content: [{ type: "tool_result", is_error: true, content: 'String to replace not found in file.\nString: "u-deploy": "무인 모드 차단: 배포는 금지."' }] } };
  assert.deepEqual(detectNearMisses([A("고칠게요"), failedEdit], "s5"), []);
});
test("detectNearMisses: normal turn → none", () => {
  assert.deepEqual(detectNearMisses([A("완료했습니다")], "s4"), []);
});
test("driftSignal: no feature-spec → null", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-drift-"));
  assert.equal(driftSignal(dir), null, "no feature-spec → no drift claim");
});

import { scan, readMarker, writeMarker, isDue } from "../src/skills/retrospect/retrospect-scan.mjs";
import { rmSync } from "node:fs";

function fakeProject() {
  // build a fake transcript dir the scanner will find via transcriptDir(cwd) — so use a real cwd whose
  // encoded dir we create under a temp HOME is impractical; instead test scan() against an explicit dir override.
  const cwd = mkdtempSync(join(tmpdir(), "rsproj-"));
  mkdirSync(join(cwd, ".env-holder"), { recursive: true });
  writeFileSync(join(cwd, ".env"), "API_KEY=sk-secret12345678\n");
  return cwd;
}

test("scan(dir override): aggregates by (type,key) with count + masks secret evidence", () => {
  const cwd = fakeProject();
  const sessDir = mkdtempSync(join(tmpdir(), "rssess-"));
  const line = (o) => JSON.stringify(o) + "\n";
  const asst = (t) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
  const usr = (t) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } });
  // two sessions with finish-check gaps → count 2; s2's user-correction quotes the .env secret → must be masked.
  // FIX 1/C3: finish-check now also requires ≥2 ✅/❌ marks (not LIGHT) — fixtures include scoring marks
  // so this test still exercises aggregation across 2 sessions under the new stricter gate.
  writeFileSync(join(sessDir, "s1.jsonl"), line(asst("다 됐습니다. 자가점검 ✅✅")));
  writeFileSync(join(sessDir, "s2.jsonl"), line(asst("완료했습니다. 자가점검 ✅✅")) + line(usr("아니 sk-secret12345678 이거 말고 다시 해줘")));
  const { findings } = scan(cwd, { transcriptDirOverride: sessDir });
  const gap = findings.find(f => f.type === "gate-gap" && f.gate === "finish-check");
  assert.ok(gap && gap.count === 2, "two sessions aggregated");
  assert.ok(findings.some(f => f.type === "user-correction"), "correction candidate surfaced");
  const asJson = JSON.stringify(findings);
  assert.ok(!asJson.includes("sk-secret12345678"), "secret value masked in ALL evidence (correction snippet)");
});
test("scan: also masks a high-entropy PASTED token not present in .env (C2)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rsproj-nopasted-"));
  const sessDir = mkdtempSync(join(tmpdir(), "rssess-nopasted-"));
  const line = (o) => JSON.stringify(o) + "\n";
  const asst = (t) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
  const usr = (t) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } });
  writeFileSync(join(sessDir, "s1.jsonl"), line(asst("완료했습니다")) + line(usr("아니 ghp_AbCdEfGh12345678 이거 말고 다시 해줘")));
  const { findings } = scan(cwd, { transcriptDirOverride: sessDir });
  const asJson = JSON.stringify(findings);
  assert.ok(!asJson.includes("ghp_AbCdEfGh12345678"), "pasted token-shaped secret masked even though absent from .env");
  assert.ok(findings.some(f => f.type === "user-correction"), "correction candidate still surfaced (masked, not dropped)");
});
test("isDue: a session too big to scan still counts as work done (cap must not mute the trigger)", () => {
  // Regression for the pr-reviewer medium on v0.39.0: isDue calls listSessionFiles with defaults, so the
  // new per-file cap silently applied there too. A project made of long sessions would then sit at
  // NOT_DUE forever and never surface the coverage report — the same silent gap, moved to the trigger.
  const dir = mkdtempSync(join(tmpdir(), "rs-due-big-"));
  const cwd = mkdtempSync(join(tmpdir(), "rs-due-big-cwd-"));
  const line = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } }) + "\n";
  const p = join(dir, "big.jsonl");
  writeFileSync(p, line + "x".repeat(5 * 1024 * 1024)); // over the 4MB per-file cap
  utimesSync(p, 1000, 1000);
  assert.equal(isDue(cwd, { transcriptDirOverride: dir, minSessions: 1 }), true,
    "oversized-but-real session counts toward due without being parsed");
});
test("marker + isDue: below threshold → not due; above → due", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rsmark-"));
  // lastRunAt must be recent — an old lastRunAt would trip isDue's separate age-based OR-branch
  // (>= minDays since last run AND >= 1 fresh session) regardless of minSessions, defeating this
  // test's purpose of isolating the session-count threshold behavior.
  writeMarker(cwd, { lastRunAt: new Date().toISOString(), lastRunNewestMtime: 5000 });
  assert.deepEqual(readMarker(cwd).lastRunNewestMtime, 5000);
  const sessDir = mkdtempSync(join(tmpdir(), "rsdue-"));
  // C6: isDue only counts sessions with real user/assistant text — use non-hollow fixtures here (hollow
  // case is covered separately below) so this test exercises the threshold-crossing logic, not C6 itself.
  const real = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "실제 세션 내용" }] } }) + "\n";
  for (let i = 0; i < 6; i++) { const p = join(sessDir, `x${i}.jsonl`); writeFileSync(p, real); utimesSync(p, 6000 + i, 6000 + i); }
  assert.equal(isDue(cwd, { transcriptDirOverride: sessDir, minSessions: 5 }), true);
  assert.equal(isDue(cwd, { transcriptDirOverride: sessDir, minSessions: 50 }), false);
});
test("isDue: metadata-only hollow sessions do NOT count toward the threshold (C6)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rsmark-hollow-"));
  const sessDir = mkdtempSync(join(tmpdir(), "rsdue-hollow-"));
  // 6 hollow files (only metadata types, 0 real user/assistant text lines) — must NOT trip minSessions:5.
  const hollow = JSON.stringify({ type: "system" }) + "\n" + JSON.stringify({ type: "file-history-snapshot" }) + "\n";
  for (let i = 0; i < 6; i++) { const p = join(sessDir, `h${i}.jsonl`); writeFileSync(p, hollow); utimesSync(p, 7000 + i, 7000 + i); }
  assert.equal(isDue(cwd, { transcriptDirOverride: sessDir, minSessions: 5 }), false, "hollow sessions must not trip the threshold");
});
test("scan: masks the `rule` field too, not just evidence/phrase (FIX 3)", () => {
  const cwd = fakeProject(); // .env holds API_KEY=sk-secret12345678
  const sessDir = mkdtempSync(join(tmpdir(), "rssess-rule-"));
  const line = (o) => JSON.stringify(o) + "\n";
  // the deny reason (which detectNearMisses extracts into `rule`) itself quotes the .env secret.
  writeFileSync(
    join(sessDir, "s1.jsonl"),
    line(A("강제 푸시 시도")) + line(Deny("차단: sk-secret12345678 이 값은 위험합니다"))
  );
  const { findings } = scan(cwd, { transcriptDirOverride: sessDir });
  const nearMiss = findings.find(f => f.type === "near-miss");
  assert.ok(nearMiss, "near-miss surfaced");
  assert.ok(!String(nearMiss.rule).includes("sk-secret12345678"), "secret masked from the rule field too");
  assert.ok(!JSON.stringify(findings).includes("sk-secret12345678"), "secret absent from findings JSON entirely");
});
test("scan: a session file with a bare null line does not throw and the real line still processes (FIX 4)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rsproj-nullline-"));
  const sessDir = mkdtempSync(join(tmpdir(), "rssess-nullline-"));
  const line = (o) => JSON.stringify(o) + "\n";
  const asst = (t) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
  writeFileSync(join(sessDir, "s1.jsonl"), "null\n" + line(asst("다 됐습니다. 자가점검 ✅✅")));
  assert.doesNotThrow(() => scan(cwd, { transcriptDirOverride: sessDir }));
  const { findings } = scan(cwd, { transcriptDirOverride: sessDir });
  assert.ok(findings.some(f => f.type === "gate-gap" && f.gate === "finish-check"), "the real assistant line after the null line still gets processed");
});

// C5: the finish-check trigger calls `retrospect-scan.mjs --due "$(pwd)"`, whose isDue(cwd) uses the REAL
// resolveTranscriptDir(cwd) (no transcriptDirOverride) — exercise the actual CLI subprocess against a temp
// HOME so this proves the real code path finish-check depends on, not just a unit call to isDue().
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RETROSPECT_SCRIPT = fileURLToPath(new URL("../src/skills/retrospect/retrospect-scan.mjs", import.meta.url));

function freshSessionLine(i) {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: `세션 ${i} 실제 사용자 메시지 — 회고 due 테스트용 텍스트입니다.` }] },
  }) + "\n" + JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: `세션 ${i}에 대한 실제 어시스턴트 응답입니다.` }] },
  }) + "\n";
}

test("--due CLI (C5): DUE — real subprocess, real resolveTranscriptDir(cwd) under a temp HOME", () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "rs-due-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "rs-due-cwd-"));
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const transcriptDirReal = join(tmpHome, ".claude", "projects", encoded);
  mkdirSync(transcriptDirReal, { recursive: true });
  // ≥5 fresh, non-hollow sessions (real user+assistant text, not metadata-only) — crosses the default minSessions:5 threshold.
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(transcriptDirReal, `sess${i}.jsonl`), freshSessionLine(i));
  }
  // no marker under <cwd>/docs/ → readMarker(cwd) is null → sinceMtime=0 → all 6 fresh sessions count.
  const res = spawnSync(process.execPath, [RETROSPECT_SCRIPT, "--due", cwd], {
    env: { ...process.env, HOME: tmpHome },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "DUE");
});

test("--due CLI (C5): NOT_DUE — marker already covers all fresh sessions", () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "rs-notdue-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "rs-notdue-cwd-"));
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const transcriptDirReal = join(tmpHome, ".claude", "projects", encoded);
  mkdirSync(transcriptDirReal, { recursive: true });
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(transcriptDirReal, `sess${i}.jsonl`), freshSessionLine(i));
  }
  // marker's lastRunNewestMtime set far in the future → every fresh session's mtime <= it → 0 sessions counted.
  writeMarker(cwd, { lastRunAt: new Date().toISOString(), lastRunNewestMtime: Math.floor(Date.now() / 1000) + 100000 });
  const res = spawnSync(process.execPath, [RETROSPECT_SCRIPT, "--due", cwd], {
    env: { ...process.env, HOME: tmpHome },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "NOT_DUE");
});

// 회고 9번(2026-07-30) 앵커 — 마커 파일 갱신을 "눈으로 확인"하는 절차. SKILL.md 본문을 보는
// 테스트가 없어 이 문장이 조용히 사라질 수 있었다(2026-07-20 회고가 실제로 마커를 빠뜨려 같은
// 세션 2개를 재분석했다). 회귀 바닥이지 발동 증거 아님.
test("retrospect SKILL.md에 마커 갱신 눈확인 절차 존재(회고 9번)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "retrospect", "SKILL.md");
  const s = readFileSync(p, "utf8");
  assert.ok(s.includes("retrospect-state.json"), "마커 파일 경로 부재");
  assert.ok(s.includes("눈으로 확인"), "마커 갱신 눈확인 절차 부재");
  // v0.41.2: 발견을 "내가 고칠 것 / 차근이 고쳐야 할 것"으로 나눠 적는 절 — 고칠 수 있는 사람이 달라서다.
  // 실측: relay 회고 9건이 사후에 6/3으로 갈렸고 그 3건 중 하나가 침투 경로 7개를 낳았다.
  assert.ok(s.includes("A. 내가 고칠 것") && s.includes("B. 차근이 고쳐야 할 것"), "발견 두 칸 분리 절 부재");
  // 칸 제목만 고정하면 알맹이 문장이 다이어트에 조용히 지워져도 초록이다(이 저장소 단골 표류) → 핵심 조각도 고정.
  assert.ok(s.includes("차근 결함 때문"), "B칸 회피책 표기 지시 부재 — 이게 빠지면 고아 회피책이 다시 생긴다");
});

// ── 게이트(서브에이전트) 층 수집 — v0.41.1 ───────────────────────────────────
// 이 층은 v0.41.0까지 **한 번도 읽히지 않았다**. plan-validator·pr-reviewer가 실제로 무엇에 막혔는지는
// 전부 여기 있고 부모 세션엔 요약만 남는다. 실측: dow-relay 회고가 "44회"로 보고한 리뷰 차단이 이 층
// 전수로는 853건(20배)이었다. 아래 테스트가 (1) 수집 (2) 상한 (3) 선별식의 상위집합 관계를 못박는다.
import { listAgentFiles, MAX_AGENT_FILES, MAX_AGENT_BYTES, AGENT_SIGNAL_RE } from "../src/skills/retrospect/retrospect-scan.mjs";

function mkAgentFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "rs-agent-"));
  for (const [session, name, body, size] of files) {
    const sub = join(dir, session, "subagents");
    mkdirSync(sub, { recursive: true });
    const p = join(sub, name);
    writeFileSync(p, size ? "x".repeat(size) : body);
  }
  return dir;
}

test("listAgentFiles: <dir>/<session>/subagents/*.jsonl 를 수집한다(부모 층과 별개)", () => {
  const dir = mkAgentFixture([
    ["sessA", "agent-1.jsonl", "{}\n"],
    ["sessA", "agent-2.jsonl", "{}\n"],
    ["sessB", "agent-3.jsonl", "{}\n"],
    ["sessB", "notes.txt", "not jsonl"],
  ]);
  mkdirSync(join(dir, "sessC"), { recursive: true });          // subagents/ 없는 세션 → 조용히 건너뜀
  writeFileSync(join(dir, "parent.jsonl"), "{}\n");            // 부모 층 파일은 이 수집기 대상 아님
  const got = listAgentFiles(dir).map((f) => f.path.split("/").pop()).sort();
  assert.deepEqual(got, ["agent-1.jsonl", "agent-2.jsonl", "agent-3.jsonl"]);
  assert.equal(listAgentFiles(dir).every((f) => typeof f.parent === "string"), true, "parent 세션 id가 붙어야 보고에서 묶인다");
});

test("listAgentFiles: 상한이 부모 층과 같은 순서로 적용된다(파일캡 → 개수캡)", () => {
  const dir = mkAgentFixture([
    ["s", "big.jsonl", null, 5 * 1024 * 1024],   // 4MB 초과 → file-cap
    ["s", "ok1.jsonl", "{}\n"],
    ["s", "ok2.jsonl", "{}\n"],
  ]);
  const skipped = [];
  const got = listAgentFiles(dir, { maxSessions: 1, skipped });
  assert.equal(got.length, 1);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["file-cap", "session-cap"],
    "큰 파일은 위치와 무관하게 file-cap으로 라벨돼야 한다(부모 층과 동일 규칙)");
});

test("게이트 층 예산은 부모 층과 분리돼 있고 개수 상한이 실질 바운드", () => {
  assert.ok(MAX_AGENT_FILES >= 300, "실측 456파일 프로젝트를 덮어야 한다");
  assert.ok(MAX_AGENT_BYTES >= 64 * 1024 * 1024, "좁게 잡으면 발견이 1/3로 줄었다(46 vs 149건)");
});

test("선별식은 near-miss 탐지기가 보는 것의 상위집합이다(조용한 유실 방지)", async () => {
  const { detectNearMisses, parseSession } = await import("../src/skills/retrospect/retrospect-scan.mjs");
  // 🛑 사본이 아니라 **스캐너의 원본 정규식**을 검사한다 — 사본을 두면 나중에 원본을 좁혀도 테스트가 초록이라
  // 이 PR이 두려워한 "조용한 유실"이 테스트 보호 밖에 남는다(pr-reviewer medium).
  const deny = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", is_error: true,
      content: "PreToolUse:Bash [hook] hook error: 차단: 리뷰 에이전트의 Bash는 git 읽기만 허용됩니다" }] },
  });
  const stop = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "Stop hook feedback: 증거 없는 완료 선언" }] },
  });
  const plain = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "리뷰를 계속합니다" }] } });

  for (const [label, line] of [["deny", deny], ["stop", stop]]) {
    const dir = mkAgentFixture([["s", "a.jsonl", line + "\n"]]);
    const p = listAgentFiles(dir)[0].path;
    const found = detectNearMisses(parseSession(p), "s");
    assert.ok(found.length > 0, label + ": 탐지기가 잡아야 하는 기록");
    assert.ok(AGENT_SIGNAL_RE.test(line), label + ": 탐지기가 잡는 것을 선별식이 반드시 통과시켜야 한다(상위집합)");
  }
  assert.equal(detectNearMisses(parseSession(listAgentFiles(mkAgentFixture([["s", "a.jsonl", plain + "\n"]]))[0].path), "s").length, 0);
});

// 워크플로우 층(`subagents/workflows/<wf>/agent-*.jsonl`)은 한 겹 더 들어간다 — 실측 honclwd 456개 중
// **217개(48%)가 이 층**이었고, 1단계만 읽던 첫 구현이 그만큼을 조용히 빠뜨렸다(고치려던 것과 같은 종류의 누락).
test("listAgentFiles: subagents/ 아래 중첩(workflows/<wf>/)까지 재귀로 수집한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-agent-nested-"));
  const flat = join(dir, "sessA", "subagents");
  const nested = join(dir, "sessA", "subagents", "workflows", "wf_abc123");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(flat, "agent-flat.jsonl"), "{}\n");
  writeFileSync(join(nested, "agent-wf1.jsonl"), "{}\n");
  writeFileSync(join(nested, "agent-wf2.jsonl"), "{}\n");
  const got = listAgentFiles(dir).map((f) => f.path.split("/").pop()).sort();
  assert.deepEqual(got, ["agent-flat.jsonl", "agent-wf1.jsonl", "agent-wf2.jsonl"]);
  assert.equal(listAgentFiles(dir).every((f) => f.parent === "sessA"), true, "중첩돼도 부모 세션으로 묶여야 한다");
});

// scan() 통합 — 게이트 층이 실제로 findings·meta까지 흘러가는지(층 태그·커버리지·부모 귀속).
// 단위 테스트만 있으면 배선이 끊겨도 초록이라, 엔드투엔드로 한 번 통과시킨다(pr-reviewer medium).
test("scan(): 게이트 층 near-miss가 layer:'gate'로 findings에 실리고 커버리지가 따로 보고된다", async () => {
  const { scan } = await import("../src/skills/retrospect/retrospect-scan.mjs");
  const dir = mkdtempSync(join(tmpdir(), "rs-scan-gate-"));
  const cwd = mkdtempSync(join(tmpdir(), "rs-cwd-"));           // 마커 없음 → 첫 실행(sinceMtime=0)
  writeFileSync(join(dir, "sess1.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "작업 시작" }] } }) + "\n");
  const sub = join(dir, "sess1", "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "agent-a1.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", is_error: true,
      content: "PreToolUse:Bash [hook] hook error: 차단: 리뷰 에이전트의 Bash는 git 읽기 명령만 허용됩니다" }] } }) + "\n");
  writeFileSync(join(sub, "agent-a2.jsonl"),                    // 신호 없음 → 읽되 파싱 생략
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "리뷰 계속" }] } }) + "\n");

  const r = scan(cwd, { transcriptDirOverride: dir });
  const gate = r.findings.filter((f) => f.layer === "gate");
  assert.equal(gate.length, 1, "게이트 층 발견이 findings에 실려야 한다");
  assert.equal(gate[0].type, "near-miss");
  assert.deepEqual(gate[0].sessions, ["sess1"], "중첩·서브에이전트여도 부모 세션으로 귀속돼야 한다");
  assert.equal(r.meta.agentCoverage, "2/2", "게이트 커버리지는 부모와 따로 보고");
  assert.equal(r.meta.agentFilesScanned, 2, "읽은 파일 수");
  assert.equal(r.meta.agentFilesWithSignal, 1, "신호 있어 파싱한 파일 수 — 선별이 실제로 작동했다는 증거");
  assert.ok(r.meta.newestAgentMtime > 0, "게이트 층 마커 값이 따로 나와야 다음 실행이 층별로 이어간다");
});

test("scan(): 게이트 층 마커는 부모 마커와 분리돼 업그레이드 첫 실행에 과거분을 따라잡는다", async () => {
  const { scan, writeMarker } = await import("../src/skills/retrospect/retrospect-scan.mjs");
  const dir = mkdtempSync(join(tmpdir(), "rs-scan-marker-"));
  const cwd = mkdtempSync(join(tmpdir(), "rs-cwd2-"));
  const sub = join(dir, "sessX", "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "agent-old.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", is_error: true,
      content: "PreToolUse:Bash [hook] hook error: 차단: 테스트" }] } }) + "\n");
  // 부모 마커만 있는 상태 = v0.41.0까지 회고를 돌려온 기존 프로젝트
  writeMarker(cwd, { lastRunAt: new Date().toISOString(), lastRunNewestMtime: Math.floor(Date.now() / 1000) + 3600 });
  const r = scan(cwd, { transcriptDirOverride: dir });
  assert.equal(r.meta.agentFilesScanned, 1,
    "부모 마커가 미래여도 게이트 층은 자기 필드가 없으므로 0부터 따라잡아야 한다(무보고 영구 제외 방지)");
});
