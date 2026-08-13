import { join } from "node:path";
import { readJson } from "./fsutil.mjs";

// 🛑 v0.67.0: `dependencies` 가 필수 키에서 빠졌다. 차근은 이제 남의 플러그인에 의존하지 않는다.
//    **빈 배열로 두는 길은 일부러 안 골랐다**: `if (!m.dependencies.claude)` 는 빈 배열을 통과시키고
//    (빈 배열은 참) 그 배열이 `plugin.json` 으로 그대로 나가는데, 하네스가 `"dependencies": []` 를
//    받아들이는지 확인된 바가 없다. 안 켜지면 화면에 오류 없이 규칙과 게이트만 조용히 사라진다.
//    칸을 아예 안 내보내면 그 미확인 자체가 없어진다.
//    다시 의존성을 갖게 되면 세 자리를 함께 되살린다: 이 목록 · 아래 `dependencies` 칸 ·
//    마켓플레이스의 `allowCrossMarketplaceDependenciesOn`(루트와 `src/marketplace.claude.json`).
const REQUIRED = ["name", "version", "description", "license", "keywords", "components"];

export function loadManifest(srcDir) {
  const m = readJson(join(srcDir, "manifest.src.json"));
  for (const k of REQUIRED) {
    if (!(k in m)) throw new Error("manifest.src.json 필수 키 누락: " + k);
  }
  // 선언이 있으면 모양은 계속 검사한다 - 되살릴 때 오타가 조용히 통과하지 않게.
  if ("dependencies" in m && !m.dependencies.claude) throw new Error("dependencies.claude 누락");
  return m;
}

export function claudePluginJson(m) {
  const j = {
    name: m.name,
    description: m.description,
    version: m.version,
    license: m.license,
    keywords: m.keywords,
  };
  // 있을 때만 넣는다. 없는데 `undefined` 를 박으면 JSON.stringify 가 키를 지우긴 하지만,
  // 이 함수의 반환값을 그대로 비교하는 검사(test/manifest.test.mjs)에서는 키가 보인다.
  if ("dependencies" in m) j.dependencies = m.dependencies.claude;
  return j;
}
