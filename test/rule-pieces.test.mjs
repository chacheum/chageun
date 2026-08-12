import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// 조각 축 검사. 훅(activate.js)과 이 검사가 **같은 함수**(activate-core.js)를 부른다.
// 검사가 자기 나름의 분해를 다시 짜면 "내가 뽑은 중간 결과를 기준 삼은 검사"가 되어
// 조용한 유실을 못 잡는다(이 저장소가 이미 데인 자리).
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = require("../src/hooks/activate-core.js");
const RULES_PATH = join(ROOT, "src", "rules", "operating-rules.md");
const RULES = readFileSync(RULES_PATH, "utf8");

test("조각 표와 본문이 두 방향으로 맞는다 — 새 절이 어느 조각에도 안 들어가면 잡는다", () => {
  const secs = core.sectionsOf(RULES);
  const keys = core.PIECES.flatMap((p) => p.keys);
  // 방향 1: 모든 절이 정확히 하나의 key 에 잡힌다
  for (const s of secs) {
    const hit = keys.filter((k) => s.heading.includes(k));
    assert.equal(hit.length, 1, `절 "${s.heading}" 를 가리키는 key 가 ${hit.length}개 (1개여야 함)`);
  }
  // 방향 2: 모든 key 가 정확히 하나의 절을 잡는다
  for (const k of keys) {
    const hit = secs.filter((s) => s.heading.includes(k));
    assert.equal(hit.length, 1, `key "${k}" 가 잡는 절이 ${hit.length}개 (1개여야 함)`);
  }
});

test("조각 1~5 를 표 순서로 이어 붙이면 원본과 글자 하나까지 같다", () => {
  const joined = core.PIECES.map((p) => core.bodyOfPiece(RULES, p.n)).join("");
  assert.equal(joined, RULES,
    "조각으로 갈랐다 붙였더니 원본과 다르다. 원인은 둘 중 하나다 — " +
    "(1) 쪼개기가 글을 먹었다(어느 조각에도 안 들어간 절이 있다), " +
    "(2) 조각 표의 순서가 파일의 절 순서와 달라졌다(절을 건너뛰어 다른 조각으로 옮겼다). " +
    "🛑 (2)라면 operating-rules.md 안의 절 순서도 함께 바꿔라. " +
    "이 검사를 무르게 고쳐서 통과시키지 마라 — 조용한 유실을 막는 마지막 자물쇠다.");
});

// 🛑 사용자 결정을 기계로 잡아 둔다. 조각 4(멈춤·검증·마무리 5,884자)와 조각 5(안전 캡슐 1,388자)를
//    합쳐도 7,718자라 8,000 상한도, 물리 천장도, 재구성 대조도 **전부 초록이다.**
//    즉 이 단언이 없으면 "캡슐은 자기 조각" 이라는 결정을 지키는 것이 사람 기억뿐이다.
test("안전 캡슐은 자기 조각 하나를 통째로 쓴다", () => {
  const holder = core.PIECES.find((p) => p.keys.some((k) => k.includes("Safety capsule")));
  assert.ok(holder, "안전 캡슐을 담은 조각이 조각 표에 없다");
  assert.equal(holder.keys.length, 1,
    `안전 캡슐 조각(${holder.n}번)에 다른 절 ${holder.keys.length - 1}개가 섞였다. ` +
    "사용자 결정: 안전 캡슐은 어느 조각에도 안 섞는다. " +
    "크기가 남는다는 이유로 합치지 마라 — 합쳐도 다른 검사는 전부 초록이라 여기서만 잡힌다.");
});
