import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P8 되돌리기 안내 앵커(삭제 회귀 바닥) — /rewind의 bash 미추적 주의가 정확히 남아 있는지.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const finishCheck = readFileSync(join(ROOT, "src", "skills", "finish-check", "SKILL.md"), "utf8");

test("P8: 되돌리기 안내 + /rewind bash 미추적 주의(false confidence 방지)", () => {
  assert.ok(finishCheck.includes("되돌리기 안내"), "되돌리기 안내 절 부재");
  assert.ok(finishCheck.includes("/rewind"), "/rewind 안내 부재");
  assert.ok(finishCheck.includes("git 대체가 아니다"), "bash 미추적 주의 부재(false confidence 위험)");
});
