// 테스트용 임시 폴더를 **한 뿌리 아래** 모으고, 프로세스가 끝날 때 그 뿌리를 통째로 지운다.
//
// 왜 필요했나: 예전에는 각 테스트가 `mkdtempSync(join(tmpdir(), "…"))` 로 os 임시 폴더 **바로 아래**
//   폴더를 뿌렸고 대부분 지우지 않았다. 2026-08-09 실측으로 `/tmp` 에 2,398개·840MB 가 쌓여 있었다.
//   개별 테스트마다 정리 코드를 손으로 넣는 방식은 이미 실패했다 — 12개 파일 중 5개만 정리 흔적이
//   있었고, 가장 많이 만드는 파일(retrospect-scan, 39개)이 거의 안 지우고 있었다. 그래서 만드는
//   자리를 한 곳으로 모아 **정리를 잊을 수 없게** 만든다.
//
// 왜 'exit' 로 충분한가: `node --test` 는 테스트 **파일마다 프로세스를 새로 띄운다.** 따라서 파일이
//   끝나면 그 파일이 만든 것만 지워지고, 다른 파일이 쓰는 폴더를 건드리지 않는다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "chageun-test-"));

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch (e) {
    // 조용히 넘기면 이 파일이 고치려는 문제(조용히 쌓임)와 같은 실패 모양이 된다(1회차 low).
    console.error("[tmp-cleanup] 임시 폴더 정리 실패: " + ROOT + " — " + (e && e.message ? e.message : e));
  }
};

process.on("exit", cleanup);
// Ctrl+C 로 중단해도 남기지 않는다. 리스너를 달면 기본 종료가 막히므로 직접 종료한다.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { cleanup(); process.exit(sig === "SIGINT" ? 130 : 143); });
}

/** 임시 폴더를 하나 만들어 경로를 돌려준다. 지우는 것은 이 파일이 책임진다. */
export function tmpDir(prefix) {
  return mkdtempSync(join(ROOT, prefix));
}

export { ROOT as TMP_ROOT };
