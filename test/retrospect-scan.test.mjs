// test/retrospect-scan.test.mjs — retrospect-scan.mjs is ESM, so import it (do NOT createRequire a .mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptDir, listSessionFiles, parseSession } from "../src/skills/retrospect/retrospect-scan.mjs";

test("transcriptDir: encodes cwd like Claude Code (slashes → dashes)", () => {
  const d = transcriptDir("/home/mokgam/projects/honclwd");
  assert.ok(d.endsWith("/.claude/projects/-home-mokgam-projects-honclwd"), d);
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
test("parseSession: parses jsonl, skips malformed lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-"));
  const p = join(dir, "s.jsonl");
  writeFileSync(p, '{"type":"user"}\nNOT JSON\n{"type":"assistant"}\n\n');
  const objs = parseSession(p);
  assert.deepEqual(objs.map(o => o.type), ["user", "assistant"]);
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
  writeFileSync(join(sessDir, "s1.jsonl"), line(asst("다 됐습니다")));
  writeFileSync(join(sessDir, "s2.jsonl"), line(asst("완료했습니다")) + line(usr("아니 sk-secret12345678 이거 말고 다시 해줘")));
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
