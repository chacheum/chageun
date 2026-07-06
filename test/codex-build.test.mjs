import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodex } from "../build/adapters/codex.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("buildCodex는 Codex 플러그인 트리를 만든다", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bx-")), "codex");
  buildCodex(SRC, out);
  const p = JSON.parse(readFileSync(join(out, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(p.name, "chageun");
  assert.equal(p.skills, "./skills/");
  assert.equal(p.hooks, "./hooks/hooks-codex.json");
  assert.ok(!("dependencies" in p), "Codex plugin.json에 dependencies 없어야");
  for (const f of [
    "hooks/hooks-codex.json", "hooks/activate-codex.mjs", "hooks/finish-work-codex.mjs",
    "hooks/pretooluse-codex.mjs", "hooks/pretooluse-core.js",
    "rules/operating-rules.md", "codex/operating-rules-addendum.md", "codex/gate-agents.md", "codex/codex-tools.md",
    "README.md", "LICENSE",
  ]) assert.ok(existsSync(join(out, f)), f);
  for (const s of ["referencing","product-map","design-system","monitoring","security-scan"])
    assert.ok(existsSync(join(out, "skills", s, "SKILL.md")), s);
  // 공유 operating-rules는 원본과 동일(미수정)
  assert.equal(readFileSync(join(out,"rules/operating-rules.md"),"utf8"), readFileSync(join(SRC,"rules/operating-rules.md"),"utf8"));
});

test("codex README는 Codex 설치 안내를 덧붙인다(claude는 불변)", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bx-")), "codex");
  buildCodex(SRC, out);
  const codexReadme = readFileSync(join(out, "README.md"), "utf8");
  const srcReadme = readFileSync(join(SRC, "README.md"), "utf8");

  // codex README는 원본 내용을 포함
  assert.ok(codexReadme.includes(srcReadme), "codex README는 원본 README 내용을 포함해야");

  // codex README는 Codex 설치 섹션 포함
  assert.ok(codexReadme.includes("Codex CLI에서 설치"), "codex README는 'Codex CLI에서 설치' 섹션을 포함해야");
  assert.ok(codexReadme.includes("codex plugin marketplace add chacheum/chageun"), "codex README는 marketplace add 명령어를 포함해야");

  // codex README는 원본보다 길어야 함 (append 확인)
  assert.ok(codexReadme.length > srcReadme.length, "codex README는 원본보다 길어야 함");
});
