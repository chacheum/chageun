import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./support-tmpdir.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const { resolveRoot, listBoards, slugify, todoCount, md, inline, MAX_BYTES } =
  await import(join(SRC, "skills", "statusboard", "board-core.mjs"));

const OLD_NAME = ["상황판", ".md"].join("");   // 옛 이름 리터럴은 검사 안에서만 조립한다

function board(dir, name, text = "# board\n") {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "status.md"), text);
  return p;
}

test("resolveRoot: 보통 폴더는 부모 한 겹 · 반환은 언제나 객체", () => {
  const r = resolveRoot("/srv/work/proj", {});
  assert.deepEqual(r, { root: "/srv/work", single: false });
  assert.equal(typeof r, "object");
});

test("resolveRoot: CHAGEUN_BOARD_ROOT 가 이긴다", () => {
  assert.deepEqual(resolveRoot("/srv/work/proj", { CHAGEUN_BOARD_ROOT: "/elsewhere" }),
    { root: "/elsewhere", single: false });
});

test("resolveRoot: 홈·/home·/ 가 부모면 지금 폴더 하나만", () => {
  assert.deepEqual(resolveRoot("/home/u/proj", { HOME: "/home/u" }), { root: "/home/u/proj", single: true });
  assert.deepEqual(resolveRoot("/home/u", { HOME: "/nowhere" }), { root: "/home/u", single: true });
  assert.deepEqual(resolveRoot("/proj", { HOME: "/nowhere" }), { root: "/proj", single: true });
});

// 🛑 이 배선을 아무도 안 시험한 것이 계획 검증의 NO-GO 사유였다.
//    resolveRoot 가 옳게 돌려줘도 listBoards 가 opts 를 안 보면 안전장치가 조용히 무효가 된다.
test("끝에서 끝까지: 홈이 부모면 형제 상황판이 목록에 안 뜬다", () => {
  const home = tmpDir("home-");
  const mine = board(home, "mine");
  board(home, "sibling");
  const { root, single } = resolveRoot(mine, { HOME: home });
  const list = listBoards(root, { single });
  assert.equal(list.length, 1, "형제 폴더가 딸려 왔다");
  assert.equal(list[0].name, "mine");
});

test("listBoards: 한 겹만 본다 · 이름이 정확히 status.md 여야 한다", () => {
  const root = tmpDir("root-");
  board(root, "a");
  // 두 겹 아래
  const deep = join(root, "b", "inner");
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, "status.md"), "x");
  // 옛 이름 파일만 둔 폴더
  mkdirSync(join(root, "c"), { recursive: true });
  writeFileSync(join(root, "c", OLD_NAME), "x");
  const names = listBoards(root).map((b) => b.name);
  assert.deepEqual(names, ["a"]);
});

test("listBoards: 점으로 시작하는 폴더·심링크 폴더·심링크 파일을 건너뛴다", () => {
  const root = tmpDir("root-");
  board(root, "real");
  board(root, ".hidden");
  const target = board(root, "target");
  symlinkSync(target, join(root, "linkdir"));
  mkdirSync(join(root, "linkfile"), { recursive: true });
  symlinkSync(join(target, "status.md"), join(root, "linkfile", "status.md"));
  const names = listBoards(root).map((b) => b.name).sort();
  assert.deepEqual(names, ["real", "target"]);
});

test("listBoards: 폴더 50개 상한", () => {
  const root = tmpDir("root-");
  for (let i = 0; i < 60; i++) board(root, "p" + String(i).padStart(2, "0"));
  assert.ok(listBoards(root).length <= 50, "50개 상한이 안 걸렸다");
});

test("listBoards: 512KB 넘는 파일을 통째로 안 읽는다", () => {
  const root = tmpDir("root-");
  const p = board(root, "big", "");
  writeFileSync(join(p, "status.md"), "a".repeat(1024 * 1024));
  const [b] = listBoards(root);
  assert.equal(b.text.length, MAX_BYTES, "앞 512KB 만 읽어야 한다");
  assert.equal(b.truncated, true);
});

test("listBoards: mtime 내림차순", () => {
  const root = tmpDir("root-");
  const older = board(root, "older");
  const newer = board(root, "newer");
  utimesSync(join(older, "status.md"), new Date(1e9), new Date(1e9));
  utimesSync(join(newer, "status.md"), new Date(2e9), new Date(2e9));
  assert.deepEqual(listBoards(root).map((b) => b.name), ["newer", "older"]);
});

test("slugify: 빈칸·한글·겹침", () => {
  assert.deepEqual(slugify(["my project"]), ["my-project"]);
  assert.deepEqual(slugify(["프로젝트"]), ["board"]);
  assert.deepEqual(slugify(["프로젝트", "한글"]), ["board", "board-2"]);
  assert.deepEqual(slugify(["a b", "a-b"]), ["a-b", "a-b-2"]);
});

test("todoCount: §1 제목의 숫자만 본다", () => {
  assert.equal(todoCount("## 1. 지금 하실 것: 3건\n"), 3);
  assert.equal(todoCount("## 1. 지금 하실 것\n"), null);
  assert.equal(todoCount("## 2. 지금 뒤에서 도는 것: 5건\n"), null);
});

test("md: 스크립트가 이스케이프되고 링크 문법이 안 산다", () => {
  const html = md("<script>alert(1)</script>\n\n[글](javascript:alert(1))\n");
  assert.ok(!html.includes("<script"), "스크립트 태그가 살아 있다");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<a "), "링크가 만들어졌다");
});

test("md: 표·목록·인용·굵게·코드가 살아 있다", () => {
  const html = md([
    "| 일감 | 상태 |", "|---|---|", "| 갑 | 도는 중 |",
    "", "- 하나", "- 둘", "", "> 인용", "", "**굵게** 그리고 `코드`",
  ].join("\n"));
  for (const frag of ["<table>", "<li>하나</li>", "<blockquote>", "<strong>굵게</strong>", "<code>코드</code>"])
    assert.ok(html.includes(frag), "빠진 것: " + frag);
});

test("md: 경계 표시 네 줄은 화면에 안 나오고 사이 내용은 정상으로 그려진다", () => {
  const html = md([
    "<!-- chageun:auto:head -->", "> 머리 한 줄", "<!-- /chageun:auto:head -->",
    "", "<!-- chageun:auto -->", "## 2. 지금 뒤에서 도는 것: 1건", "",
    "| 일감 | 상태 |", "|---|---|", "| 갑 | 도는 중 |", "",
    "> 마지막 확인 2026-08-11 20:44", "<!-- /chageun:auto -->",
  ].join("\n"));
  assert.ok(!html.includes("chageun:auto"), "표시가 글자로 샌다");
  assert.ok(!html.includes("&lt;!--"), "주석이 이스케이프돼 화면에 뜬다");
  assert.ok(html.includes("<h2>2. 지금 뒤에서 도는 것: 1건</h2>"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes("머리 한 줄"));
});

test("md: 사람이 쓴 다른 주석은 그대로 남는다", () => {
  const html = md("<!-- 내 메모 -->\n");
  assert.ok(html.includes("내 메모"), "넓게 지우는 구현이면 사람 글이 사라진다");
});

// D-4: `inline` 이 백틱 코드를 " N " 모양 자리표로 뺐다가 되돌리는데, 원문에 그냥 있던
// 맨 숫자까지 그 모양과 겹쳐 코드 조각으로 뒤바뀌었다. 자리표는 원문에 나올 수 없는 모양이어야 한다.
test("inline: 코드 조각 뒤에 맨 숫자가 있으면 숫자가 그대로 남는다 (자리표 충돌)", () => {
  const html = inline("`foo` 그리고 문장 중간의 숫자 0 은 코드가 아니다");
  assert.ok(html.includes("<code>foo</code>"), "코드 조각이 사라졌다: " + html);
  assert.equal((html.match(/<code>/g) || []).length, 1, "코드 태그 개수가 1개가 아니다: " + html);
  assert.ok(html.includes("숫자 0 은"), "맨 숫자 0 이 조용히 바뀌었다: " + html);
});

// 안전의 근거는 오직 하나, esc() 가 코드 조각을 빼내기 **전에** 돈다는 순서다.
// 그 순서가 지켜지면 원문에 자리표를 흉내 낸 `<##0##>` 같은 문자열이 있어도
// esc() 가 먼저 `<`·`>` 를 이스케이프해 놓아 실제 자리표와 못 섞인다.
// 이 입력은 자리표 흉내(`<##0##>`)뿐 아니라 D-4 옛 자리표(공백+숫자+공백)와도 겹치는
// 맨 숫자(" 0 ")를 함께 담는다: 옛 판으로 되돌리면 그 맨 숫자가 진짜 코드로 뒤바뀌어
// <code> 가 2개로 늘고 "숫자 0 도"가 깨진다 - 이 단언이 순서 안전성을 실제로 잰다.
test("inline: 자리표를 흉내 낸 원문 글자는 그대로 이스케이프돼 남는다", () => {
  const html = inline("자리표 흉내 <##0##> 그리고 원래 숫자 0 도 있고 `real`");
  assert.ok(html.includes("&lt;##0##&gt;"), "흉내 낸 자리표가 글자 그대로 안 남았다: " + html);
  assert.equal((html.match(/<code>/g) || []).length, 1, "코드 태그가 정확히 1개가 아니다: " + html);
  assert.ok(html.includes("<code>real</code>"), "진짜 코드 조각이 사라졌다: " + html);
  assert.ok(html.includes("숫자 0 도"), "맨 숫자 0 이 조용히 바뀌었다: " + html);
});

test("inline: 코드 없이 맨 숫자만 있으면 코드 태그가 안 생기고 undefined 도 안 샌다", () => {
  const html = inline("코드 없이 숫자 4 만");
  assert.equal((html.match(/<code>/g) || []).length, 0, "코드 없는 문장에서 코드 태그가 생겼다: " + html);
  assert.ok(!html.includes("undefined"), "undefined 가 샌다: " + html);
  assert.ok(html.includes("코드 없이 숫자 4 만"), "숫자가 조용히 바뀌었다: " + html);
});
