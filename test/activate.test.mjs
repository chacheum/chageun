import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "src", "hooks", "activate.js");
const RULES = readFileSync(join(ROOT, "src", "rules", "operating-rules.md"), "utf8");

// 부모 env의 무인 플래그·플러그인 루트 제거 후 케이스별 주입(격리).
// CLAUDE_PLUGIN_ROOT를 지워야 활성 차근 세션 안에서 테스트를 돌려도 설치본이 아니라
// src/(HOOK 기준 __dirname/..)의 최신 규칙을 읽는다.
const BASE = { ...process.env };
delete BASE.CHAGEUN_UNATTENDED;
delete BASE.CLAUDE_PLUGIN_ROOT;

function run(env) {
  return spawnSync(process.execPath, [HOOK], { env: { ...BASE, ...env }, encoding: "utf8" });
}

const CORE_MARK = "차근 워크플로우 활성";      // 코어 주입 머리
const APPENDIX_MARK = "무인 모드 켜는 법";      // appendix 고유 문구

test("일반 세션: 코어 규칙은 주입되고 무인 상세는 빠진다", () => {
  const r = run({});
  assert.equal(r.status, 0, "exit code 0이어야 함");
  assert.ok(r.stdout.includes(CORE_MARK), "코어 규칙 주입 누락");
  assert.ok(!r.stdout.includes(APPENDIX_MARK), "일반 세션에 무인 상세가 새어 들어옴");
});

test("무인 세션: 코어 + 무인 상세가 함께 주입된다", () => {
  const r = run({ CHAGEUN_UNATTENDED: "1" });
  assert.equal(r.status, 0, "exit code 0이어야 함");
  assert.ok(r.stdout.includes(CORE_MARK), "코어 규칙 주입 누락");
  assert.ok(r.stdout.includes(APPENDIX_MARK), "무인 세션에 무인 상세가 주입되지 않음");
});

test("규칙 본문에는 무인 상세가 없고 포인터만 있다", () => {
  assert.ok(!RULES.includes(APPENDIX_MARK), "operating-rules.md에 무인 상세가 남아 있음");
  assert.ok(RULES.includes("chageun-unattended"), "무인 진입 포인터가 코어에서 사라짐");
});
