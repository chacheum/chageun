import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { isDesignScanTarget, parseAllowColors, scanColors, newColors, violationsForEdit } =
  require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "design-scan-core.js"));

const tokens = (arr) => arr.map((v) => v.token);

// ── isDesignScanTarget: .sh 글롭과 동일(css/scss 제외) ──
test("isDesignScanTarget: JS/TS/JSX/Vue/Svelte/Astro만, css/scss·기타 제외", () => {
  for (const p of ["a.tsx", "b.ts", "c.jsx", "d.js", "e.vue", "f.svelte", "g.astro"]) {
    assert.equal(isDesignScanTarget(p), true, p);
  }
  for (const p of ["a.css", "b.scss", "c.md", "d.ipynb", "e.json", ""]) {
    assert.equal(isDesignScanTarget(p), false, p + " (CSS의 hex는 토큰 정의라 정상 · 비대상)");
  }
});

// ── scanColors 룰1: 팔레트 색 클래스 ──
test("scanColors 룰1: 팔레트 색 클래스 감지, 정상 토큰/텍스트는 통과", () => {
  assert.deepEqual(tokens(scanColors('className="bg-blue-500"', [])), ["bg-blue-500"]);
  assert.deepEqual(tokens(scanColors("text-red-600 hover:bg-slate-100", [])), ["text-red-600", "bg-slate-100"]);
  assert.deepEqual(tokens(scanColors("ring-offset-emerald-200", [])), ["ring-offset-emerald-200"], "ring-offset가 ring보다 우선");
  assert.deepEqual(scanColors('className="bg-primary text-foreground rounded-lg p-4"', []), [], "시맨틱 토큰·비색 유틸은 통과");
  assert.deepEqual(scanColors("const x = 1; // 평범한 코드", []), []);
});

// ── scanColors 룰2: 임의값 hex/함수 색 (3/6/8자리 + rgb 계열, 이식 정확성) ──
test("scanColors 룰2: -[#hex] 3·6·8자리 + rgb/rgba/hsl/hsla 모두 감지", () => {
  assert.deepEqual(tokens(scanColors("bg-[#fff]", [])), ["bg-[#fff"], "3자리 축약");
  assert.deepEqual(tokens(scanColors("text-[#ff0000]", [])), ["text-[#ff0000"], "6자리");
  assert.deepEqual(tokens(scanColors("bg-[#12345678]", [])), ["bg-[#12345678"], "8자리 투명색");
  assert.deepEqual(tokens(scanColors("bg-[rgb(0,0,0)]", [])), ["bg-[rgb("]);
  assert.deepEqual(tokens(scanColors("bg-[rgba(0,0,0,0.5)]", [])), ["bg-[rgba("]);
  assert.deepEqual(tokens(scanColors("text-[hsl(0,0%,0%)]", [])), ["text-[hsl("]);
  assert.deepEqual(tokens(scanColors("text-[hsla(0,0%,0%,0.5)]", [])), ["text-[hsla("]);
  assert.deepEqual(tokens(scanColors("hover:bg-[#abc]", [])), ["bg-[#abc"], "variant 접두(hover:)는 제외하고 bg부터");
});
test("scanColors 룰2 음성: 2자리 hex·비색 임의값은 안 잡음", () => {
  assert.deepEqual(scanColors("bg-[#ff]", []), [], "2자리는 규칙 밖(3자+)");
  assert.deepEqual(scanColors("w-[calc(100%-2px)]", []), [], "치수 임의값은 색 규칙 아님");
  assert.deepEqual(scanColors("grid-cols-[1fr_2fr]", []), []);
});

// ── 스캔 상한(방어): 거대한 입력은 skip(fail-open) ──
test("scanColors: 512KB 초과 입력은 스캔 skip(빈 배열) — 대칭 방어", () => {
  const huge = "bg-blue-500 " + "a".repeat(600 * 1024);
  assert.deepEqual(scanColors(huge, []), [], "상한 초과 시 fail-open");
  assert.deepEqual(tokens(scanColors("bg-blue-500 " + "a".repeat(100), [])), ["bg-blue-500"], "상한 이하는 정상 검출");
});

// ── design-lint-ignore: 그 줄만 통과 ──
test("scanColors: design-lint-ignore 주석 라인은 그 줄만 건너뜀", () => {
  const text = "bg-blue-500 // design-lint-ignore 의도된 예외\nbg-red-500";
  assert.deepEqual(tokens(scanColors(text, [])), ["bg-red-500"], "ignore 줄만 제외, 다음 줄은 잡힘");
});

// ── 허용목록(lint-allow-colors) ──
test("scanColors: allow 팔레트명은 제외(시맨틱 토큰 재사용)", () => {
  assert.deepEqual(scanColors("bg-rose-500 text-amber-600", ["rose", "amber"]), [], "허용 팔레트는 통과");
  assert.deepEqual(tokens(scanColors("bg-rose-500 bg-blue-500", ["rose"])), ["bg-blue-500"], "허용 밖은 여전히 잡힘");
});
test("parseAllowColors: front-matter에서 목록 파싱 · 없거나 플레이스홀더면 빈 배열", () => {
  assert.deepEqual(parseAllowColors("---\nname: x\nlint-allow-colors: rose, amber, sky\n---\n본문"), ["rose", "amber", "sky"]);
  assert.deepEqual(parseAllowColors("---\nname: x\nlint-allow-colors: rose  # 주석 무시\n---"), ["rose"]);
  assert.deepEqual(parseAllowColors("---\nname: x\n---"), [], "선언 없으면 빈 배열");
  assert.deepEqual(parseAllowColors("---\nlint-allow-colors: <예: rose, amber | 없으면 비움>\n---"), [], "템플릿 플레이스홀더 무시");
  assert.deepEqual(parseAllowColors("front-matter 없는 문서"), [], "front-matter 없어도 안전");
});

// ── newColors: 브라운필드-터치 오탐 방지(핵심) ──
test("newColors: old에 없던 색 토큰만 (기존 색 줄 터치는 오탐 아님)", () => {
  // 기존 bg-gray-100 줄에 여백만 추가 → 그 색은 old에도 있으니 위반 아님.
  assert.deepEqual(
    newColors('<div className="bg-gray-100">', '<div className="bg-gray-100 p-4">', []),
    [], "기존 색 줄에 유틸 추가는 안 막음(브라운필드-터치)");
  // 진짜 새 색 도입은 잡음.
  assert.deepEqual(
    tokens(newColors('<div className="bg-gray-100">', '<div className="bg-gray-100 bg-blue-500">', [])),
    ["bg-blue-500"], "새로 넣은 색만 위반");
  // old가 비어도(신규 라인) new의 색을 잡음.
  assert.deepEqual(tokens(newColors("", "bg-blue-500", [])), ["bg-blue-500"]);
});

// ── violationsForEdit: 도구별 ──
test("violationsForEdit: Edit=new\\old · MultiEdit=합집합 · Write=null(wrapper 처리)", () => {
  assert.deepEqual(tokens(violationsForEdit("Edit", { old_string: "", new_string: "bg-blue-500" }, [])), ["bg-blue-500"]);
  assert.deepEqual(violationsForEdit("Edit", { old_string: "bg-blue-500", new_string: "bg-blue-500 p-4" }, []), [], "old에 이미 있던 색은 통과");
  assert.deepEqual(
    tokens(violationsForEdit("MultiEdit", { edits: [
      { old_string: "", new_string: "bg-red-500" },
      { old_string: "", new_string: "text-[#fff]" },
    ] }, [])),
    ["bg-red-500", "text-[#fff"], "여러 edit의 위반을 합침(text-[#fff는 접두 포함)");
  assert.equal(violationsForEdit("Write", { content: "bg-blue-500" }, []), null, "Write는 null(wrapper가 파일존재로 판정)");
});
