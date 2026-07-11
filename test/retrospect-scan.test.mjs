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
