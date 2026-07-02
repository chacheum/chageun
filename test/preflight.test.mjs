import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../src/scripts/preflight.mjs";

const cfg = (o) => ({ sandbox: o });
const alive = () => true, dead = () => false;

test("샌드박스 살아있고 위험 없음 → ok", () => {
  const r = evaluate(cfg({ container: "supabase_db" }), alive, {});
  assert.equal(r.ok, true);
});
test("컨테이너 죽어있음 → 거부", () => {
  const r = evaluate(cfg({ container: "supabase_db" }), dead, {});
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /샌드박스|container/.test(x)));
});
test("dbUrl이 localhost 아니면 거부", () => {
  assert.equal(evaluate(cfg({ dbUrl: "postgres://prod.example.com/db" }), alive, {}).ok, false);
  assert.equal(evaluate(cfg({ dbUrl: "postgres://localhost:5432/db" }), alive, {}).ok, true);
});
test("env에 시크릿/유료키 보이면 거부", () => {
  const r = evaluate(cfg({ container: "c" }), alive, { STRIPE_SECRET_KEY: "sk_live_x" });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /시크릿|secret|키/.test(x)));
});
test("설정 없음 → 거부(샌드박스 미정의)", () => {
  assert.equal(evaluate({}, alive, {}).ok, false);
});
test("env의 외부 DB 연결문자열(비번 포함) → 거부", () => {
  assert.equal(evaluate(cfg({ container: "c" }), alive, { DATABASE_URL: "postgresql://postgres:pw@db.prod.supabase.co:5432/postgres" }).ok, false);
  assert.equal(evaluate(cfg({ container: "c" }), alive, { REDIS_URL: "redis://:hunter2@prod-redis.example.com:6379" }).ok, false);
});
test("로컬 DB 연결문자열(비번 포함)은 통과", () => {
  assert.equal(evaluate(cfg({ container: "c" }), alive, { DATABASE_URL: "postgres://postgres:postgres@localhost:54322/postgres" }).ok, true);
});
test("GCP credentials·private_key 감지 → 거부", () => {
  assert.equal(evaluate(cfg({ container: "c" }), alive, { GOOGLE_APPLICATION_CREDENTIALS: "/x/sa.json" }).ok, false);
  assert.equal(evaluate(cfg({ container: "c" }), alive, { SA_BLOB: '{"private_key":"-----BEGIN PRIVATE KEY-----"}' }).ok, false);
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

test("런처 --check: 샌드박스 미설정이면 거부(exit 1, claude 미실행)", () => {
  const dir = mkdtempSync(join(tmpdir(), "launch-"));
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "scripts", "chageun-unattended");
  // .chageun/unattended.json 없음 → preflight 거부
  const r = spawnSync("bash", [script, "--check"], { cwd: dir, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1, "preflight 실패 시 exit 1");
});

test("런처 go: 시동 산출물(task.md/criteria.md) 없으면 거부(무인 미시작)", () => {
  const dir = mkdtempSync(join(tmpdir(), "launch-go-"));
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "scripts", "chageun-unattended");
  // preflight는 통과시키되(unattended.json 최소) task.md·criteria.md는 없음
  mkdirSync(join(dir, ".chageun"), { recursive: true });
  writeFileSync(join(dir, ".chageun", "unattended.json"), JSON.stringify({ sandbox: { dbUrl: "postgres://localhost:5432/db" } }));
  // env를 청소해서 스폰 — 실행 머신의 GITHUB_TOKEN·*_KEY 등이 preflight 시크릿 스캔에 걸려
  // false-red 나는 것 방지(이 테스트는 preflight 통과 후 '산출물 없음→거부' 분기를 봐야 함).
  const r = spawnSync("bash", [script, "go"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1, "산출물 없으면 exit 1");
  assert.match(r.stdout + r.stderr, /setup|기준/, "먼저 setup 하라는 안내");
});

test("런처 go: 옛 task/criteria가 남아도 신선 표식(setup-ready) 없으면 거부(stale 재사용 차단)", () => {
  const dir = mkdtempSync(join(tmpdir(), "launch-stale-"));
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "scripts", "chageun-unattended");
  mkdirSync(join(dir, ".chageun"), { recursive: true });
  writeFileSync(join(dir, ".chageun", "unattended.json"), JSON.stringify({ sandbox: { dbUrl: "postgres://localhost:5432/db" } }));
  // 지난 작업의 산출물이 남아있음 — 그러나 setup-ready(신선 표식)는 없음
  writeFileSync(join(dir, ".chageun", "task.md"), "old task");
  writeFileSync(join(dir, ".chageun", "criteria.md"), "old criteria");
  const r = spawnSync("bash", [script, "go"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1, "신선 표식 없으면 exit 1(옛 기준 재사용 차단)");
  assert.match(r.stdout + r.stderr, /setup/, "새로 setup 하라는 안내");
});
