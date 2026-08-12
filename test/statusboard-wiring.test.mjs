// 보조 배선: 기존 스킬 세 곳의 상황판 문단이 실제로 박혔는지.
// ⚠ 앵커로 **그 파일에 이미 흔한 글자**를 쓰지 않는다. 새 문단에만 있는 조각으로 잡는다
//    (흔한 글자로 잡으면 문단을 통째로 지워도 초록이라 아무것도 안 잡는 검사가 된다).
// ⚠ 여기는 보조 경로다. 만드는 시점의 주 경로는 PreToolUse 훅이고 성공 기준 G 는 그쪽이 잰다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (p) => readFileSync(join(SRC, "skills", p, "SKILL.md"), "utf8");

const OLD_NAME = ["상황판", ".md"].join("");
const HONORIFIC = "사장님";

const CASES = [
  ["formats", ["status.md", "chageun:statusboard", "이 카드를 내는 자리에서 함께 만든다"], []],
  ["routing", ["status.md", "chageun:statusboard", "§5", "§1", "기계가 쓴다"], ["§2에 한 줄"]],
  ["finish-check", ["status.md", "chageun:statusboard", "새로 만들지 않는다"], []],
];

for (const [skill, want, unwanted] of CASES) {
  test(`${skill}: 상황판 문단이 있다`, () => {
    const text = read(skill);
    for (const w of want) assert.ok(text.includes(w), `${skill} 에 없음: ${w}`);
    for (const u of unwanted) assert.ok(!text.includes(u), `${skill} 에 옛 문구가 남음: ${u}`);
  });
}

test("세 파일에 옛 이름·사용자 호칭이 없다", () => {
  for (const [skill] of CASES) {
    const text = read(skill);
    assert.ok(!text.includes(OLD_NAME), `${skill} 에 옛 이름이 남음`);
    assert.ok(!text.includes(HONORIFIC), `${skill} 에 호칭이 남음`);
  }
});
