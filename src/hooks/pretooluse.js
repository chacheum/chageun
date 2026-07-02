// chageun pretooluse — PreToolUse 하드 차단 훅(Claude 전용).
// "말로 된 브레이크"를 기계 브레이크로: 되돌리기 불가능한 소수 고위험 패턴만 결정론적으로 막는다.
// 얇은 그물이지 만능 아님 — 확실히 파괴적인 경우만 차단(오탐 회피). 매치 시 exit 2 + stderr 사유.
// 예외·불확실은 안전 통과(exit 0). 외부 호출 없음. 개인/회사 정보 없음.
// 순수 패턴 판정은 core, 부수효과(env 탈출구·transcript 읽기)는 이 래퍼에 둔다.
// NOTE: Codex 훅은 PreToolUse 미지원 → 이 방어는 Claude에만 있다(Codex는 텍스트 멈춤규칙 의존).

const fs = require("fs");
const { block, reasonFor, isPrCreate, hasPrReviewer, unattendedBlock, reasonForUnattended } = require("./pretooluse-core.js");

function deny(reasonKey, unattended) {
  process.stderr.write(unattended ? reasonForUnattended(reasonKey) : reasonFor(reasonKey));
  process.exit(2); // PreToolUse: exit 2 = 도구 호출 차단, stderr를 Claude에 전달
}

// transcript를 읽어 pr-reviewer 실행 흔적 확인. 못 읽으면 fail-open(true) — 훅 오류로 정상작업 안 막음.
function prReviewerRan(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return true; // fail-open(no-op)
    const objs = [];
    for (const ln of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
      const s = ln.trim(); if (!s) continue;
      try { objs.push(JSON.parse(s)); } catch (_) { /* skip */ }
    }
    return hasPrReviewer(objs);
  } catch (_) { return true; } // 어떤 예외든 fail-open
}

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  const UNATTENDED = process.env.CHAGEUN_UNATTENDED === "1";
  try {
    const input = JSON.parse(raw);
    const name = input.tool_name;
    const ti = input.tool_input || {};

    // 1) base 패턴 차단. 무인 모드는 배포 탈출구(CHAGEUN_ALLOW_DEPLOY)를 무시.
    const hit = block(name, ti);
    if (hit === "deploy") {
      if (UNATTENDED || process.env.CHAGEUN_ALLOW_DEPLOY !== "1") return deny("deploy", UNATTENDED);
    } else if (hit) {
      return deny(hit, UNATTENDED);
    }

    // 2) 무인 전용 추가 차단(push·배포프리뷰·DB쓰기·설치·경로·PR).
    if (UNATTENDED) {
      if (isPrCreate(name, ti)) return deny("u-pr", true);
      const uhit = unattendedBlock(name, ti, { worktreeRoot: process.cwd(), criteriaPath: process.env.CHAGEUN_CRITERIA_FILE });
      if (uhit) return deny(uhit, true);
    }

    // 3) 게이트 생략 감지: 무인 모드는 SKIP 탈출구(CHAGEUN_SKIP_GATE_CHECK)를 무시.
    if (isPrCreate(name, ti) && (UNATTENDED || process.env.CHAGEUN_SKIP_GATE_CHECK !== "1")) {
      if (!prReviewerRan(input.transcript_path)) return deny("gate-skip", UNATTENDED);
    }
  } catch (_) {
    // 무인: 판정 중 예외 = 불확실 = 안전측(park). 유인: 기존대로 fail-open(사람이 백스톱).
    if (UNATTENDED) { process.stderr.write(reasonForUnattended("u-error")); process.exit(2); }
  }
  process.exit(0);
});
