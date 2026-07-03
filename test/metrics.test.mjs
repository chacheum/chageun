import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "metrics.js");

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "metrics-"));
  const prev = process.env.CHAGEUN_METRICS_DIR;
  process.env.CHAGEUN_METRICS_DIR = dir;
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.CHAGEUN_METRICS_DIR;
    else process.env.CHAGEUN_METRICS_DIR = prev;
  }
}

test("log는 ev+fields+ts를 jsonl 한 줄로 append", () => {
  withDir((dir) => {
    const { log } = require(HOOK);
    log("gate", { sid: "s1", agent: "pr-reviewer", verdict: "APPROVE" });
    const ym = new Date().toISOString().slice(0, 7);
    const file = join(dir, ym + ".jsonl");
    assert.ok(existsSync(file), "월별 파일 생성");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.ev, "gate");
    assert.equal(row.agent, "pr-reviewer");
    assert.equal(row.verdict, "APPROVE");
    assert.equal(row.sid, "s1");
    assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("log는 두 번 부르면 두 줄 append", () => {
  withDir((dir) => {
    const { log } = require(HOOK);
    log("stop_block", { reason: "promise" });
    log("hook_block", { reason: "deploy" });
    const ym = new Date().toISOString().slice(0, 7);
    const lines = readFileSync(join(dir, ym + ".jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
  });
});

test("log는 쓸 수 없는 경로에서도 throw하지 않는다(out-of-band 불변)", () => {
  // 디렉토리 자리에 '파일'을 놓아 mkdir/append를 실패시킨다.
  const base = mkdtempSync(join(tmpdir(), "metrics-bad-"));
  const blocked = join(base, "notadir");
  writeFileSync(blocked, "i am a file");
  const prev = process.env.CHAGEUN_METRICS_DIR;
  process.env.CHAGEUN_METRICS_DIR = join(blocked, "sub"); // 파일 하위 = mkdir 실패
  try {
    const { log } = require(HOOK);
    assert.doesNotThrow(() => log("gate", { sid: "x" }));
  } finally {
    if (prev === undefined) delete process.env.CHAGEUN_METRICS_DIR;
    else process.env.CHAGEUN_METRICS_DIR = prev;
  }
});
