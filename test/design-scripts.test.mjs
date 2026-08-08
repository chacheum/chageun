import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./support-tmpdir.mjs";

// 찍어낼 검사기(.sh)를 실제로 실행해 동작을 검증한다.
// (golden 테스트는 파일 바이트 정합만 봐서 스크립트 런타임 버그를 못 잡음 — 이 테스트가 그 구멍을 메움.)
const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "design-system");
const VIOL = join(SKILL, "check-design-violations.sh");
const PARITY = join(SKILL, "check-token-parity.sh");
const PROFILE = join(SKILL, "check-profile.sh");
const COMPONENT_BOUNDARIES = join(SKILL, "check-component-boundaries.cjs");

function run(script, args = [], { env = {}, cwd } = {}) {
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", cwd, env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function mkproj() {
  const dir = tmpDir("ds-");
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

// 공용 컴포넌트 경계 검사기는 실제 Git snapshot을 읽는다.
function git(dir, ...args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, (result.stdout || "") + (result.stderr || ""));
  return (result.stdout || "").trim();
}

function projectFile(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function boundaryFixture() {
  const dir = tmpDir("component-boundary-");
  git(dir, "init", "--quiet");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  projectFile(dir, "docs/design-system.md", `---
component-registry-path: src/components/design-registry.json
component-roots:
  - src/components
  - components
page-patterns:
  - src/app/**/page.tsx
  - src/app/**/layout.tsx
  - app/**/page.tsx
  - app/**/layout.tsx
  - src/pages/**/*.vue
  - pages/**/*.vue
  - src/routes/**/+page.svelte
  - src/pages/**/*.astro
---
`);
  projectFile(dir, "src/components/design-registry.json", JSON.stringify({
    version: 1,
    components: {
      "user-list": {
        path: "src/components/UserList.tsx",
        kind: "composite",
        family: "user-list",
        purpose: "사용자 목록",
        variants: { default: { purpose: "기본" } },
      },
    },
    decisions: [],
  }, null, 2));
  projectFile(dir, "src/components/UserList.tsx", "// @design-component user-list\n// @design-variants default\nexport const UserList = () => <article />;\n");
  git(dir, "add", ".");
  git(dir, "commit", "--quiet", "-m", "base");
  return dir;
}

function runBoundary(dir, args = []) {
  const result = spawnSync(process.execPath, [COMPONENT_BOUNDARIES, ...args], { cwd: dir, encoding: "utf8" });
  return { code: result.status, out: (result.stdout || "") + (result.stderr || "") };
}

test("component boundaries: staged 직접 UI와 미등록 component를 차단한다", () => {
  const direct = boundaryFixture();
  projectFile(direct, "src/app/users/page.tsx", "export default () => <button>저장</button>;\n");
  git(direct, "add", "src/app/users/page.tsx");
  const directResult = runBoundary(direct);
  assert.equal(directResult.code, 1, directResult.out);
  assert.match(directResult.out, /page-direct-ui/);
  rmSync(direct, { recursive: true, force: true });

  const component = boundaryFixture();
  projectFile(component, "src/components/Unregistered.tsx", "export const Unregistered = () => <button />;\n");
  git(component, "add", "src/components/Unregistered.tsx");
  const componentResult = runBoundary(component);
  assert.equal(componentResult.code, 1, componentResult.out);
  assert.match(componentResult.out, /component-unregistered/);
  rmSync(component, { recursive: true, force: true });
});

test("component boundaries: staged 조립은 통과하고 과거 위반 증가는 막는다", () => {
  const dir = boundaryFixture();
  projectFile(dir, "src/app/users/page.tsx", "import { UserList } from '../../components/UserList'; export default () => <UserList />;\n");
  git(dir, "add", "src/app/users/page.tsx");
  const assembly = runBoundary(dir);
  assert.equal(assembly.code, 0, assembly.out);
  git(dir, "commit", "--quiet", "-m", "assembly");

  projectFile(dir, "src/app/legacy/page.tsx", "export default () => <div />;\n");
  git(dir, "add", "src/app/legacy/page.tsx");
  git(dir, "commit", "--quiet", "-m", "legacy");
  projectFile(dir, "src/app/legacy/page.tsx", "const id = data.id; export default () => <div />;\n");
  git(dir, "add", "src/app/legacy/page.tsx");
  const unchanged = runBoundary(dir);
  assert.equal(unchanged.code, 0, unchanged.out);
  projectFile(dir, "src/app/legacy/page.tsx", "export default () => <div /><div />;\n");
  git(dir, "add", "src/app/legacy/page.tsx");
  const increased = runBoundary(dir);
  assert.equal(increased.code, 1, increased.out);
  assert.match(increased.out, /page-direct-ui/);
  rmSync(dir, { recursive: true, force: true });
});

test("component boundaries: --all, --range, 설정 해제를 snapshot으로 판정한다", () => {
  const all = boundaryFixture();
  projectFile(all, "src/components/Unregistered.tsx", "export const Unregistered = () => <button />;\n");
  git(all, "add", ".");
  git(all, "commit", "--quiet", "-m", "bad component");
  const allResult = runBoundary(all, ["--all"]);
  assert.equal(allResult.code, 1, allResult.out);
  assert.match(allResult.out, /component-unregistered/);
  rmSync(all, { recursive: true, force: true });

  const range = boundaryFixture();
  const base = git(range, "rev-parse", "HEAD");
  projectFile(range, "src/app/users/page.tsx", "export default () => <button>저장</button>;\n");
  git(range, "add", ".");
  git(range, "commit", "--quiet", "-m", "bad page");
  const rangeResult = runBoundary(range, ["--range", base, "HEAD"]);
  assert.equal(rangeResult.code, 1, rangeResult.out);
  assert.match(rangeResult.out, /page-direct-ui/);
  const usage = runBoundary(range, ["--range", base]);
  assert.equal(usage.code, 2, usage.out);
  rmSync(range, { recursive: true, force: true });

  const removed = boundaryFixture();
  git(removed, "rm", "--quiet", "docs/design-system.md");
  const removedResult = runBoundary(removed);
  assert.equal(removedResult.code, 2, removedResult.out);
  assert.match(removedResult.out, /design-system/);
  rmSync(removed, { recursive: true, force: true });
});

test("component boundaries: 최종 snapshot의 source 없는 registry 항목은 모든 실행 모드에서 차단한다", () => {
  const addPending = (dir) => {
    const registryPath = join(dir, "src/components/design-registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.components["pending-card"] = {
      path: "src/components/PendingCard.tsx", kind: "composite", family: "pending-card", purpose: "새 카드",
      variants: { default: { purpose: "기본" } },
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  };

  const staged = boundaryFixture();
  addPending(staged);
  git(staged, "add", "src/components/design-registry.json");
  const stagedResult = runBoundary(staged);
  assert.equal(stagedResult.code, 2, stagedResult.out);
  assert.match(stagedResult.out, /registered-source-unavailable/);
  rmSync(staged, { recursive: true, force: true });

  const all = boundaryFixture();
  addPending(all);
  git(all, "add", ".");
  git(all, "commit", "--quiet", "-m", "pending registry");
  const allResult = runBoundary(all, ["--all"]);
  assert.equal(allResult.code, 2, allResult.out);
  assert.match(allResult.out, /registered-source-unavailable/);
  rmSync(all, { recursive: true, force: true });

  const range = boundaryFixture();
  const base = git(range, "rev-parse", "HEAD");
  addPending(range);
  git(range, "add", ".");
  git(range, "commit", "--quiet", "-m", "pending registry");
  const rangeResult = runBoundary(range, ["--range", base, "HEAD"]);
  assert.equal(rangeResult.code, 2, rangeResult.out);
  assert.match(rangeResult.out, /registered-source-unavailable/);
  rmSync(range, { recursive: true, force: true });
});

test("component boundaries: 디자인 시스템을 채택하지 않은 프로젝트는 통과한다", () => {
  const dir = tmpDir("component-boundary-none-");
  git(dir, "init", "--quiet");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  projectFile(dir, "src/app/users/page.tsx", "export default () => <button>저장</button>;\n");
  git(dir, "add", ".");
  git(dir, "commit", "--quiet", "-m", "base");
  projectFile(dir, "src/app/users/page.tsx", "export default () => <button>바꾸기</button>;\n");
  git(dir, "add", ".");
  const result = runBoundary(dir);
  assert.equal(result.code, 0, result.out);
  rmSync(dir, { recursive: true, force: true });
});

test("component boundaries: staged 새 변형은 승인 기록이 필요하고 working tree를 읽지 않는다", () => {
  const variants = boundaryFixture();
  const registryPath = join(variants, "src/components/design-registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.components["user-list"].variants.compact = { purpose: "좁은 목록" };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  git(variants, "add", "src/components/design-registry.json");
  const missingDecision = runBoundary(variants);
  assert.equal(missingDecision.code, 2, missingDecision.out);
  assert.match(missingDecision.out, /variant-decision-mismatch/);
  rmSync(variants, { recursive: true, force: true });

  const snapshot = boundaryFixture();
  projectFile(snapshot, "src/app/users/page.tsx", "import { UserList } from '../../components/UserList'; export default () => <UserList />;\n");
  git(snapshot, "add", "src/app/users/page.tsx");
  projectFile(snapshot, "src/components/design-registry.json", "not valid json");
  const snapshotResult = runBoundary(snapshot);
  assert.equal(snapshotResult.code, 0, snapshotResult.out);
  rmSync(snapshot, { recursive: true, force: true });
});

test("component boundaries: staged Vue component 조립을 snapshot source로 확인한다", () => {
  const dir = boundaryFixture();
  const registryPath = join(dir, "src/components/design-registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.components["registered-card"] = {
    path: "src/components/RegisteredCard.vue",
    kind: "composite",
    family: "registered-card",
    purpose: "등록 카드",
    variants: { default: { purpose: "기본" } },
  };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  projectFile(dir, "src/components/RegisteredCard.vue", "<!-- @design-component registered-card -->\n<!-- @design-variants default -->\n<template><article /></template>\n");
  projectFile(dir, "src/pages/users.vue", "<script setup>\nimport RegisteredCard from '../components/RegisteredCard.vue';\n</script><template><RegisteredCard /><registered-card /></template>\n");
  git(dir, "add", ".");
  const result = runBoundary(dir);
  assert.equal(result.code, 0, result.out);
  rmSync(dir, { recursive: true, force: true });
});
