import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 찍어낼 검사기(.sh)를 실제로 실행해 동작을 검증한다.
// (golden 테스트는 파일 바이트 정합만 봐서 스크립트 런타임 버그를 못 잡음 — 이 테스트가 그 구멍을 메움.)
const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "design-system");
const VIOL = join(SKILL, "check-design-violations.sh");
const PARITY = join(SKILL, "check-token-parity.sh");
const PROFILE = join(SKILL, "check-profile.sh");

function run(script, args = [], { env = {}, cwd } = {}) {
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", cwd, env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function mkproj() {
  const dir = mkdtempSync(join(tmpdir(), "ds-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "docs"));
  return dir;
}
function doc(dir, frontmatter) { writeFileSync(join(dir, "docs/design-system.md"), `---\n${frontmatter}\n---\n`); }
function src(dir, name, body) { writeFileSync(join(dir, "src", name), body); }

test("check-design-violations: 직접 팔레트 색 → 차단(exit 1)", () => {
  const d = mkproj(); doc(d, "name: T");
  src(d, "B.tsx", 'export const B=()=><div className="bg-blue-500"/>;');
  const r = run(VIOL, ["--all"], { env: { DESIGN_LINT_DOC: join(d, "docs/design-system.md"), DESIGN_LINT_ROOT: d } });
  assert.equal(r.code, 1, r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-design-violations: 허용목록에 색이 하나뿐이어도 그 색은 통과 (HIGH 버그 회귀)", () => {
  const d = mkproj(); doc(d, "name: T\nlint-allow-colors: rose");
  src(d, "R.tsx", 'export const R=()=><span className="text-rose-500"/>;');
  const r = run(VIOL, ["--all"], { env: { DESIGN_LINT_DOC: join(d, "docs/design-system.md"), DESIGN_LINT_ROOT: d } });
  assert.equal(r.code, 0, "단일 허용색 rose가 차단됨: " + r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-design-violations: 허용목록 '마지막' 색도 통과 (HIGH 버그 회귀)", () => {
  const d = mkproj(); doc(d, "name: T\nlint-allow-colors: amber, emerald, sky");
  src(d, "S.tsx", 'export const S=()=><span className="text-sky-500"/>;');
  const r = run(VIOL, ["--all"], { env: { DESIGN_LINT_DOC: join(d, "docs/design-system.md"), DESIGN_LINT_ROOT: d } });
  assert.equal(r.code, 0, "목록 마지막 색 sky가 차단됨: " + r.out);
  // 반대로 목록에 없는 blue는 여전히 차단
  src(d, "S2.tsx", 'export const S2=()=><span className="bg-blue-500"/>;');
  const r2 = run(VIOL, ["--all"], { env: { DESIGN_LINT_DOC: join(d, "docs/design-system.md"), DESIGN_LINT_ROOT: d } });
  assert.equal(r2.code, 1, "허용목록 밖 blue는 차단돼야: " + r2.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-design-violations: design-lint-ignore 라인은 건너뜀", () => {
  const d = mkproj(); doc(d, "name: T");
  src(d, "U.tsx", 'const url="/go-to-green-100"; // design-lint-ignore');
  const r = run(VIOL, ["--all"], { env: { DESIGN_LINT_DOC: join(d, "docs/design-system.md"), DESIGN_LINT_ROOT: d } });
  assert.equal(r.code, 0, r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-design-violations: -[#hex] 임의값 → 차단(exit 1)", () => {
  const d = mkproj(); doc(d, "name: T");
  src(d, "H.tsx", 'export const H=()=><div className="bg-[#1a2b3c]"/>;');
  const r = run(VIOL, ["--all"], { env: { DESIGN_LINT_DOC: join(d, "docs/design-system.md"), DESIGN_LINT_ROOT: d } });
  assert.equal(r.code, 1, r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-design-violations: CHAGEUN_SKIP → 우회(exit 0)", () => {
  const d = mkproj(); doc(d, "name: T");
  src(d, "B.tsx", 'export const B=()=><div className="bg-blue-500"/>;');
  const r = run(VIOL, ["--all"], { env: { DESIGN_LINT_ROOT: d, CHAGEUN_SKIP_DESIGN_LINT: "1" } });
  assert.equal(r.code, 0, r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-token-parity: css-path 미설정 → 설정 필요(exit 2, 조용한 통과 아님)", () => {
  const d = mkproj(); doc(d, "name: T");
  const r = run(PARITY, [join(d, "docs/design-system.md")]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /css-path/);
  rmSync(d, { recursive: true, force: true });
});

test("check-token-parity: 브랜드 스케일 정합 → 통과(exit 0)", () => {
  const d = mkproj();
  const css = join(d, "app.css");
  const scale = [50,100,200,300,400,500,600,700,800,900];
  writeFileSync(css, "@theme{\n" + scale.map(n => `  --color-brand-${n}: #000;`).join("\n") + "\n}\n");
  doc(d, "css-path: " + css + "\ncolors:\n" + scale.map(n => `  brand-${n}: "#000"`).join("\n"));
  const r = run(PARITY, [join(d, "docs/design-system.md")]);
  assert.equal(r.code, 0, r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-profile: 문서 없으면 크래시 말고 생략(exit 0)", () => {
  const r = run(PROFILE, ["/nonexistent/nope.md"]);
  assert.equal(r.code, 0, r.out);
  rmSync;
});

test("check-profile: 키 미선언 → 조언(비차단 exit 0) + 기본값 알림", () => {
  const d = mkproj(); doc(d, "profile:\n  dark-mode: none");
  const r = run(PROFILE, [join(d, "docs/design-system.md")]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /기본값/);
  rmSync(d, { recursive: true, force: true });
});

// ── P1 정직 회계 수정 회귀 테스트 ────────────────────────────────────────────

test("check-design-violations: 주석이 CI 실행을 사실로 단언하지 않는다(정직 회계)", () => {
  const head = readFileSync(VIOL, "utf8").split("\n").slice(0, 6).join("\n");
  assert.match(head, /물려야/, "조건형 고지가 있어야: " + head);
  assert.doesNotMatch(head, /pre-commit에서 돌린다/, "거짓 현재형 단언이 남아있음: " + head);
});

test("check-profile: 파이프→here-string으로 하이젠버그 구조적 제거(결정론 소스 가드)", () => {
  const s = readFileSync(PROFILE, "utf8");
  // 옛 파이프 패턴이 부활하면 SIGPIPE 경쟁(하이젠버그)도 부활 → 금지.
  assert.doesNotMatch(s, /printf[^\n]*\|\s*grep\s+-q/, "printf|grep -q 파이프가 남아있음(하이젠버그 재발): " + s);
  // 두 판정 지점(dark-mode 등 for 루프 · brand-hue)이 모두 here-string으로 바뀌었는지.
  const heredocs = s.match(/grep -qE[^\n]*<<<"?\$FM/g) || [];
  assert.equal(heredocs.length, 2, "here-string 판정이 2곳이어야(for 루프·brand-hue): 실제 " + heredocs.length);
});

test("check-profile: 완전 선언 프로필은 '미선언/기본값' 알림을 내지 않는다(동작 확인)", () => {
  const d = mkproj();
  doc(d, "profile:\n  dark-mode: class\n  animation: rich\n  base-font: 13px\n  radius: 8px\n  brand-hue: orange");
  const r = run(PROFILE, [join(d, "docs/design-system.md")]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /미선언|기본값/, "완전 선언인데 오탐: " + r.out);
  rmSync(d, { recursive: true, force: true });
});

test("check-token-parity: 이름만 대조라 값이 달라도 통과 — 단 그 한계를 고지한다", () => {
  const d = mkproj();
  const css = join(d, "app.css");
  const scale = [50,100,200,300,400,500,600,700,800,900];
  // CSS 값은 흰색, 문서 값은 검정 — 이름은 같고 값은 다름(이름만 대조의 한계 실증).
  writeFileSync(css, "@theme{\n" + scale.map(n => `  --color-brand-${n}: #fff;`).join("\n") + "\n}\n");
  doc(d, "css-path: " + css + "\ncolors:\n" + scale.map(n => `  brand-${n}: "#000"`).join("\n"));
  const r = run(PARITY, [join(d, "docs/design-system.md")]);
  assert.equal(r.code, 0, "이름 정합이라 통과(알려진 한계): " + r.out);
  assert.match(r.out, /이름만/, "값 드리프트 못 잡는다는 고지가 있어야: " + r.out);
  rmSync(d, { recursive: true, force: true });
});
