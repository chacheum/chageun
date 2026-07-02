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
