import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// P7 무인 보강의 load-bearing 앵커 — 삭제 회귀 바닥(행동 준수 증거 아님).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(ROOT, "src", "skills", "unattended-loop", "SKILL.md"), "utf8");
const appendix = readFileSync(join(ROOT, "src", "rules", "unattended-appendix.md"), "utf8");

test("(a) 적합 확인: 기계 검증 가능 과제만 무인 수용 강화", () => {
  assert.ok(skill.includes("기계로 검증 가능한 과제가 아니면"), "적합 확인 강화 문구 부재");
});

test("(b) park/FINISH 규격: 긴급도·형식 태그", () => {
  for (const tag of ["[먼저볼것]", "[보통]", "[참고]", "(예/아니오)", "(객관식", "(자유)"]) {
    assert.ok(skill.includes(tag), `FINISH 규격 태그 부재: ${tag}`);
  }
});

test("(c) egress 한계 정직 고지: 못 잡는 벡터 + OS 샌드박스 미룸", () => {
  assert.ok(appendix.includes("egress"), "egress 언급 부재");
  assert.ok(appendix.includes("GET 쿼리스트링 유출"), "미탐 벡터 고지 부재(정직 고지 불완전)");
  assert.ok(appendix.includes("OS 샌드박스 network allowlist는 이 개발 환경에서 실차단을 검증할 수 없어 미룬다"),
    "OS 샌드박스 미룸·이유 고지 부재");
});

