import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaude } from "../build/adapters/claude.mjs";
import { listTree } from "../build/lib/fsutil.mjs";
import { tmpDir } from "./support-tmpdir.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let TMP;
before(() => {
  TMP = tmpDir("distchk-");
  buildClaude(join(ROOT, "src"), join(TMP, "claude"));
});

for (const plat of ["claude"]) {
  test(`커밋된 dist/${plat}는 build(src)와 일치`, () => {
    const committed = join(ROOT, "dist", plat);
    const fresh = join(TMP, plat);
    assert.ok(existsSync(committed), `커밋된 dist/${plat}/ 없음 — npm run build && git add dist/ 후 커밋하세요`);
    const a = listTree(committed), b = listTree(fresh);
    assert.deepEqual(a, b, `${plat} 파일목록 불일치`);
    for (const f of a)
      assert.ok(readFileSync(join(committed, f)).equals(readFileSync(join(fresh, f))), `${plat}/${f} 내용 불일치 — npm run build 후 커밋 필요`);
  });
}
