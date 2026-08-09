import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, claudePluginJson } from "../build/lib/manifest.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("loadManifest는 정본 필드를 읽는다", () => {
  const m = loadManifest(SRC);
  assert.equal(m.name, "chageun");
  assert.equal(m.version, "0.57.0");
  assert.equal(m.components.skills.length, 12);
});

test("claudePluginJson은 현 plugin.json과 의미 동일", () => {
  const j = claudePluginJson(loadManifest(SRC));
  assert.deepEqual(j, {
    name: "chageun",
    description: "Safe build workflow for non-developers — task cards, verification gates, real run-through, plain-language summaries (replies in your language; default Korean). 비개발자가 안전하게 만들도록 돕는 워크플로우.",
    version: "0.57.0",
    license: "MIT",
    dependencies: [
      { name: "superpowers", marketplace: "claude-plugins-official", version: "^6.0.0" }
    ],
    keywords: ["workflow", "non-developer", "vibe-coding", "review", "safety", "korean", "english"]
  });
});
