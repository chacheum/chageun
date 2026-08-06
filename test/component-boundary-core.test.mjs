import { test } from "node:test";
import assert from "node:assert/strict";
import core from "../src/skills/design-system/component-boundary-core.cjs";

const {
  parseDesignConfig,
  parseRegistry,
  validateRegistryBoundary,
  pathRole,
  applyToolEdit,
  scanUi,
  validatePage,
  validateComponent,
  registryChanges,
  compareCandidates,
} = core;

const VALID_DOC = `---
name: T
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
`;

const CONFIG = parseDesignConfig(VALID_DOC);

function registry(components, decisions = []) {
  return parseRegistry(JSON.stringify({ version: 1, components, decisions }));
}

function component(path, { kind = "composite", family, purpose, variants = { default: { purpose: "기본" } } }) {
  return { path, kind, family, purpose, variants };
}

function codes(result) {
  return [...result.violations, ...result.errors].map((entry) => entry.code || entry);
}

function assertViolation(result, code) {
  assert.ok(codes(result).includes(code), `${code} 없음: ${JSON.stringify(result)}`);
}

function assertNoViolation(result) {
  assert.deepEqual(codes(result), [], JSON.stringify(result));
}

const REGISTRY = registry({
  "user-list": component("src/components/UserList.tsx", {
    family: "user-list", purpose: "사용자 목록",
  }),
  "registered-card": component("src/components/RegisteredCard.vue", {
    family: "card", purpose: "목록 카드",
  }),
});

const REGISTERED_SOURCES = {
  "src/components/UserList.tsx": "// @design-component user-list\n// @design-variants default\nexport const UserList = () => <article />;",
  "src/components/RegisteredCard.vue": "<!-- @design-component registered-card -->\n<!-- @design-variants default -->\n<template><article /></template>",
};

test("설정, 경로, 레지스트리 계약을 검증한다", () => {
  assert.equal(parseDesignConfig("---\nname: no-ui\n---").enabled, false);
  assert.equal(CONFIG.enabled, true);
  assert.throws(() => parseDesignConfig("---\ncomponent-registry-path:\n---"));
  assert.equal(pathRole("src/app/users/page.tsx", CONFIG), "page");
  assert.equal(pathRole("app/users/page.tsx", CONFIG), "page");
  assert.equal(pathRole("src/pages/users.vue", CONFIG), "page");
  assert.equal(pathRole("pages/users.vue", CONFIG), "page");
  assert.equal(pathRole("src/routes/users/+page.svelte", CONFIG), "page");
  assert.equal(pathRole("src/pages/users.astro", CONFIG), "page");
  assert.equal(pathRole("src/components/UserList.tsx", CONFIG), "component");
  assert.equal(pathRole("components/UserList.tsx", CONFIG), "component");
  assert.equal(pathRole("src/lib/users.ts", CONFIG), "other");

  assert.throws(() => parseRegistry('{"version":1,"components":[],"decisions":[]}'));
  assert.throws(() => parseRegistry('{"version":1,"components":{"card":{},"card":{}},"decisions":[]}'));
  assert.throws(() => registry({
    one: component("src/components/One.tsx", { family: "one", purpose: "one" }),
    two: component("src/components/One.tsx", { family: "two", purpose: "two" }),
  }));
  assert.throws(() => registry({
    one: component("src/components/One.tsx", { family: "one", purpose: "one" }),
    two: component("src/components/Two.tsx", { family: "one", purpose: "two" }),
  }));
  assert.throws(() => registry({ broken: { path: "../Broken.tsx", kind: "unknown", family: "", purpose: "", variants: {} } }));
  assert.throws(() => registry({ card: component("src/components/Card.tsx", { family: "card", purpose: "카드" }) }, [
    { component: "card", variant: "missing", choice: "wrong", reason: "", approvalToolUseId: 7 },
  ]));

  const outside = registry({ outside: component("src/ui/Outside.tsx", { family: "outside", purpose: "밖" }) });
  assertViolation(validateRegistryBoundary({ config: CONFIG, registry: outside }), "registry-path-outside-root");
});

test("새 변형은 정확히 하나의 승인 기록과 연결된다", () => {
  const before = registry({ modal: component("src/components/Modal.tsx", {
    kind: "primitive", family: "modal", purpose: "창", variants: { md: { purpose: "기본" } },
  }) });
  const after = registry({ modal: component("src/components/Modal.tsx", {
    kind: "primitive", family: "modal", purpose: "창", variants: {
      md: { purpose: "기본" }, side: { purpose: "옆 패널" },
    },
  }) }, [{
    component: "modal", variant: "side", choice: "new-variant", reason: "열리는 방향이 다름", approvalToolUseId: "toolu_123",
  }]);
  assert.deepEqual(registryChanges(before, after).errors, []);
  assert.deepEqual(registryChanges(before, after).addedVariants, [{ component: "modal", variant: "side" }]);

  const missing = registry({ modal: component("src/components/Modal.tsx", {
    kind: "primitive", family: "modal", purpose: "창", variants: { md: { purpose: "기본" }, side: { purpose: "옆 패널" } },
  }) });
  assert.ok(registryChanges(before, missing).errors.length > 0);

  const duplicate = registry({ modal: component("src/components/Modal.tsx", {
    kind: "primitive", family: "modal", purpose: "창", variants: { md: { purpose: "기본" }, side: { purpose: "옆 패널" } },
  }) }, [
    { component: "modal", variant: "side", choice: "new-variant", reason: "다름", approvalToolUseId: "toolu_1" },
    { component: "modal", variant: "side", choice: "new-variant", reason: "다름", approvalToolUseId: "toolu_2" },
  ]);
  assert.ok(registryChanges(before, duplicate).errors.length > 0);
});

test("UI 스캔은 대표 문법만 판정하고 같은 이름의 로컬 함수는 건너뛴다", () => {
  assert.deepEqual(scanUi("export default () => <UserList />", "page.tsx").nativeTags, []);
  assert.deepEqual(scanUi("export default () => <section />", "page.tsx").nativeTags, ["section"]);
  assert.deepEqual(scanUi("React.createElement('button')", "page.tsx").nativeTags, ["button"]);
  assert.deepEqual(scanUi("import {createElement as el} from 'react'; el('form')", "page.tsx").nativeTags, ["form"]);
  assert.deepEqual(scanUi("import {h as vh} from 'vue'; vh('input')", "page.vue").nativeTags, ["input"]);
  assert.deepEqual(scanUi("import {createElement} from 'react'; const renderTag = createElement; renderTag('button')", "page.tsx").nativeTags, ["button"]);
  assert.deepEqual(scanUi("import {h} from 'vue'; const renderTag = h; renderTag('button')", "page.vue").nativeTags, ["button"]);
  assert.deepEqual(scanUi("const h = helper; const renderTag = h; renderTag('button')", "page.tsx").nativeTags, []);
  assert.deepEqual(scanUi("const h = helper; h('button')", "page.tsx").nativeTags, []);
  assert.deepEqual(scanUi("// <button>\nconst label = '<button>';", "page.tsx").nativeTags, []);
  assert.deepEqual(scanUi(`
<script>
import { h } from "vue";
const render = () => h("button", { class: "save" });
</script>
<template><UserList /></template>
<style>.save { color: red; } /* <button> */</style>
`, "page.vue").nativeTags, ["button"]);
  for (const [file, source] of [
    ["page.vue", "<template><!-- <button>설명</button> --><UserList /></template>"],
    ["page.svelte", "<!-- <button>설명</button> --><UserList />"],
    ["page.astro", "---\n---\n<!-- <button>설명</button> --><UserList />"],
  ]) assert.deepEqual(scanUi(source, file).nativeTags, [], `${file} HTML 주석은 UI가 아니다`);
});

test("페이지는 등록 component 조립만 허용하고 root layout shell은 제한적으로 허용한다", () => {
  assertViolation(validatePage({
    file: "src/app/users/page.tsx", before: null, after: "export default () => <button>저장</button>",
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-direct-ui");
  assertViolation(validatePage({
    file: "app/users/page.tsx", before: null, after: "export default () => <button>저장</button>",
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-direct-ui");
  assertNoViolation(validatePage({
    file: "src/app/layout.tsx", before: null,
    after: "export default function RootLayout({ children }) { return <html lang='ko'><body>{children}</body></html>; }",
    config: CONFIG, registry: REGISTRY, mode: "full",
  }));
  assertViolation(validatePage({
    file: "app/layout.tsx", before: null,
    after: "export default function RootLayout({ children }) { return <html><body><div>{children}</div></body></html>; }",
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-direct-ui");
  assertNoViolation(validatePage({
    file: "src/app/users/page.tsx", before: null,
    after: "import {UserList} from '../../components/UserList'; export default () => <UserList />",
    config: CONFIG, registry: REGISTRY, knownSources: REGISTERED_SOURCES, mode: "full",
  }));
  assertViolation(validatePage({
    file: "src/app/users/page.tsx", before: null,
    after: "import {UserList} from '../../components/UserList'; export default () => <UserList />",
    config: CONFIG, registry: REGISTRY, knownSources: {
      "src/components/UserList.tsx": "// @design-component another\n// @design-variants default",
    }, mode: "full",
  }), "component-marker-mismatch");
  assertViolation(validatePage({
    file: "src/app/users/page.tsx", before: null,
    after: "import {QuickPanel} from '../../features/QuickPanel'; export default () => <QuickPanel />",
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-unregistered-component");
  assertViolation(validatePage({
    file: "src/app/users/page.tsx", before: null,
    after: "const QuickPanel = () => <button />; export default () => <QuickPanel />",
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-local-component");
});

test("Vue template과 점진 적용을 분리해서 처리한다", () => {
  assertNoViolation(validatePage({
    file: "src/pages/users.vue", before: null,
    after: `<script setup>\nimport RegisteredCard from "../components/RegisteredCard.vue";\n</script><template><RegisteredCard /><registered-card /></template>`,
    config: CONFIG, registry: REGISTRY, knownSources: REGISTERED_SOURCES, mode: "full",
  }));
  assertViolation(validatePage({
    file: "src/pages/users.vue", before: null,
    after: `<script setup>\nimport QuickPanel from "../features/QuickPanel.vue";\n</script><template><quick-panel /></template>`,
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-unregistered-component");
  assertViolation(validatePage({
    file: "src/pages/users.vue", before: null,
    after: `<script setup>\nimport { defineComponent } from "vue";\nconst LocalPanel = defineComponent({});\n</script><template><local-panel /></template>`,
    config: CONFIG, registry: REGISTRY, mode: "full",
  }), "page-local-component");
  assertNoViolation(validatePage({
    file: "src/app/legacy/page.tsx", before: "export default () => <div />",
    after: "const userId = data.id; export default () => <div />",
    config: CONFIG, registry: REGISTRY, mode: "incremental",
  }));
  assertViolation(validatePage({
    file: "src/app/legacy/page.tsx", before: "export default () => <div />",
    after: "export default () => <div /><div />",
    config: CONFIG, registry: REGISTRY, mode: "incremental",
  }), "page-direct-ui");
});

test("SvelteKit과 Astro 페이지의 대표 문법을 검사한다", () => {
  const frameworkRegistry = registry({
    "svelte-card": component("src/components/SvelteCard.svelte", { family: "svelte-card", purpose: "Svelte 카드" }),
    "astro-card": component("src/components/AstroCard.astro", { family: "astro-card", purpose: "Astro 카드" }),
  });
  const sources = {
    "src/components/SvelteCard.svelte": "<!-- @design-component svelte-card -->\n<!-- @design-variants default -->\n<article />",
    "src/components/AstroCard.astro": "---\n// @design-component astro-card\n// @design-variants default\n---\n<article />",
  };
  assertNoViolation(validatePage({
    file: "src/routes/users/+page.svelte", before: null,
    after: '<script>import SvelteCard from "../../components/SvelteCard.svelte";</script><SvelteCard />',
    config: CONFIG, registry: frameworkRegistry, knownSources: sources, mode: "full",
  }));
  assertViolation(validatePage({
    file: "src/routes/users/+page.svelte", before: null, after: "<button>저장</button>",
    config: CONFIG, registry: frameworkRegistry, mode: "full",
  }), "page-direct-ui");
  assertNoViolation(validatePage({
    file: "src/routes/users/+page.svelte", before: null,
    after: "<svelte:head><title>사용자</title><meta name='description' content='목록' /></svelte:head>",
    config: CONFIG, registry: frameworkRegistry, mode: "full",
  }));
  assertNoViolation(validatePage({
    file: "src/pages/users.astro", before: null,
    after: '---\nimport AstroCard from "../components/AstroCard.astro";\n---\n<AstroCard />',
    config: CONFIG, registry: frameworkRegistry, knownSources: sources, mode: "full",
  }));
  assertViolation(validatePage({
    file: "src/pages/users.astro", before: null, after: "---\n---\n<section />",
    config: CONFIG, registry: frameworkRegistry, mode: "full",
  }), "page-direct-ui");
});

test("component 등록, 표식, 구조 복제를 검증한다", () => {
  assertViolation(validateComponent({
    file: "src/components/Unregistered.tsx", after: "export const Unregistered = () => <button />", config: CONFIG, registry: REGISTRY,
  }), "component-unregistered");
  assertNoViolation(validateComponent({
    file: "src/components/Frame.tsx", after: "export const Frame = ({ children }) => <div>{children}</div>", config: CONFIG, registry: REGISTRY,
  }));

  const structuralRegistry = registry({
    card: component("src/components/Card.tsx", { family: "card", purpose: "프로필 카드" }),
    clone: component("src/components/Clone.tsx", { family: "clone", purpose: "프로필 카드" }),
  });
  const cloneSource = "// @design-component clone\n// @design-variants default\nexport const Clone = () => <section className=\"card\"><h2>다른 이름</h2></section>;";
  assertViolation(validateComponent({
    file: "src/components/Card.tsx",
    after: "// @design-component card\n// @design-variants default\nexport const Card = () => <section className=\"card\"><h2>표시 문구만 다름</h2></section>;",
    config: CONFIG, registry: structuralRegistry, knownSources: { "src/components/Clone.tsx": cloneSource },
  }), "component-duplicate-structure");
  assertNoViolation(validateComponent({
    file: "src/components/Card.tsx",
    after: "// @design-component card\n// @design-variants default\nexport const Card = () => <section className=\"other\"><h2>다른 구조</h2></section>;",
    config: CONFIG, registry: structuralRegistry, knownSources: { "src/components/Clone.tsx": cloneSource },
  }));
  assertViolation(validateComponent({
    file: "src/components/Card.tsx", after: "export const Card = () => <section />",
    config: CONFIG, registry: structuralRegistry,
  }), "component-marker-mismatch");

  for (const fake of [
    'const fake = "@design-component card @design-variants default */";',
    "const fake = `@design-component card @design-variants default */`;",
  ]) assertViolation(validateComponent({
    file: "src/components/Card.tsx",
    after: `${fake}\nexport const Card = () => <section className=\"card\"><h2>표시</h2></section>;`,
    config: CONFIG, registry: structuralRegistry, knownSources: { "src/components/Clone.tsx": cloneSource },
  }), "component-marker-mismatch");

  const nestedClone = "// @design-component clone\n// @design-variants default\nexport const Clone = () => <div /><section><aside /></section>;";
  assertNoViolation(validateComponent({
    file: "src/components/Card.tsx",
    after: "// @design-component card\n// @design-variants default\nexport const Card = () => <div><section /><aside /></div>;",
    config: CONFIG, registry: structuralRegistry, knownSources: { "src/components/Clone.tsx": nestedClone },
  }));

  assert.deepEqual(compareCandidates([
    { id: "a", kind: "composite", family: "a", purpose: "같음", fingerprint: { nativeTags: ["div"], attrs: ["className"], children: [] } },
    { id: "b", kind: "composite", family: "b", purpose: "다름", fingerprint: { nativeTags: ["section"], attrs: [], children: [] } },
  ], { id: "new", kind: "composite", family: "new", purpose: "같음", fingerprint: { nativeTags: ["div", "div"], attrs: ["className", "className"], children: [] } }), []);
});

test("Write, Edit, MultiEdit 내용을 같은 방식으로 계산한다", () => {
  assert.deepEqual(applyToolEdit({ content: "new" }, "old"), { after: "new", errors: [] });
  assert.deepEqual(applyToolEdit({ old_string: "old", new_string: "new" }, "old"), { after: "new", errors: [] });
  assert.deepEqual(applyToolEdit({ edits: [{ old_string: "a", new_string: "b" }, { old_string: "b", new_string: "c" }] }, "a"), { after: "c", errors: [] });
});
