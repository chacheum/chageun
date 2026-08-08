// 임시 폴더가 실제로 지워지는지 확인한다.
// 실측(2026-08-09): 테스트가 os 임시 폴더에 직접 폴더를 뿌리고 대부분 안 지워 `/tmp` 에
//   2,398개·840MB 가 쌓여 있었다. `retrospect-scan.test.mjs` 한 파일이 실행마다 43개를 흘렸다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test("헬퍼가 만든 폴더는 프로세스가 끝나면 사라진다", () => {
  // 자식 프로세스를 띄워 만들고 끝낸 뒤, 그 경로가 남았는지 부모가 확인한다.
  //   (같은 프로세스 안에서는 exit 훅이 아직 안 돌아 검증이 안 된다.)
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { tmpDir, TMP_ROOT } from ${JSON.stringify(join(TEST_DIR, "support-tmpdir.mjs"))};
     const d = tmpDir("cleanup-");
     process.stdout.write(JSON.stringify({ d, root: TMP_ROOT }));`],
    { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const { d, root } = JSON.parse(r.stdout);
  assert.equal(existsSync(d), false, "자식이 만든 임시 폴더가 남았다: " + d);
  assert.equal(existsSync(root), false, "임시 뿌리 폴더가 남았다: " + root);
});
