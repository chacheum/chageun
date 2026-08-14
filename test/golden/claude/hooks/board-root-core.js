// "이 프로젝트에 상황판이 있나 · 있으면 어디인가" - 판정 한 자리.
//
// 🛑 **이 질문의 답은 이 파일 하나뿐이다.** 훅 셋이 같은 질문을 각자 풀고 있었다:
//    세션 시작(activate.js) · 안내(pretooluse.js §4.5b) · §2 자동 갱신(posttooluse.js).
//    한 곳만 고쳐지자 **같은 세션 안에서 두 지시가 충돌**했다 - 시작 때는 "상황판이 있으니
//    갱신하라"가 오고 첫 편집 때는 "없으니 만들어라"가 왔다(작업방에서 실제로 났다).
//    뒤엣말을 따르면 작업방 안에 상황판이 한 장 더 생기고, 기계가 채우는 칸은 새 파일로 가
//    사용자가 웹으로 보던 원래 상황판이 **조용히 멈춘다.**
//
// 왜 CJS 인가: 부르는 훅 셋이 전부 CJS 다. `skills/statusboard/board-core.mjs` 의
//    `resolveRoot` 는 ESM 이고 목적도 다르다(형제 프로젝트 훑기 · 한 홉). 그대로 못 부른다.
//    다만 **경계 규칙은 같아야** 해서 그 규칙만 옮겨 왔다(아래 `isBoundaryDir`).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// 파일 이름은 언어와 무관하게 하나로 고정한다(board-core.mjs 와 같은 이유).
const FILE = "status.md";

// 위로 걷는 최대 단수. 작업방이 `<repo>/.claude/worktrees/<이름>` 로 3단이고, 그 아래
// 하위 폴더에서 켜는 경우까지 넉넉히 덮는다. 🛑 상한 자체를 없애면 안 된다: 링크·마운트가
// 얽혀 부모가 안 줄어드는 트리에서 훅이 10초 제한에 걸려 **하드 차단 전부가 조용히 꺼진다.**
const MAX_UP = 12;

/**
 * 홈 폴더를 정규화해 돌려준다. 경계 판정이 **문자열 비교**라 정규화가 안전장치의 일부다:
 * `HOME=/home/u/` 처럼 끝에 슬래시가 붙거나 빈 값이면 비교가 조용히 빗나가 경계가 헐거워진다.
 * (`env.HOME` 을 먼저 보는 이유는 board-core.mjs 와 같다 - POSIX 의 homedir() 이 그 값을
 *  읽으므로, 같은 사실을 주입 가능하게 두어 검사가 진짜 홈을 안 어지럽히고 이 갈래를 잰다.)
 * 절대 경로가 아니면 빈 문자열을 돌려준다: `path.resolve` 가 상대값을 **켠 폴더 기준**으로
 * 펴서, 홈이 아닌 자리가 홈 행세를 하게 된다.
 */
function homeDirOf(env) {
  const e = env || process.env;
  const raw = typeof e.HOME === "string" ? e.HOME.trim() : "";
  let h = raw;
  if (!h) { try { h = os.homedir() || ""; } catch (_) { h = ""; } }
  return h && path.isAbsolute(h) ? path.resolve(h) : "";
}

// 경계 이름. `board-core.mjs` 의 `resolveRoot` 와 **같은 목록**이어야 한다(검사가 대조한다).
// `/Users` 는 macOS 의 홈 부모다: 차근은 공개 플러그인이라 리눅스 이름만 알면 그 기계에서
// 남의 홈 트리로 한 단 더 오른다.
const BOUNDARY_NAMES = ["/", "/home", "/Users"];

// 🛑 경계 판정은 **이 함수 하나**다. 부르는 자리마다 다시 적으면(지역 클로저 포함) 한쪽만
//    고쳐진다 - 이 파일이 고치려던 사고와 같은 모양이다. home 을 미리 구해 넘길 수 있게
//    두 번째 인자를 열어 둔다(걸음마다 env 를 다시 읽지 않으려고).
function isBoundaryPath(dir, home) {
  return BOUNDARY_NAMES.indexOf(dir) !== -1 || (!!home && dir === home);
}

/**
 * 경계 폴더인가. 홈 · `/home` · `/Users` · `/` 로, `board-core.mjs` 의 `resolveRoot` 와 같다.
 * (`pretooluse.js` 의 안내 갈래도 이 판정을 그대로 쓴다.)
 */
function isBoundaryDir(dir, env) {
  return isBoundaryPath(path.resolve(String(dir || ".")), homeDirOf(env));
}

/**
 * 켠 폴더부터 위로 올라가며 `FILE` 을 가진 폴더를 찾는다. 없으면 null.
 *
 * 🛑 **경계 위로는 안 올라간다.** `resolveRoot` 가 "부모가 경계면 형제를 안 훑는다"인 것과
 *    같은 규칙을 여러 단으로 편 것이다: 켠 폴더 자신은 언제나 보되, **부모가 경계면 거기서
 *    끝난다.** 그래서 `/home/u/proj` 에서 켜면 `~/status.md` 를 절대 안 집는다 - 홈에 한 장
 *    있으면 그 아래 **모든** 프로젝트가 같은 상황판을 제 것으로 여기고, 기계가 거기에 쓴다.
 *    (켠 폴더가 홈 자신이면 `~/status.md` 는 집는다. 그것은 올라간 것이 아니라 그 폴더의
 *     제 상황판이고, `resolveRoot("/home/u", …)` 도 똑같이 집는다.)
 */
function findBoardDir(startDir, env) {
  const home = homeDirOf(env);
  let dir;
  try { dir = path.resolve(String(startDir || ".")); } catch (_) { return null; }
  for (let i = 0; i < MAX_UP; i++) {
    try { if (fs.existsSync(path.join(dir, FILE))) return dir; } catch (_) { return null; }
    const parent = path.dirname(dir);
    if (parent === dir || isBoundaryPath(dir, home) || isBoundaryPath(parent, home)) return null;
    dir = parent;
  }
  return null;
}

/** 찾은 상황판의 절대 경로. 없으면 null. */
function findBoardPath(startDir, env) {
  const dir = findBoardDir(startDir, env);
  return dir === null ? null : path.join(dir, FILE);
}

module.exports = { findBoardDir, findBoardPath, isBoundaryDir, homeDirOf, FILE, MAX_UP, BOUNDARY_NAMES };
