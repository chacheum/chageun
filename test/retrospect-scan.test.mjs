// test/retrospect-scan.test.mjs — retrospect-scan.mjs is ESM, so import it (do NOT createRequire a .mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptDir, resolveTranscriptDir, listSessionFiles, parseSession } from "../src/skills/retrospect/retrospect-scan.mjs";

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
  const out = listSessionFiles(dir, { sinceMtime: 0, maxSessions: 10, maxBytes: 250 });
  assert.equal(out.length, 2, "third file excluded once cumulative bytes would exceed maxBytes");
  const totalBytes = out.reduce((s, f) => s + f.size, 0);
  assert.ok(totalBytes <= 250, "total bytes respects the cap");
  assert.deepEqual(out.map(f => f.path.split("/").pop()), ["a.jsonl", "b.jsonl"], "newest-first order preserved under cap");
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
