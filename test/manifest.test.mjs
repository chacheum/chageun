import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, claudePluginJson } from "../build/lib/manifest.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("loadManifest는 정본 필드를 읽는다", () => {
  const m = loadManifest(SRC);
  assert.equal(m.name, "chageun");
  assert.equal(m.version, "0.72.3");
  assert.equal(m.components.skills.length, 15);
});

// 🛑 v0.67.0: `dependencies` 칸이 **아예 없어야** 한다(빈 배열이 아니다). `deepEqual` 은 여분 키를
//    잡으므로 이 단언 자체가 "빈 배열이 실렸다"도 함께 막는다. 아래 `in` 검사는 그 뜻을 실패
//    메시지에 남기려고 따로 둔다 - `deepEqual` 만 두면 왜 틀렸는지가 "여분 키" 로만 보인다.
test("claudePluginJson은 현 plugin.json과 의미 동일(의존성 칸 없음)", () => {
  const j = claudePluginJson(loadManifest(SRC));
  assert.deepEqual(j, {
    name: "chageun",
    // v0.67.0 T7-다: 긴 줄표를 하이픈으로. 이 문자열은 src/manifest.src.json:4 와 **한 벌**이라
    // 소스와 이 단언을 같은 커밋에서 함께 고쳐야 한다(한쪽만 고치면 이 deepEqual 이 빨개진다).
    description: "Safe build workflow for non-developers - task cards, verification gates, real run-through, plain-language summaries (replies in your language; default Korean). 비개발자가 안전하게 만들도록 돕는 워크플로우.",
    version: "0.72.3",
    license: "MIT",
    keywords: ["workflow", "non-developer", "vibe-coding", "review", "safety", "korean", "english"]
  });
  assert.ok(!("dependencies" in j),
    "plugin.json 에 dependencies 칸이 실렸다 — 차근은 남의 플러그인에 의존하지 않는다. 빈 배열도 안 된다(하네스가 그 모양을 받아들이는지 확인된 바 없다)");
});

// 🛑 마켓플레이스의 크로스마켓 허가 줄도 함께 사라져야 한다. 그 줄을 허용하던 이유는 수퍼파워스
//    의존성 하나뿐이었고(다른 크로스마켓 의존 0건), 의존이 없으면 그 줄은 아무것도 안 가리키면서
//    "우리가 남의 마켓 것에 의존한다"는 신호를 공개 파일에 남긴다.
//    ⚠ **루트 `/.claude-plugin/marketplace.json` 은 이 검사 말고는 어느 검사도 안 본다.**
//    그 파일이 `/plugin marketplace add chacheum/chageun` 이 읽는 파일이다.
test("마켓플레이스 두 벌에 크로스마켓 허가 줄이 없다", () => {
  for (const rel of [["src", "marketplace.claude.json"], [".claude-plugin", "marketplace.json"]]) {
    const p = join(SRC, "..", ...rel);
    const txt = readFileSync(p, "utf8");
    assert.ok(!txt.includes("allowCrossMarketplaceDependenciesOn"),
      `${rel.join("/")} 에 크로스마켓 허가 줄이 남았다 — 가리킬 의존성이 없는데 공개 파일이 의존을 선언한다`);
    JSON.parse(txt);   // 줄을 지우면서 쉼표를 남겨 JSON 이 깨지는 것을 함께 잡는다
  }
});
