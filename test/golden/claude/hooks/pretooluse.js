// chageun pretooluse — PreToolUse 하드 차단 훅(Claude 전용).
// "말로 된 브레이크"를 기계 브레이크로: 되돌리기 불가능한 소수 고위험 패턴만 결정론적으로 막는다.
// 얇은 그물이지 만능 아님 — 확실히 파괴적인 경우만 차단(오탐 회피). 매치 시 exit 2 + stderr 사유.
// 예외·불확실은 안전 통과(exit 0). 외부 호출 없음. 개인/회사 정보 없음.
// 순수 패턴 판정은 core, 부수효과(env 탈출구·transcript 읽기)는 이 래퍼에 둔다.
// NOTE: Codex 훅은 PreToolUse 미지원 → 이 방어는 Claude에만 있다(Codex는 텍스트 멈춤규칙 의존).

const fs = require("fs");
const path = require("path");
const { block, reasonFor, isPrCreate, isPush, hasPrReviewer, planReminderNeeded, routingReminderNeeded, unattendedBlock, reasonForUnattended, budgetStep, isGitCommit, BUDGET } = require("./pretooluse-core.js");

// P1 리마인더 대상 도구(코드 수정류).
const EDIT_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
// P1 리마인더 전용 transcript 리더 — needle 조기 탈출(plan 없는 세션의 매 편집 파싱 비용 회피).
// 주의: prReviewerRan(게이트 생략 감지)은 이 헬퍼를 쓰지 않는다 — "pr-reviewer"에 "plan"이 없어
// 조기 탈출을 공유하면 gate-skip이 회귀한다(게이트 CONDITIONAL 조건). 부재·예외는 null(리마인더 침묵).
function readTranscriptIfMentions(transcriptPath, needle) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const raw = fs.readFileSync(transcriptPath, "utf8");
    if (raw.indexOf(needle) === -1) return null;
    const objs = [];
    for (const ln of raw.split("\n")) {
      const s = ln.trim(); if (!s) continue;
      try { objs.push(JSON.parse(s)); } catch (_) { /* skip */ }
    }
    return objs;
  } catch (_) { return null; }
}

function deny(reasonKey, unattended) {
  process.stderr.write(unattended ? reasonForUnattended(reasonKey) : reasonFor(reasonKey));
  process.exit(2); // PreToolUse: exit 2 = 도구 호출 차단, stderr를 Claude에 전달
}

// 제어파일(.chageun/STOP·token) 위치를 한 곳에 못 박는다 — 세션이 하위폴더·전용 worktree로
// 옮겨 다녀도 "사람이 STOP을 두는 곳"과 "훅이 찾는 곳"이 갈라지지 않게. cwd는 신뢰 안 함.
// 1순위: 런처가 준 CHAGEUN_ROOT(env는 cd로 안 바뀜). 2순위: cwd에서 위로 올라가며 .chageun 탐색
// (STOP을 더 잘 찾는 안전 방향). 못 찾으면 cwd(그러면 통과표 부재 → fail-closed park).
function ctlRoot() {
  const fromEnv = process.env.CHAGEUN_ROOT;
  if (fromEnv) return fromEnv;
  let dir = process.cwd();
  for (let i = 0; i < 64; i++) {
    try { if (fs.existsSync(path.join(dir, ".chageun"))) return dir; } catch (_) { /* 계속 */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
function ctlPath(name) { return path.join(ctlRoot(), ".chageun", name); }
function stopRequested() { try { return fs.existsSync(ctlPath("STOP")); } catch (_) { return true; } } // 읽기 예외도 안전측
function validPreflightToken() {
  try {
    const want = process.env.CHAGEUN_UNATTENDED_TOKEN;
    if (!want) return false;
    const data = JSON.parse(fs.readFileSync(ctlPath("token"), "utf8"));
    return typeof data.nonce === "string" && data.nonce.length > 0 && data.nonce === want;
  } catch (_) { return false; } // 부재·파싱실패 = 무효(fail-closed)
}

// 예산 상태 읽기: "부재(go가 지움=새 시작) / 정상 / 손상(리셋 금지)"을 구분.
function readRuntime() {
  const p = ctlPath("runtime.json");
  if (!fs.existsSync(p)) return { absent: true };
  try {
    const state = JSON.parse(fs.readFileSync(p, "utf8"));
    // 파싱은 됐어도 스키마가 틀리면(null·숫자·startedAt 없음) 손상으로 취급 — 조용히 리셋 금지.
    if (!state || typeof state.startedAt !== "number") return { corrupt: true };
    return { state };
  } catch (_) { return { corrupt: true }; }
}
// 원자적 쓰기(temp+rename) — 동시 서브에이전트 읽기가 잘린 파일을 보지 않게(POSIX rename 원자적).
function writeRuntime(s) {
  try {
    const p = ctlPath("runtime.json"), tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, p);
  } catch (_) { /* 무시 */ }
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

    // 0) 무인 게이트: 정지 요청 or preflight 통과표 없음 → 모든 도구 park(fail-closed).
    if (UNATTENDED) {
      if (stopRequested()) return deny("u-stop", true);
      if (!validPreflightToken()) return deny("u-no-preflight", true);
    }

    // 0.5) 무인 예산·워치독: 매 호출 카운트+시각 검사. 초과/헛돎 → park. commit은 진전.
    if (UNATTENDED) {
      const rt = readRuntime();
      if (rt.corrupt) return deny("u-error", true); // 손상 시 시계 리셋 대신 안전 park
      const { state, reason } = budgetStep(rt.state || null, Date.now(), isGitCommit(name, ti), BUDGET);
      writeRuntime(state);
      if (reason) return deny(reason, true);
    }

    // 1) base 패턴 차단. 무인 모드는 배포 탈출구(CHAGEUN_ALLOW_DEPLOY)를 무시.
    const hit = block(name, ti);
    if (hit === "deploy") {
      if (UNATTENDED || process.env.CHAGEUN_ALLOW_DEPLOY !== "1") return deny("deploy", UNATTENDED);
      // ALLOW_DEPLOY=1(유인)이면 배포 통과.
    } else if (hit) {
      return deny(hit, UNATTENDED);
    }

    // 2) 무인 전용 추가 차단(push·배포프리뷰·DB쓰기·설치·경로·PR).
    if (UNATTENDED) {
      if (isPrCreate(name, ti)) return deny("u-pr", true);
      const uhit = unattendedBlock(name, ti, { worktreeRoot: ctlRoot(), criteriaPath: process.env.CHAGEUN_CRITERIA_FILE });
      if (uhit) return deny(uhit, true);
    }

    // 3) 게이트 생략 감지(P3: git push 포함 — 무인은 위 2)의 u-push가 선행 차단이라 유인 전용 확장):
    //    무인 모드는 SKIP 탈출구(CHAGEUN_SKIP_GATE_CHECK)를 무시.
    if (isPrCreate(name, ti) || isPush(name, ti)) {
      if (UNATTENDED || process.env.CHAGEUN_SKIP_GATE_CHECK !== "1") {
        if (!prReviewerRan(input.transcript_path)) return deny("gate-skip", UNATTENDED);
      }
      // SKIP_GATE=1(유인)이면 게이트 검사 생략.
    }

    // 4) P1 리마인더(soft): plan 문서를 쓰고 plan-validator 없이 첫 코드 수정 시작 →
    //    차단 없이 리마인더 한 줄 주입(additionalContext). 자체 try/catch — 리마인더는 어떤
    //    경우에도 차단·park 사유가 되지 않는다(무인 fail-closed catch로 새지 않게).
    if (EDIT_RE.test(String(name || ""))) {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "plan");
        if (objs && planReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: 이번 세션에 plan 문서를 작성했는데 plan-validator 게이트를 아직 거치지 않았습니다. 규칙상 구현 시작 직전 plan-validator 호출이 필수입니다(코어 '검증 게이트'). 지금 게이트를 먼저 실행하세요.",
            },
          }));
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }

    // 4.5) routing 리마인더(soft, batch6): code-implementer 첫 위임 직전 chageun:routing
    //    스킬 미로드 → 리마인더 1회 주입. P1과 동일하게 자체 try/catch로 격리(예외가 무인
    //    fail-closed catch로 새어 park가 되지 않게 — plan-validator medium 반영). needle 조기
    //    탈출은 못 쓴다(부재가 신호) — Agent 스폰은 드물어 전체 파싱 비용 수용.
    if (/^(Task|Agent)$/.test(String(name || ""))) {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "");
        if (objs && routingReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: code-implementer에 위임하려는데 이번 세션에 chageun:routing 스킬을 아직 로드하지 않았습니다. 규칙상 서브에이전트 위임(병렬 포함) 전 로드가 필수입니다(코어 '모델·실행 라우팅'). 지금 Skill 도구로 로드해 라우팅 표·병렬 위임 규칙을 확인한 뒤 위임하세요.",
            },
          }));
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }
  } catch (_) {
    // 무인: 판정 중 예외 = 불확실 = 안전측(park). 유인: 기존대로 fail-open(사람이 백스톱).
    if (UNATTENDED) { process.stderr.write(reasonForUnattended("u-error")); process.exit(2); }
  }
  process.exit(0);
});
