import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, claudePluginJson, codexPluginJson } from "../build/lib/manifest.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("loadManifest는 정본 필드를 읽는다", () => {
  const m = loadManifest(SRC);
  assert.equal(m.name, "chageun");
  assert.equal(m.version, "0.20.0");
  assert.equal(m.components.skills.length, 9);
});

test("claudePluginJson은 현 plugin.json과 의미 동일", () => {
  const j = claudePluginJson(loadManifest(SRC));
  assert.deepEqual(j, {
    name: "chageun",
    description: "Safe build workflow for non-developers — task cards, verification gates, real run-through, plain-language summaries (replies in your language; default Korean). 비개발자가 안전하게 만들도록 돕는 워크플로우.",
    version: "0.20.0",
    license: "MIT",
    dependencies: [
      { name: "superpowers", marketplace: "claude-plugins-official", version: "^6.0.0" }
    ],
    keywords: ["workflow", "non-developer", "vibe-coding", "review", "safety", "korean", "english"]
  });
});

test("codexPluginJson은 Codex 매니페스트를 만든다 (dependencies 키 없음)", () => {
  const j = codexPluginJson(loadManifest(SRC));
  assert.equal(j.name, "chageun");
  assert.equal(j.version, "0.20.0");
  assert.equal(j.skills, "./skills/");
  assert.equal(j.hooks, "./hooks/hooks-codex.json");
  assert.equal(j.interface.displayName, "차근 (chageun)");
  assert.deepEqual(j.interface.capabilities, ["Interactive", "Read", "Write"]);
  assert.ok(!("dependencies" in j), "Codex plugin.json은 dependencies 필드를 가지면 안 됨");
  assert.equal(j.author.name, "chacheum");
  assert.equal(j.interface.developerName, "chacheum");
});
