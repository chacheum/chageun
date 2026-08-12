import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpDir } from "./support-tmpdir.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "src", "hooks", "activate.js");
const RULES = readFileSync(join(ROOT, "src", "rules", "operating-rules.md"), "utf8");
const UNATTENDED_APPENDIX = readFileSync(join(ROOT, "src", "rules", "unattended-appendix.md"), "utf8");
// 상한 상수는 **코어에서만** 읽는다. 여기서 숫자를 다시 적으면 한쪽만 올려 놓고 통과시키는 길이 생긴다.
const core = require("../src/hooks/activate-core.js");

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

// 지연로드(항목7): 코어엔 절차 포인터만 있고 이관된 살은 없다(살 재유입 회귀 방지).
test("지연로드: 코어에 절차 스킬 포인터 존재 + 이관된 살 부재", () => {
  const r = run({});
  assert.ok(r.stdout.includes("chageun:finish-check"), "finish-check 포인터 존재");
  assert.ok(r.stdout.includes("chageun:spec-gate"), "spec-gate 포인터 존재");
  assert.ok(r.stdout.includes("chageun:run-verify"), "run-verify 포인터 존재");
  assert.ok(!r.stdout.includes("3축(간결성/과설계"), "정성채점 살이 코어에 남으면 안 됨");
  assert.ok(!r.stdout.includes("검증 체크리스트로 feature-spec에 저장"), "검증체크리스트 살 부재");
});

// ── 조각 배선(v0.64.1) ────────────────────────────────────────────────────────
// 여기서 재는 것은 **훅이 실제로 stdout 으로 낸 글**이다. 함수 반환값(test/rule-pieces.test.mjs)과
// 다른 축이라 서로를 대신하지 못한다 — activate.js 가 꼬리에 한 글자만 덧붙여도 함수 축은 영영 못 본다.

test("조각 호출: 인자 4번은 멈춤 규칙만 내고 게이트 절은 안 낸다", () => {
  const r = spawnSync(process.execPath, [HOOK, "4"], { env: BASE, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.startsWith("차근 워크플로우 활성"), "표식이 첫 줄 맨 앞에 없다");
  assert.ok(r.stdout.includes("조각 4/5"), "조각 번호 표시 없음");
  assert.ok(r.stdout.includes("# Stop rules"), "담아야 할 절이 빠졌다");
  assert.ok(!r.stdout.includes("# Verification gates"), "다른 조각의 절이 새어 들어왔다");
});

test("부록 조각: 평범한 세션에서는 아무것도 안 낸다", () => {
  const r = spawnSync(process.execPath, [HOOK, "6"], { env: BASE, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "조건이 하나도 안 맞는데 부록 조각이 뭔가를 냈다");
});

test("부록 조각: 무인 세션에서는 무인 상세가 글자 하나까지 그대로 나온다", () => {
  const r = spawnSync(process.execPath, [HOOK, "6"],
    { env: { ...BASE, CHAGEUN_UNATTENDED: "1" }, encoding: "utf8" });
  assert.ok(r.stdout.includes(APPENDIX_MARK), "무인 부록이 안 나왔다");
  // 🛑 문구 하나 includes 로는 부족하다. 이 3,114자는 무인 세션의 **유일한 안전 상세**다
  //    (STOP 거는 법 · 8시간/2000번 한도 · egress 차단의 한계). 머리말을 뗀 나머지가 원문과 같은지 본다.
  const body = r.stdout.slice(r.stdout.indexOf("\n\n") + 2);
  assert.equal(body, UNATTENDED_APPENDIX,
    "무인 부록이 원문과 다르다 — 조각으로 옮기면서 안전 상세가 깎였다");
  assert.ok(r.stdout.length <= core.PIECE_MAX_CHARS,
    `부록 조각이 ${r.stdout.length}자 > ${core.PIECE_MAX_CHARS} — 무인 세션에서만 잘린다(평소 검사에 안 걸린다)`);
});

test("인자 없이 부르면 옛날처럼 전부 낸다 (설치본 배선이 옛것이어도 침묵하지 않는다)", () => {
  const r = spawnSync(process.execPath, [HOOK], { env: BASE, encoding: "utf8" });
  assert.equal(r.stdout, "차근 워크플로우 활성. 아래 운영 규칙을 이번 세션 내내 따른다:\n\n" + RULES);
});

test("조각 5개를 이어 붙이면 규칙 본문이 하나도 안 빠지고, 조각마다 상한 아래다", () => {
  const out = [1, 2, 3, 4, 5].map((n) =>
    spawnSync(process.execPath, [HOOK, String(n)], { env: BASE, encoding: "utf8" }).stdout);
  // 🛑 길이도 **여기서** 잰다. rule-pieces 는 core.assemble() 의 반환값을 재는데, 잘리는 대상은
  //    훅이 stdout 으로 내보낸 글이다. activate.js 가 꼬리에 줄바꿈 한 글자만 덧붙여도
  //    함수 쪽 검사는 그것을 영원히 못 본다 — 이 저장소가 6주 동안 못 본 사고가 정확히
  //    "재는 대상이 실제와 다름" 이었다. 함수 축과 stdout 축을 **둘 다** 갖는다.
  out.forEach((s, i) => assert.ok(s.length <= core.PIECE_MAX_CHARS,
    `조각 ${i + 1} 의 실제 훅 출력이 ${s.length}자 > ${core.PIECE_MAX_CHARS}`));
  const stripped = out.map((s) => s.slice(s.indexOf("\n\n") + 2)).join("");
  assert.equal(stripped, RULES, "훅이 실제로 낸 것을 이어 붙였더니 원본과 다르다");
});

// 🛑 설치가 깨졌을 때 **침묵하지 않는다**(pr-reviewer 1차 medium).
//    최상위 `require` 는 모듈 로드 시점에 던져서 파일 안 어떤 try/catch 도 못 잡는다. 그 자리에
//    두면 배포판에서 activate-core.js 하나가 없어질 때 훅 6개가 전부 아무 글도 안 내고,
//    "설치를 확인하세요" 안내까지 함께 사라진다 — 세션은 멀쩡히 시작되는데 규칙이 한 줄도 안 닿는다.
//    소스에서는 파일이 늘 있으니 **소스에서만 초록이고 배포판에서만 죽는다.** 그래서 파일이 없는
//    상태를 실제로 만들어 재현한다.
function brokenInstall(omit) {
  const root = tmpDir("activate-broken-");
  mkdirSync(join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, "rules"), { recursive: true });
  const files = [
    ["hooks", "activate.js"], ["hooks", "activate-core.js"], ["rules", "operating-rules.md"],
  ];
  for (const [dir, f] of files) {
    if (f === omit) continue;
    copyFileSync(join(ROOT, "src", dir, f), join(root, dir, f));
  }
  return join(root, "hooks", "activate.js");
}

const INSTALL_HELP = "차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.";

for (const omit of ["activate-core.js", "operating-rules.md"])
  test(`설치가 깨져도(${omit} 없음) 안내가 나온다 — 조각 훅이 통째로 침묵하지 않는다`, () => {
    const hook = brokenInstall(omit);
    for (const args of [[], ["1"], ["4"], ["6"]]) {
      const r = spawnSync(process.execPath, [hook, ...args], { env: BASE, encoding: "utf8" });
      assert.equal(r.status, 0, `인자 ${JSON.stringify(args)}: 훅이 0 아닌 코드로 죽었다`);
      assert.equal(r.stdout, INSTALL_HELP,
        `인자 ${JSON.stringify(args)}: 안내가 안 나왔다(stdout ${r.stdout.length}자). ` +
        "require 가 try 밖으로 나가면 이 자리가 통째로 침묵한다.");
    }
  });
