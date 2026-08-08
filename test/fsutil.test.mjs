import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { copyTree, listTree, readJson, writeJson } from "../build/lib/fsutil.mjs";
import { tmpDir } from "./support-tmpdir.mjs";

test("listTree는 파일 상대경로를 정렬 반환", () => {
  const d = tmpDir("ft-");
  mkdirSync(join(d, "a"));
  writeFileSync(join(d, "a", "2.txt"), "x");
  writeFileSync(join(d, "1.txt"), "y");
  assert.deepEqual(listTree(d), ["1.txt", "a/2.txt"]);
});

test("copyTree는 내용까지 복제", () => {
  const s = tmpDir("fs-");
  const t = tmpDir("ft-");
  writeFileSync(join(s, "f.txt"), "hello");
  copyTree(s, join(t, "out"));
  assert.equal(readFileSync(join(t, "out", "f.txt"), "utf8"), "hello");
});

test("writeJson/readJson 왕복 + 2스페이스 포맷", () => {
  const d = tmpDir("js-");
  const p = join(d, "x.json");
  writeJson(p, { b: 1, a: 2 });
  assert.deepEqual(readJson(p), { b: 1, a: 2 });
  assert.match(readFileSync(p, "utf8"), /\n {2}"b": 1/);
  assert.ok(readFileSync(p, "utf8").endsWith("\n"));
});
