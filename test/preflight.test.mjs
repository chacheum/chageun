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
