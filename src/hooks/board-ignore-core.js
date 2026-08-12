// 상황판이 git 에 안 올라가게 막혔는지 판정한다(v0.65.0 F-27).
//
// 🛑 **판정을 정규식으로 다시 짜지 않는다.** `.gitignore`·`info/exclude`·전역 목록·되살림
//    규칙(`!status.md`)이 겹치는 판정을 손으로 구현하면 조용히 틀린다. git 에게 맡기고
//    종료코드만 읽는다.
//
// 🛑 **왜 별도 파일인가.** `pretooluse-core.js` 는 머리 주석과 여러 함수 주석이 "순수 판정
//    로직 · fs 없음"을 되풀이해 못 박은 파일이라 `execFileSync("git", …)` 가 들어가면 그
//    계약이 깨지고, `posttooluse.js` 가 판정 하나 때문에 코어 전체를 끌어오게 된다.
//    소유는 PreToolUse 쪽이고 PostToolUse 는 **쓰기만** 한다(되돌리기 의존을 한 방향으로).
//
// 신호를 **둘** 본다. 실측(git 2.53.0)으로 확인한 사실이 이 갈래의 근거다:
//   | 상태                              | check-ignore | ls-files --error-unmatch |
//   | 추적 안 함 + 무시 줄 없음          | 1            | 1                        |
//   | 추적 중   + 무시 줄 없음          | 1            | 0                        |
//   | 추적 중   + info/exclude 에 줄 있음 | 1 (그대로)   | 0                        |
//   | 추적 끊은 뒤 + 무시 줄 있음        | 0            | 1                        |
//   | git 저장소가 아님                  | 128          | 128                      |
// 즉 **추적 중이면 무시 줄을 넣어도 안 풀린다** — 회복이 두 걸음이라는 사실이 여기서 나온다.
// 🛑 `--no-index` 를 쓰지 않는다. 붙이면 추적 중이어도 0이 나와, 무시 줄이 먼저 들어간
//    추적 파일이 차단을 뚫고 평문 업무 보고가 커밋된다.
"use strict";
const { execFileSync } = require("child_process");

const FILE = "status.md";
const GIT_OPTS = { timeout: 2000, stdio: "ignore" };

/**
 * @returns {"ok"|"blocked"|"unknown"}
 *   ok      = 무시가 확인됐다
 *   blocked = 이미 추적 중이거나 무시가 안 됐다
 *   unknown = git 밖·git 없음·타임아웃·예외 (부르는 쪽이 처분을 정한다)
 * 🛑 **처분은 여기서 안 정한다.** PreToolUse 는 blocked 면 차단·unknown 이면 통과,
 *    PostToolUse 는 ok 가 아니면 침묵하고 안 쓴다.
 */
function boardIgnoreVerdict(dir) {
  try {
    // 1) 이미 추적 중인가 — 0이면 여기서 끝(두 번째 명령을 안 부른다).
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", FILE], { cwd: dir, ...GIT_OPTS });
      return "blocked";
    } catch (e) {
      // 1 = 추적 안 함(정상 갈래). 그 밖(128·ENOENT·타임아웃)은 판정 불가.
      if (!e || e.status !== 1) return "unknown";
    }
    // 2) 무시되나 — 0이면 통과, 1이면 차단.
    try {
      execFileSync("git", ["check-ignore", "-q", FILE], { cwd: dir, ...GIT_OPTS });
      return "ok";
    } catch (e) {
      if (e && e.status === 1) return "blocked";
      return "unknown";
    }
  } catch (_) {
    return "unknown";
  }
}

module.exports = { boardIgnoreVerdict, FILE };
