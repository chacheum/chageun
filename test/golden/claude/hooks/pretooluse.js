// chageun pretooluse: PreToolUse 하드 차단 훅(Claude 전용).
// "말로 된 브레이크"를 기계 브레이크로: 되돌리기 불가능한 소수 고위험 패턴만 결정론적으로 막는다.
// 얇은 그물이지 만능 아님: 확실히 파괴적인 경우만 차단(오탐 회피). 매치 시 exit 2 + stderr 사유.
// 예외·불확실은 안전 통과(exit 0). 외부 호출 없음. 개인/회사 정보 없음.
// 순수 패턴 판정은 core, 부수효과(env 탈출구·transcript 읽기)는 이 래퍼에 둔다.
// NOTE: 순수 판정은 pretooluse-core.js가 갖고, 이 래퍼에만 있는 것들(agent_type 분기·transcript
// 리마인더·디자인 색 백스톱)은 부수효과가 필요해 여기 둔다.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { block, reasonFor, isPrCreate, isPush, hasPrReviewer, planReminderNeeded, routingReminderNeeded, designRegistryReminderNeeded, isUiTarget, unattendedBlock, reasonForUnattended, budgetStep, isGitCommit, BUDGET, isReviewAgent, reviewAgentBlock, gateModelBlock, subagentGateSpawn, approvedDesignVariant, planScaleBlock, approvedBigPlan, spawnIntent, LEGACY_UNATTENDED_SCOPE, isSupervisor, supervisorBlock, spawnCapReached, statusboardTrigger } = require("./pretooluse-core.js");
const { isDesignScanTarget, parseAllowColors, scanColors, violationsForEdit, readDesignDoc } = require("./design-scan-core.js");
const componentBoundary = require("../skills/design-system/component-boundary-core.cjs");
// ⚠ 위 require 들이 실패하면 **PreToolUse 하드 차단 전부가 한꺼번에 꺼진다**(모듈 로드 시점 예외는
//   아래 stdin 핸들러 밖이라 어떤 try/catch 도 못 잡는다). 배포판에 실리는지는 매니페스트
//   `components.hooks` 가 정하고, test/build.test.mjs 의 existsSync 한 줄이 그 그물이다.
// 🛑 이것도 감싼다(아래 상황판 모듈과 **같은 기준**). 이 모듈이 먹이는 것은 §4.9 부드러운
//   알림 한 줄뿐인 **순수 편의**인데, 최상위 require 면 파일 하나가 없어질 때 하드 차단이
//   전부 꺼진다. 위 `componentBoundary` 등은 차단의 본체라 일부러 안 감싼다(없으면 차단이
//   없는 것이라 조용히 통과시키면 안 되고 죽는 편이 옳다).
let unknownToolNotice = () => null, unknownToolMessage = () => "";
try {
  ({ unknownToolNotice, unknownToolMessage } = require("./tool-ledger-core.js"));
} catch (e) {
  process.stderr.write("chageun: 도구 장부 모듈을 못 불렀다(차단은 그대로 산다): " + e.message + "\n");
}
// v0.65.0 F-27(상황판).
// 🛑 **상황판 계열 require 는 감싼다.** 최상위 require 는 모듈 로드 시점에 던져서 아래 어떤
//   try/catch 도 못 잡고, 이 훅이 종료코드 1 로 죽는다. 하네스는 2가 아니면 "막지 않는 오류"로
//   보고 도구를 그대로 실행하므로, 파일 하나가 없어지는 순간 **비밀값·push·무인 park·디자인 색·
//   컴포넌트 경계 차단이 그 세션 내내 통째로 꺼진다** - 화면에는 아무 표시도 안 난다(실측:
//   모듈 있을 때 exit 2 차단 · 없을 때 exit 1 통과). 상황판은 안전 장치가 아니라 편의라,
//   못 부르면 **상황판 기능만 잠들고 차단은 산다**는 것이 기준이다.
//   대체값은 전부 "아무것도 아니다" 쪽이다: 안내를 안 내고(경계로 봄), 상황판 대상이 없다고 보고,
//   무시 판정은 계약대로 "unknown"(PreToolUse 에서 통과)이다.
//   🛑 이 그물을 `pretooluse-core.js` 같은 **판정 본체**로 넓히지 말 것: 그것이 없으면 차단이
//   없는 것이라 조용히 통과시키면 안 되고, 죽는 편이 옳다.
let boardIgnoreVerdict = () => "unknown";
//   🛑 대체 객체는 **내보내는 것을 전부** 갖는다. 빠뜨린 칸은 모듈이 없을 때만 `undefined` 라,
//   나중에 그 칸을 쓰는 코드가 이 갈래에서만 조용히 어긋난다(가장 늦게 발견되는 방향).
let boardRoot = {
  FILE: "status.md", MAX_UP: 0, BOUNDARY_NAMES: [],
  isBoundaryDir: () => true, homeDirOf: () => "",
  findBoardDir: () => null, findBoardPath: () => null,
};
try {
  // 무시 판정은 **별도 모듈**이다: 코어는 "순수 판정 로직 · fs 없음"이 계약이라 git 호출이
  //   들어가면 그 계약이 깨지고, posttooluse 가 판정 하나 때문에 코어 전체를 끌어오게 된다.
  //   소유는 여기(PreToolUse)이고 PostToolUse 는 쓰기만 한다.
  ({ boardIgnoreVerdict } = require("./board-ignore-core.js"));
  // "상황판이 있나 · 어디인가"는 훅 셋이 **같은 답**을 내야 한다(board-root-core.js 머리 주석).
  boardRoot = require("./board-root-core.js");
} catch (e) {
  process.stderr.write("chageun: 상황판 모듈을 못 불렀다(차단은 그대로 산다): " + e.message + "\n");
}
const { collectSecrets, findLeaks } = require("./secret-scan-core.js");

// P1 리마인더 대상 도구(코드 수정류).
const EDIT_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
// P1 리마인더 전용 transcript 리더: needle 조기 탈출(plan 없는 세션의 매 편집 파싱 비용 회피).
// 주의: prReviewerRan(게이트 생략 감지)은 이 헬퍼를 쓰지 않는다 - "pr-reviewer"에 "plan"이 없어
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

// ── 감독 상한이 읽을 자리(v0.65.0 F-28) ──────────────────────────────────────
// 훅이 받는 `transcript_path` 는 **부모(메인) 기록**이다(2026-08-12 실측). 상한이 세야 하는 것은
// "감독이 몇을 띄웠나"인데 서브에이전트의 스폰은 부모 기록에 **아예 안 실린다**(훅 호출 13건 내내
// 한 바이트도 안 자람). 그 값을 그대로 읽으면 (1) 부모 기록에 이미 든 스폰 때문에 감독이 첫 스폰에서
// 죽고 (2) 더 근본적으로 **"메인이 몇을 띄웠나"를 센다**: 값이 큰 게 아니라 다른 것을 센다.
// 그래서 자기 기록의 자리를 조립해 그것을 읽는다. 순수 문자열 조립이다.
//
// 🛑 이 세 칸은 하네스가 훅 입력에 박는 값이라 모델이 못 정한다(agent_type 과 같은 자리).
//    하나라도 빈 값이면 조립하지 않고 null = 못 읽음 = 차단(fail-closed).
//
// 🛑 이 자리는 하네스가 기록을 두는 **폴더 구조**에 기댄다. 갑자기 전부 막히면 그 구조가 바뀌었는지부터 본다.
//    (이 진단을 docs/ 에만 두면 사람에게 안 닿는다: 이 저장소는 docs/ 를 커밋하지 않는다.
//     그래서 같은 한 줄이 supervisor-cap-unreadable 문구에도 들어 있다.)
// 🛑 그 구조는 한 겹이 아니다. 평면 `subagents/agent-*.jsonl` 과 각본 층
//    `subagents/workflows/<wf_id>/agent-*.jsonl` 둘이고, 이 조립은 **평면을 가정한다.**
//    (두 겹이라는 사실의 출처는 회고 스캐너 주석이다(2026-07-31 `fcc7a99` · 저장소 누적
//    1단계 239 대 워크플로우 층 217). 그 파일은 `73e42c6` 에서 걷혔으나 `git show
//    73e42c6^:src/skills/retrospect/retrospect-scan.mjs` 로 이력엔 남는다. 2026-08-12
//    층별 재측정표는 `docs/2026-08-11-v065-supervisor-spec.md`(비커밋 폴더)에 있고,
//    프로브가 잰 것은 감독 기록이 어느 층에 떨어지나 하나뿐이다.)
//    평면 경로를 실제로 조립하는 자리가 바로 아래 `supervisorTranscriptPath` 하나뿐이라,
//    구조가 의심되면 그 `path.join` 부터 본다.
//    감독은 `Agent` 로 띄우므로 평면에 떨어진다(2026-08-12 프로브 실측: layer=flat).
//    각본(Workflow)으로 띄우면 이 가정이 깨지고 첫 스폰부터 supervisor-cap-unreadable 로 선다
//: 조용히 틀리는 대신 시끄럽게 서는 쪽이다.
// 🛑 구조가 바뀌면 **고칠 곳은 둘이다: 아래 `supervisorTranscriptPath` 와
//    `test/pretooluse.test.mjs` 의 F-28 픽스처.** 픽스처는 같은 경로를 **일부러 리터럴로**
//    한 번 더 짓는다(조립기를 부르면 바뀌어도 검사가 따라가 초록이 되어버리기 때문 - 이유는
//    픽스처 바로 위에 있다). 구조가 바뀌면 픽스처도 함께 고친다 - 안 고치면 검사가 빨개진다.
function supervisorTranscriptPath(input) {
  const parent = input && input.transcript_path;
  const sid = input && input.session_id;
  const aid = input && input.agent_id;
  if (typeof parent !== "string" || !parent) return null;
  if (typeof sid !== "string" || !sid) return null;
  if (typeof aid !== "string" || !aid) return null;
  return path.join(path.dirname(parent), sid, "subagents", `agent-${aid}.jsonl`);
}

// "못 읽음"과 "읽었는데 0건"을 **가르는** 리더. 🛑 위 readTranscriptIfMentions 를 쓰면 안 된다:
// 그 헬퍼는 리마인더용이라 둘 다 null 로 돌려주고, 감독의 **첫 스폰 때 정상적으로 null** 이다.
// 계약 세 줄. (1) readFileSync 가 던지면 null = 못 읽음 → 차단.
// (2) 읽혔으면 줄마다 파싱하되 **깨진 줄은 건너뛴다.** 0줄이어도 배열이다(= 읽음 → 0건이면 통과).
// (3) 즉 "못 읽음"은 **파일 수준 실패 하나뿐**이고, 줄 수준 실패는 못 읽음이 아니다.
//     🛑 여기를 "한 줄이라도 깨지면 null" 로 바꾸면, 기록이 쓰이는 중인 순간마다 감독이 오차단으로
//     죽는다(꼬리 한 줄이 덜 쓰인 채 읽히는 일이 실제로 있다). 켤 스위치가 없어 회복 경로도 없고,
//     화면에는 버그가 아니라 정상 정책 정지처럼 보여 원인 찾기도 어렵다. 형제 함수와 같은 계약이다.
// existsSync 로 미리 거르지 않는다: 확인과 읽기 사이에 파일이 사라지는 틈을 안 만든다.
// 크기 상한을 안 두는 이유(다음 사람이 다시 재지 않게 적어 둔다): 이 읽기는 **감독이 스폰할 때만**
//   돌고 한 세션에 많아야 일곱 번이다(모든 도구 호출마다 읽는 자리가 아니다). 상한을 둘 값이 안 나온다.
function readTranscriptStrict(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, "utf8"); } catch (_) { return null; }
  const objs = [];
  for (const ln of String(raw).split("\n")) {
    const s = ln.trim(); if (!s) continue;
    try { objs.push(JSON.parse(s)); } catch (_) { /* skip: 쓰이는 중인 꼬리 줄 */ }
  }
  return objs;
}

// v0.42: 서브에이전트면 사람 전용 탈출구를 안내하지 않는다(켤 수도 없고, 그 승인은 사람 판단이다).
// input.agent_type은 서브에이전트에만 있다(메인 세션은 없음 → 기존 문구 그대로).
let IS_SUBAGENT = false;
function deny(reasonKey, unattended, detail) {
  const base = unattended ? reasonForUnattended(reasonKey) : reasonFor(reasonKey, IS_SUBAGENT);
  // detail(예: 실제 위반 색 토큰 목록)이 있으면 정적 사유 뒤에 덧붙인다.
  process.stderr.write(detail ? base.replace(/\n?$/, "") + " (위반: " + detail + ")\n" : base);
  process.exit(2); // PreToolUse: exit 2 = 도구 호출 차단, stderr를 Claude에 전달
}

// 제어파일(.chageun/STOP·token) 위치를 한 곳에 못 박는다: 세션이 하위폴더·전용 worktree로
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
    // 파싱은 됐어도 스키마가 틀리면(null·숫자·startedAt 없음) 손상으로 취급: 조용히 리셋 금지.
    if (!state || typeof state.startedAt !== "number") return { corrupt: true };
    return { state };
  } catch (_) { return { corrupt: true }; }
}
// 원자적 쓰기(temp+rename): 동시 서브에이전트 읽기가 잘린 파일을 보지 않게(POSIX rename 원자적).
function writeRuntime(s) {
  try {
    const p = ctlPath("runtime.json"), tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, p);
  } catch (_) { /* 무시 */ }
}

// transcript를 읽어 pr-reviewer 실행 흔적 확인. 못 읽으면 fail-open(true): 훅 오류로 정상작업 안 막음.
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

// ── 공용 component 경계(Claude 편집 시점 hard block) ────────────────────────
// ── 상황판(v0.65.0 F-27) ────────────────────────────────────────────────────
// 하드 차단 둘이 보는 대상은 **이 세션의 `status.md`(켠 폴더 자리 또는 위에서 찾은 그 파일)
// 이면서 실제로 상황판인 파일**이다.
// 판정이 두 겹인 이유: 경로만 보면 **저장소 루트에 원래부터 `status.md` 를 두고 git 으로
//   추적하는 프로젝트**가 정확히 그 경로다. 차근은 공개 플러그인이고 이 차단에는 탈출구가
//   없어, 그 팀 문서를 고치려는 모든 편집이 막히고 차단 문구가 **남의 문서를 저장소에서
//   빼라고 권하는 모양**이 된다. 이 저장소는 오차단을 최대 실패 양식으로 다뤄 왔다.
// 내용 신호로 `chageun:auto` 를 쓰는 이유: 본보기 골격의 **기계가 읽는 부분**이고 정확한
//   리터럴 하나라 판정을 새로 짤 일이 없다. 머리 표시(`chageun:auto:head`)에도 들어 있는
//   조각이라 반쯤 마이그레이션된 상황판도 그대로 무장된다.
const BOARD_FILE = boardRoot.FILE;
const BOARD_MARK = "chageun:auto";
const BOARD_HEAD_BYTES = 512 * 1024;   // 표시는 파일 앞쪽에 있다

// 이번에 **새로 쓰는 텍스트**만 모은다. 🛑 편집 후 파일 전체를 재지 않는다: 예전에 한 번
// 들어간 값이 남아 있으면 그 뒤 모든 편집이 영영 막히고, 그 값을 지우는 편집조차 막혀
// 회복 경로가 사라진다.
function boardNewText(name, ti) {
  const nm = String(name || "");
  if (nm === "Write") return String(ti.content || "");
  if (nm === "Edit") return String(ti.new_string || "");
  if (nm === "MultiEdit") return (Array.isArray(ti.edits) ? ti.edits : []).map((e) => String((e && e.new_string) || "")).join("\n");
  return "";
}
// 못 읽으면 (a)는 거짓으로 본다: 오차단 대신 통과다(§4.6 fail-open 관례).
function boardHasMark(abs) {
  try {
    const len = Math.max(0, Math.min(fs.statSync(abs).size, BOARD_HEAD_BYTES));
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      return buf.toString("utf8").indexOf(BOARD_MARK) !== -1;
    } finally { fs.closeSync(fd); }
  } catch (_) { return false; }
}
// 대상 판정을 **한 번만** 짓고 하드 차단과 소프트 안내가 그 결과를 갈라 쓴다.
// 순서가 싼 것부터다: 도구 이름 → 절대 경로 → 내용 신호(파일 읽기 1회) → git.
// 남의 루트 `status.md` 는 세 번째에서 끝나 **git 을 아예 안 부른다.**
function boardTargetOf(name, ti, cwd) {
  if (!COMPONENT_EDIT_RE.test(String(name || ""))) return null;
  const abs = ti && ti.file_path ? path.resolve(cwd, ti.file_path) : null;
  // 🛑 **제품이 가리키는 그 상황판**을 대상으로 삼는다. 켠 폴더만 보면 작업방·하위 폴더
  //    세션이 뿌리 상황판을 고치는 편집이 통째로 차단 밖으로 나간다: 상황판은 평문 업무
  //    보고서이고 웹으로도 보이는데, 거기 접속 정보가 적히는 것을 막는 겹이 이 차단뿐이다.
  //    (옛 판에서는 그 세션에 "여기엔 없으니 만들어라" 안내가 떠 작업방 안에 새로 만들었고,
  //     그 파일이 곧 `cwd/status.md` 라 차단이 덮었다. 이제 뿌리 파일이 유일한 정답이다.)
  // 🛑 켠 폴더 자리(`here`)도 **함께** 본다. 찾은 것으로 갈아 끼우기만 하면 상황판이 아직
  //    없을 때 `findBoardPath` 가 null 이라, **지금 만드는 편집**이 대상에서 빠져 4.5c 안내가
  //    영영 안 나간다. 둘의 합집합이라 옛 판정의 상위집합이다 - 새 오차단은 안 생긴다.
  // 비용: 이름이 `status.md` 일 때만 위로 걷는다. 보통 편집은 basename 비교에서 끝난다.
  if (!abs || path.basename(abs) !== BOARD_FILE) return null;
  const here = path.resolve(cwd, BOARD_FILE);
  if (abs !== here && abs !== boardRoot.findBoardPath(cwd)) return null;
  const exists = fs.existsSync(abs);
  const armed = (exists && boardHasMark(abs)) || boardNewText(name, ti).indexOf(BOARD_MARK) !== -1;
  return { abs, exists, armed };
}

// 세션당 한 번만 안내하기 위한 표식. 🛑 트랜스크립트를 안 읽는다: 매 편집마다 세션 기록
// 전체를 파싱하면 긴 세션에서 훅이 10초 제한을 넘겨 **하드 차단 전부가 조용히 꺼진다**.
function boardNoticeKey(input) {
  const raw = input.session_id || (input.transcript_path ? path.basename(input.transcript_path) : "");
  return raw ? String(raw).replace(/[^A-Za-z0-9_-]/g, "-") : null;
}
// 성공 = 이번 세션 처음. EEXIST 든 그 밖의 실패든 **전부 침묵**이다(중복을 못 막으면
// 편집마다 같은 말이 붙는다). ⚠ 상위 폴더를 먼저 만든다: 새 기계에는 이 폴더가 없고,
// 없으면 배타 생성이 ENOENT 로 실패해 **새 사용자에게 주 경로가 한 번도 안 울린다.**
function claimBoardNotice(key) {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const dir = path.join(base, "chageun", "board-notice");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { return false; }
  try { fs.writeFileSync(path.join(dir, key), "", { flag: "wx" }); } catch (_) { return false; }
  // 새로 만든 그 자리에서 7일 지난 표식을 지운다(임시 파일이 쌓인 전례가 있다).
  try {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (_) { /* 개별 격리 */ }
    }
  } catch (_) { /* 정리 실패는 침묵 */ }
  return true;
}

const COMPONENT_EDIT_RE = /^(Write|Edit|MultiEdit)$/;
function boundaryIssue(code, detail) { return detail ? { code, detail } : { code }; }
function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; }
}
function normalizedRelative(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}
function boundaryDocumentPath(root) {
  return path.resolve(root, process.env.DESIGN_COMPONENT_DOC || "docs/design-system.md");
}
function appendBoundary(entries, target, result) {
  for (const entry of entries) target.push(entry.code ? entry : boundaryIssue(String(entry)));
  if (result) {
    appendBoundary(result.violations || [], target);
    appendBoundary(result.errors || [], target);
  }
}
function parseBoundaryConfig(text, label, entries) {
  try { return componentBoundary.parseDesignConfig(text || ""); }
  catch (error) {
    entries.push(boundaryIssue("configuration-error", `${label}: ${error.message}`));
    return null;
  }
}
function parseBoundaryRegistry(text, label, entries) {
  if (text === null) {
    entries.push(boundaryIssue("registry-missing", label));
    return null;
  }
  try { return componentBoundary.parseRegistry(text); }
  catch (error) {
    entries.push(boundaryIssue("registry-invalid", `${label}: ${error.message}`));
    return null;
  }
}

// 이 함수는 filesystem을 읽되, 수정 대상 파일은 tool input으로 계산한 after text로 덮어쓴다.
// 색 검사와 달리 component 경계에는 lint ignore나 환경변수 우회가 없다.
function runComponentBoundaryChannel(input, context) {
  const name = input.tool_name;
  const tool = input.tool_input || {};
  if (!COMPONENT_EDIT_RE.test(String(name || ""))) return [];
  const root = path.resolve(input.cwd || process.cwd());
  const entries = [];
  const document = boundaryDocumentPath(root);
  if (typeof tool.file_path !== "string" || !tool.file_path) {
    const config = parseBoundaryConfig(readText(document), "before design document", entries);
    if (entries.length) return entries;
    return config?.enabled ? [boundaryIssue("edit-input-invalid", "file_path")] : [];
  }
  const target = path.resolve(root, tool.file_path);
  const beforeTarget = readText(target);
  const beforeDocument = target === document ? beforeTarget : readText(document);

  // 비채택 프로젝트에는 component 경계가 도구 입력 형식까지 관여하지 않는다.
  // 다만 규칙 문서 자체를 바꾸는 경우에는 before/after 양쪽을 계산해 해제를 막는다.
  let beforeConfig = null;
  if (target !== document) {
    beforeConfig = parseBoundaryConfig(beforeDocument, "before design document", entries);
    if (entries.length || !beforeConfig?.enabled) return entries;
  }
  const applied = componentBoundary.applyToolEdit(tool, beforeTarget || "");
  appendBoundary(applied.errors, entries);
  if (entries.length) return entries;

  const afterDocument = target === document ? applied.after : beforeDocument;
  if (target === document) beforeConfig = parseBoundaryConfig(beforeDocument, "before design document", entries);
  const afterConfig = parseBoundaryConfig(afterDocument, "after design document", entries);
  if (entries.length || !afterConfig) return entries;
  if (beforeConfig?.enabled && !afterConfig.enabled) {
    entries.push(boundaryIssue("design-system-disabled", "docs/design-system.md"));
    return entries;
  }
  if (!afterConfig.enabled) return entries; // 디자인 시스템 미채택 프로젝트는 무영향

  const registryFile = path.resolve(root, afterConfig.registryPath);
  const beforeRegistryFile = beforeConfig?.enabled ? path.resolve(root, beforeConfig.registryPath) : null;
  const beforeRegistryText = beforeRegistryFile === target ? beforeTarget : (beforeRegistryFile ? readText(beforeRegistryFile) : null);
  const afterRegistryText = registryFile === target ? applied.after : readText(registryFile);
  const beforeRegistry = beforeConfig?.enabled
    ? parseBoundaryRegistry(beforeRegistryText, "before registry", entries)
    : null;
  const afterRegistry = parseBoundaryRegistry(afterRegistryText, "after registry", entries);
  if (entries.length || !afterRegistry) return entries;

  appendBoundary(componentBoundary.validateRegistryBoundary({ config: afterConfig, registry: afterRegistry }).errors, entries);
  const changes = beforeRegistry
    ? componentBoundary.registryChanges(beforeRegistry, afterRegistry)
    : { addedComponents: Object.keys(afterRegistry.components), addedVariants: [], addedDecisions: [], errors: [] };
  appendBoundary(changes.errors, entries);

  // 기존 component에 새 변형을 붙일 때만, 바로 앞 AskUserQuestion의 실제 두 번째 선택과 ID를 묶는다.
  if (!entries.length && changes.addedVariants.length) {
    const transcript = readTranscriptIfMentions(context.transcript_path, "chageun-design-variant:") || [];
    for (const { component, variant } of changes.addedVariants) {
      const decisions = changes.addedDecisions.filter((decision) => decision.component === component && decision.variant === variant);
      if (decisions.length !== 1) continue; // registryChanges가 mismatch로 이미 막는다.
      const approval = approvedDesignVariant(transcript, component, variant);
      if (!approval.approved || decisions[0].approvalToolUseId !== approval.toolUseId) {
        entries.push(boundaryIssue("variant-approval-missing", `${component}:${variant}`));
      }
    }
  }
  if (entries.length) return entries;

  const relativeTarget = normalizedRelative(root, target);
  const knownSources = {};
  for (const component of Object.values(afterRegistry.components)) {
    const sourceFile = path.resolve(root, component.path);
    const source = sourceFile === target ? applied.after : readText(sourceFile);
    if (source !== null) knownSources[component.path] = source;
  }

  // registry-first 직후에만 아직 없는 source를 후보 비교에서 제외한다. 프로젝트 검사기의
  // 최종 snapshot 검사는 이 인자를 주지 않아 source 부재를 계속 실패로 처리한다.
  const pendingSourcePaths = new Set(changes.addedComponents
    .map((id) => afterRegistry.components[id].path)
    .filter((file) => typeof knownSources[file] !== "string"));
  const checked = new Set();
  const inspectComponent = (file, source = knownSources[file]) => {
    if (checked.has(file) || typeof source !== "string") return;
    checked.add(file);
    appendBoundary([], entries, componentBoundary.validateComponent({
      file,
      after: source,
      config: afterConfig,
      registry: afterRegistry,
      knownSources,
      pendingSourcePaths,
    }));
  };
  const role = componentBoundary.pathRole(relativeTarget, afterConfig);
  if (role === "page") {
    appendBoundary([], entries, componentBoundary.validatePage({
      file: relativeTarget,
      before: beforeTarget,
      after: applied.after,
      config: afterConfig,
      registry: afterRegistry,
      knownSources,
      mode: beforeTarget === null ? "full" : "incremental",
    }));
  } else if (role === "component" && relativeTarget !== afterConfig.registryPath) {
    inspectComponent(relativeTarget, applied.after);
  }

  // registry-first는 source가 아직 없으면 허용한다. 이미 있는 source를 새 registry entry로 편입하면
  // marker와 구조를 지금 검사해 이름만 바꾼 복사를 숨기지 못하게 한다.
  for (const id of changes.addedComponents) inspectComponent(afterRegistry.components[id].path);
  // 레지스트리를 고치면 이미 등록된 source도 새 ID·변형과 맞는지 그 자리에서 확인한다.
  // source가 아직 없는 새 항목은 registry-first 생성 순서를 위해 위 inspectComponent가 건너뛴다.
  if (relativeTarget === afterConfig.registryPath) {
    for (const component of Object.values(afterRegistry.components)) inspectComponent(component.path);
  }
  return entries;
}

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  const UNATTENDED = process.env.CHAGEUN_UNATTENDED === "1";
  // 🛑 `name` 선언을 try **밖**으로 올린다(v0.65.0 F-29). 파일 끝 무인 fail-closed catch 가 이 값을
  //   봐야 하는데, try 안 선언이면 그 자리에서 ReferenceError 가 나고 catch 안에서 난 예외는 아무도
  //   안 잡아 훅이 비정상 종료한다: **무인 park 이 통과로 뒤집힌다.** 대입 자리는 아래 그대로 두고
  //   형도 안 바꾼다(소비자들은 이미 String(name||"") 로 감싸 쓴다).
  let name;
  try {
    const input = JSON.parse(raw);
    name = input.tool_name;
    const ti = input.tool_input || {};
    IS_SUBAGENT = !!input.agent_type;   // v0.42: 사람 전용 탈출구 안내를 서브에이전트에 주지 않기 위함
    // v0.65.0 F-29: 스폰 판정은 **한 곳**에서 한 번만 낸다(사본 금지 · pretooluse-core.js spawnIntent).
    //   null | { kind:"opaque"|"readable", via:"name"|"shape", agentType }. 순수 판정이라 여기서 미리 내도 싸다.
    const spawn = spawnIntent(name, ti);

    // v0.65.0 F-29(결정 3번 · **사용자**가 정했다 2026-08-11): **무인 범위는 안 넓힌다.**
    //   뜻은 딱 하나다: 그물을 넓혀 무인에 **새로 도달하게 된** 차단만 무인에서 안 켠다.
    //   🛑 **기존에 이미 무인에서 돌던 차단을 끄라는 뜻이 아니다.** 그래서 무인 **전용** 판정
    //   네 곳(§0 STOP·통과표 · §0.5 예산·워치독 · §2 unattendedBlock·u-pr · 파일 끝 바깥 catch)만
    //   옛 매처 집합 안에서 돈다. 세는 호출 수가 그대로라 **무인 예산 소진 속도가 v0.65.0 전과
    //   정확히 같다.**
    //   🛑 **그 밖의 판정은 넓힌 범위 그대로다**(리뷰 격리 · base block · 게이트 모델 · 계획 규모 ·
    //   게이트 스폰 · **불투명 통로 차단** · 신선도 · 색 · 컴포넌트 · 리마인더). 여기까지 좁히면
    //   **무인이 유인보다 헐거워진다**: 무인 서브에이전트만 Workflow 를 자유롭게 쓰게 되어
    //   결정 4번과 정면으로 어긋난다. **무인은 유인보다 느슨해질 수 없다**는 것이 이 저장소의 규율이다.
    //   🛑 그래서 무인 갈래를 **함수 머리에서 통째로 조기 종료**하는 모양으로 짜지 말 것.
    //   그렇게 짜도 (가)·(나) 칸과 965건 재생이 전부 초록이라, 그 실수만 잡는 칸을 따로 뒀다:
    //   test/hook-net.test.mjs 의 무인 (다).
    const UNATTENDED_SCOPED = UNATTENDED && LEGACY_UNATTENDED_SCOPE.test(String(name || ""));

    // 0-pre) 리뷰 에이전트 격리(Claude 서브에이전트 한정: 순수 문자열·fail-closed).
    //   transcript·fs 접근 없이 훅 초반에 판정. 판정 예외 시 안전측 차단(ra-error). agent_type은
    //   서브에이전트에만 있음(메인 세션은 없음 → 무영향). deny는 항상 ra-* 문구라 UNATTENDED 무관 false.
    //   파싱 실패 시엔 이 분기 전에 바깥 catch로 빠져 유인 fail-open(메인 배려: 스펙 §최대위험).
    if (isReviewAgent(input.agent_type)) {
      let raHit;
      try { raHit = reviewAgentBlock(input.agent_type, name, ti); } catch (_) { raHit = "ra-error"; }
      if (raHit) return deny(raHit, false);
    }

    // 0-pre2) 감독의 쓰기 금지(v0.65.0 F-28 · 0-pre 와 같은 모양). 허용 목록(`tools:` 넷)이 본체이고
    //   이것은 둘째 겹이다: 에이전트 정의 파일은 사람이 한 줄 고치면 조용히 넓어지는 자리이고,
    //   그때 아무 검사도 안 울린다. 판정 예외는 안전측 차단(ra-error 와 같은 원칙).
    //   deny 의 두 번째 인자가 항상 false 인 이유도 0-pre 와 같다: 이 문구는 무인이냐가 아니라
    //   **감독이라는 자리**에서 나온 것이라, 무인 park 문구로 바꾸면 무엇이 왜 막혔는지가 사라진다.
    if (isSupervisor(input.agent_type)) {
      let svHit;
      try { svHit = supervisorBlock(name); } catch (_) { svHit = "supervisor-write"; }
      if (svHit) return deny(svHit, false);
    }

    // 0) 무인 게이트: 정지 요청 or preflight 통과표 없음 → park(fail-closed).
    //    v0.65.0: **옛 집합만.** 넓힌 범위에서 돌면 무인 세션이 전보다 자주 멈춘다(사용자가 거부한 방향).
    if (UNATTENDED_SCOPED) {
      if (stopRequested()) return deny("u-stop", true);
      if (!validPreflightToken()) return deny("u-no-preflight", true);
    }

    // 0.5) 무인 예산·워치독: 매 호출 카운트+시각 검사. 초과/헛돎 → park. commit은 진전.
    //    v0.65.0: **옛 집합만** - 세는 호출 수가 그대로라 소진 속도가 v0.65.0 전과 정확히 같다.
    if (UNATTENDED_SCOPED) {
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

    // 1.5) 게이트 모델 런타임 강등 차단(v0.42). frontmatter 검사는 정적이라 Task 호출의 `model`
    //   덮어쓰기를 못 본다(실측: 게이트를 frontmatter보다 낮은 티어로 강등해 띄운 세션이 있었다).
    //   ⚠ v0.44.0에서 게이트 기본이 fable→opus로 내려갔다. 그래서 위 실측 사례("opus로 띄움")는
    //   이제 강등이 아니라 **기본 동작**이다. 지금 강등은 sonnet·haiku 쪽이다.
    //   탈출구: 기본 티어 모델이 없는 환경이 락아웃되면 게이트를 아예 안 부르게 돼 안전이 오히려 후퇴한다.
    //   무인 모드는 다른 탈출구와 같은 원칙으로 이 탈출구를 무시한다(무인 중 심판 강등 금지).
    {
      const gm = gateModelBlock(name, ti);
      if (gm && (UNATTENDED || process.env.CHAGEUN_ALLOW_GATE_MODEL !== "1")) return deny(gm, false);
    }

    // stdout JSON 은 이 훅에서 **한 번만** 쓴다. §1.6 진단과 §4~4.6 리마인더가 이 깃발을 공유한다.
    let reminderEmitted = false;

    // 1.6) 계획 규모 가드(v0.53.0). plan-validator.md 의 같은 축은 **보고**만 하고 안 멈춰서
    //   실측 사고를 못 막았다(차단 시점 4,020줄 · 10회 넘는 재검증 · 나흘간 코드 0줄).
    //   ⚠ 이 가드가 **왜** 멈추는지(예측기가 아니라 동의 관문)와 그 정직 고지(차단이 효과였는지
    //     처방 문구가 효과였는지는 안 갈렸다)는 pretooluse-core.js 의 `planScaleBlock` 위 주석이
    //     단일 출처다. 여기 요약만 읽고 프레임을 판단하지 말 것.
    //   탈출구를 환경변수로 안 둔 이유: 그건 세션 도중 못 켜서 오차단 시 회복이 세션 재시작뿐이다
    //   (pretooluse-core.js 의 REASONS["deploy"]·REASONS["gate-skip"] 문구가 같은 사실을 이미 못박아 뒀다).
    //   무인 모드는 승인 통로를 무시한다(사람이 승인할 수 없는 자리 · 실패 모드는 park).
    //   ⚠ 자체 try/catch 를 둔다. 바깥 catch(stdin 'end' 핸들러 끝)는 유인 모드에서 **아무 말 없이
    //     exit 0** 이라, 판정에 버그가 들어가면 가드가 꺼진 줄 모른 채 몇 주가 지난다
    //     (pr-reviewer 1회차 medium). 여기서는 통과시키되 stderr 한 줄로 꺼졌음을 남긴다.
    //   **크기 한 축만** 본다. 회차 축은 만들지 않기로 확정됐다(2026-08-09 · 되살릴 계획 없음:
    //   사유는 pretooluse-core.js planScaleBlock 주석).
    {
      // ⚠ try 는 이 절 **전체**를 감싼다. 3회차까지는 planScaleBlock 호출만 감쌌는데, 그 아래
      //   승인 확인·차단문 조립에서 던지면 파일 맨 끝 바깥 catch 로 가 유인 모드에서 **아무 말 없이
      //   exit 0** 이었다: 바로 이 절이 막으려던 그 경로다(4회차 low). deny 는 process.exit 이라
      //   try 안에서도 그대로 빠져나간다.
      try {
      // ⚠ 트랜스크립트는 여기서 **읽지 않는다.** 3회차에 기계 회차 계수를 먹이려고 이 자리에서
      //   무조건 읽었는데, §1.6은 모든 도구 호출에서 도는 자리라 `git status` 한 번에도 세션 기록
      //   전체(수천 레코드)를 파싱했다. needle 조기 탈출은 "plan-validator"가 차근 세션에 늘 있어
      //   안 걸린다. 긴 세션에서 훅 timeout 을 넘기면 **하드 차단 전부가 조용히 꺼진다**.
      //   승인 확인용 읽기는 아래에서 **차단이 실제로 걸렸을 때만** 한다.
        const cwdBase = input.cwd || process.cwd();
        const hits = planScaleBlock(name, ti, {
          // `~/…` 는 셸이 아니라 우리가 편다: path.resolve 는 `<cwd>/~/…` 로 만들어 읽기가 실패하고,
          //   실패는 후보 탈락이라 **가드가 조용히 꺼진다**(3회차 low · 한글 경로와 같은 실패 종류).
          readFile: (rel) => fs.readFileSync(
            /^~\//.test(rel) ? path.join(os.homedir(), rel.slice(2)) : path.resolve(cwdBase, rel), "utf8"),
        });
        // 승인 키·형식 안내는 **사람만** 쓸 수 있다. 무인과 서브에이전트는 그 화면을 못 띄우므로
        //   켤 수 없는 스위치를 안내하지 않는다(왕복만 늘린다: 이 파일 위쪽 배포 문구의 실측 교훈).
        const humanCanApprove = !UNATTENDED && !IS_SUBAGENT;
        if (hits && hits.length) {
          const approvals = humanCanApprove
            ? (readTranscriptIfMentions(input.transcript_path, "chageun-big-plan:") || []) : [];
          for (const hit of hits) {
            const verdict = humanCanApprove ? approvedBigPlan(approvals, hit.detail) : { approved: false };
            if (verdict.approved) continue;
            // 승인 질문은 **있었는데** 인정 못 한 경우를 구분해 알려준다. 같은 차단문만 다시 내면
            //   무엇이 틀렸는지 알 길이 없어 같은 실패를 반복한다(2회차 high).
            //   ⚠ "형식 오류"와 "사용자가 안 눌렀다"를 갈라야 한다: 사용자가 첫 번째(거절)를 눌렀는데
            //   형식 오류라고 안내하면 모델이 같은 질문을 다시 띄운다. 사람의 "아니오"가 기계 오류로
            //   포장돼 재촉으로 바뀐다(3회차 medium).
            const tried = humanCanApprove && approvals.some((r) => {
              const c2 = (r && (r.message || r).content) || [];   // 괄호 위치 = 코어와 동일(null 안전)
              return Array.isArray(c2) && c2.some((b) => b && b.type === "tool_use"
                && b.name === "AskUserQuestion" && JSON.stringify(b.input || {}).includes(hit.detail));
            });
            const why = !tried ? ""
              : verdict.wellFormed
                ? " ⚠ 이 키가 든 승인 질문은 형식이 맞는데 **두 번째 선택지가 눌리지 않았습니다**:"
                  + " 사용자가 거절했거나 아직 답하지 않은 것입니다. **거절이면 다시 묻지 말고 일을 쪼개세요.**"
                : " ⚠ 이 키가 든 승인 질문은 찾았지만 **형식이 안 맞아 인정되지 않았습니다** -"
                  + " 차단문의 형식 요건을 확인하세요.";
            return deny(hit.key, UNATTENDED,
              humanCanApprove ? hit.detail + " · " + hit.measured + why : hit.measured);
          }
        }
      } catch (e) {
        // 무인은 이 파일의 관례대로 **fail-closed**: 판정 불확실 = park(바깥 catch와 같은 원칙).
        //   사람이 없는 자리에서 "큰 계획은 무조건 멈춤"이 조용히 꺼지면 안 된다(2회차 medium).
        if (UNATTENDED) return deny("u-error", true);
        // ⚠ 유인 모드는 exit 0 으로 통과시킨다. 그런데 이 훅 계약에서 **stderr 가 Claude 에게 가는 길은
        //   exit 2 뿐**이라(이 파일 deny 주석), stderr 한 줄만 남기면 "가드가 꺼졌다"는 사실이
        //   아무에게도 안 닿는다: 이 절이 막으려던 상태 그대로다(5회차 medium). 리마인더와 같은
        //   stdout 통로로 보낸다. stderr 는 사람이 훅을 직접 돌릴 때를 위해 함께 남긴다.
        const msg = "[chageun] 계획 규모 가드가 판정에 실패해 이번 호출은 통과시킵니다: "
          + (e && e.message ? e.message : e);
        process.stderr.write(msg + "\n");
        try {
          process.stdout.write(JSON.stringify({ hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: msg + " - 큰 계획서가 검사 없이 통과했을 수 있습니다. 사용자에게 알리세요.",
          } }));
          reminderEmitted = true;
        } catch (_) { /* 진단 실패가 차단 사유가 되지는 않는다 */ }
      }
    }

    // 1.7) 서브에이전트의 게이트 스폰 차단(v0.64.0 H-2). 재료는 1.5와 같지만(Task/Agent + subagent_type)
    //   **자리는 계획 규모 가드(1.6) 뒤**다. 앞에 두면 서브에이전트의 plan-validator 호출이 여기서
    //   먼저 끊겨 1.6 의 서브에이전트 갈래(`humanCanApprove` 의 `!IS_SUBAGENT` · REASONS_SUBAGENT의
    //   "plan-size")가 통째로 도달 불가가 된다: 그 층은 이 차단이 나중에 느슨해질 때를 위한 백스톱이라
    //   살려 둔다. 큰 계획을 든 호출은 1.6 이 이미 더 자세히(잰 줄 수까지) 세우고, 나머지 게이트 호출을
    //   여기서 세운다. 둘 다 "멈추고 본 세션에 BLOCKED 로 올려라"로 끝나 방향이 같다.
    //   탈출구 없음: 켤 수 있는 사람이 이 자리에 없고(서브에이전트는 세션 환경변수를 못 만든다),
    //   열어야 할 정당한 경우는 "게이트는 본 세션이 띄운다"로 이미 덮인다.
    //   deny 의 두 번째 인자가 **항상 false** 인 이유는 0-pre(ra-*)와 같다: 이 문구는 무인이냐가 아니라
    //   서브에이전트라는 자리에서 나온 것이라, 무인 park 문구로 바꾸면 무엇이 왜 막혔는지가 사라진다.
    //   v0.65.0 F-29: 이 판정이 사유를 **두 가지**로 낸다(게이트 스폰 · 불투명 통로). 돌려받은 키를
    //   그대로 쓴다: 예전처럼 키를 여기 박아 두면 새 사유를 더해도 문구가 안 갈려서, 막힌 쪽은
    //   무엇에 막혔는지 모른 채 엉뚱한 회복(게이트를 안 띄우면 되겠지)을 시도한다.
    {
      const sgs = subagentGateSpawn(input.agent_type, name, ti);
      if (sgs) return deny(sgs, false);
    }

    // 1.7b) 감독 폭주 상한(v0.65.0 F-28). 문을 지난 **감독이 스폰 통로를 부를 때만** 돈다:
    //   한 세션에 많아야 일곱 번이라 비용이 안 나온다(모든 도구 호출마다 읽는 자리가 아니다).
    //   자리가 문 판정 **바로 뒤**인 이유: 앞에 두면 감독의 감독 스폰(subagent-supervisor-spawn)이
    //   상한 문구로 뒤바뀌어, 왜 막혔는지가 사라진다.
    // 🛑 **읽는 것은 input.transcript_path 가 아니라 조립한 자기 기록이다**(위 조립기 주석).
    //   못 읽으면 통과가 아니라 멈춤이다(fail-closed): 첫 스폰도 막는다. 통과로 두면 최상위 모델
    //   에이전트가 **상한 없이 늘어나는** 길이 열린다. 요금이 걸린 자리라 "값이 안 보이면 안전측"이다.
    //   "첫 1건만 봐주기"는 배선할 수 없다: 지금이 첫 스폰인지 알려면 지금까지의 수를 세야 하는데
    //   그 수를 세는 유일한 재료가 못 읽은 그 기록이고, 훅은 호출마다 새 프로세스라 기억이 없다.
    if (isSupervisor(input.agent_type) && spawnIntent(name, ti)) {
      const own = supervisorTranscriptPath(input);
      const objs = own ? readTranscriptStrict(own) : null;
      if (!objs) return deny("supervisor-cap-unreadable", false);   // 조립 실패·못 읽음 = 첫 스폰도 차단
      // 🛑 견주는 규칙은 core 의 spawnCapReached 하나다: **지금 부르려는 이 호출이 기록에 이미 적혀
      //   있어서**(2026-08-12 실측) 그 한 건을 빼야 "6번 성공 · 7번째 차단"이 된다(사용자 결정).
      //   여기서 다시 `>= SUPERVISOR_SPAWN_CAP` 로 견주면 쓸 수 있는 스폰이 5건으로 돌아간다.
      if (spawnCapReached(objs)) return deny("supervisor-spawn-cap", false);
    }

    // 2) 무인 전용 추가 차단(push·배포프리뷰·DB쓰기·설치·경로·PR).
    //    v0.65.0: **옛 집합만** - "새로 도달한 차단"이 사는 자리가 여기다(u-mcp-write 등).
    //    표본 쌍으로 재는 이유: `mcp__…__create_branch` 는 옛 매처에 부분일치하고
    //    `mcp__…__create_file` 은 안 한다. **같은 규칙·다른 도달 여부**라, 예외가 규칙 단위가 아니라
    //    **도달 단위**로 잡혔다는 증거가 된다(무인 (가)·(나) 칸).
    if (UNATTENDED_SCOPED) {
      if (isPrCreate(name, ti)) return deny("u-pr", true);
      const uhit = unattendedBlock(name, ti, { worktreeRoot: ctlRoot(), criteriaPath: process.env.CHAGEUN_CRITERIA_FILE });
      if (uhit) return deny(uhit, true);
    }

    // 3) 게이트 생략 감지(P3: git push 포함 - 무인은 위 2)의 u-push가 선행 차단이라 유인 전용 확장):
    //    무인 모드는 SKIP 탈출구(CHAGEUN_SKIP_GATE_CHECK)를 무시.
    if (isPrCreate(name, ti) || isPush(name, ti)) {
      // v0.64.0 H-2: 서브에이전트는 **트랜스크립트와 무관하게 항상** 막는다. 전에는 "자기 기록에
      //   pr-reviewer 흔적이 없어서" 막혔는데, 그건 조건이라 흔적이 생기는 순간 풀린다(스스로 게이트를
      //   띄우거나, 게이트가 자기 기록에 남는 경로가 생기거나). 이 자리 문구는 이미 "push 와 PR 은 본
      //   세션이 합니다"라는 조건 없는 단정이니 기계도 조건 없이 만든다.
      //   사람용 탈출구(CHAGEUN_SKIP_GATE_CHECK)보다 앞에 둔다: 그 스위치는 "게이트 검사를 건너뛴다"는
      //   뜻이지 "push 를 뒤에서 돌게 한다"는 뜻이 아니고, 사람은 본 세션에서 그대로 push 할 수 있다.
      //   v0.64.0 리뷰 2회차가 여기에 전용 회복 스위치(CHAGEUN_ALLOW_SUBAGENT_PUSH)를 넣었고,
      //   **3회차가 도로 뺐다.** 스위치를 켠 세션에서는 이 자리가 아래 신선도 검사로 떨어지는데,
      //   그 검사(prReviewerRan)는 게이트 호출이 **실제로 실행됐는지**(tool_result 의 is_error)를 안 본다.
      //   PreToolUse 가 막은 호출도 트랜스크립트에는 tool_use 로 남는다. 그래서 스위치를 켠 세션에서
      //   서브에이전트가 (a) 코드를 고치고 (b) 게이트를 부르려다 1.7 에 막히고 (c) 그 막힌 시도가
      //   "리뷰 흔적"이 되어 (d) push 가 통과한다: 이 절이 막으려던 바로 그 사고가 되살아난다.
      //   회복 경로는 스위치가 아니라 **사람**이다(문구 끝 안내: 본 세션인데 이게 떴으면 사람에게 알린다).
      //   다시 넣으려면 hasPrReviewer 가 is_error 를 보게 하는 일이 **먼저**다.
      if (IS_SUBAGENT) return deny("gate-skip", UNATTENDED);
      if (UNATTENDED || process.env.CHAGEUN_SKIP_GATE_CHECK !== "1") {
        if (!prReviewerRan(input.transcript_path)) return deny("gate-skip", UNATTENDED);
      }
      // SKIP_GATE=1(유인)이면 게이트 검사 생략.
    }

    // 4.6) 색 하드코딩 백스톱(hard block, Claude 전용). docs/design-system.md 있는 프로젝트에서만.
    //    P3(soft 리마인더)와 별개 채널 = 기계 강제층: raw 색이 새 코드에 박히는 순간 그 편집을 차단(exit 2).
    //    검출은 tool_input의 content/new_string만(제약: 트리 스캔 없음). Edit/MultiEdit는 old엔 없고 new에
    //    생긴 색 토큰만(브라운필드 오탐 방지). Write는 신규 파일일 때만 검사(기존 파일 통짜 덮어쓰기는 v1 미차단
    //    = 정직한 열린 구멍: old를 안 읽어 added 판정 불가). exit 2는 stderr 채널이라 §4 stdout 리마인더와
    //    충돌 없음(블록 시 리마인더 도달 전 종료). 무인·유인 모두 발동(색은 안전-park 사유는 아니나 회복
    //    가능+watchdog 바운드). 이 백스톱은 이 래퍼에만 배선. 자체 try/catch로 격리.
    if (EDIT_RE.test(String(name || "")) && isDesignScanTarget(ti.file_path || ti.notebook_path)
        && process.env.CHAGEUN_SKIP_DESIGN_LINT !== "1") {
      try {
        const cwd = input.cwd || process.cwd();
        const docText = readDesignDoc(cwd);
        if (docText != null) {
          const allow = parseAllowColors(docText);
          let viol = violationsForEdit(name, ti, allow);
          if (viol === null && String(name || "") === "Write") {
            // Write: old_string 없음 → 신규 파일(!existsSync)만 content 전체가 '새 색'으로 확실. 기존 파일은 skip.
            //   경로는 readDesignDoc과 같은 cwd 기준으로 resolve(상대경로 오판 방지: 둘의 기준 통일).
            const abs = ti.file_path ? path.resolve(cwd, ti.file_path) : null;
            viol = (abs && !fs.existsSync(abs)) ? scanColors(ti.content, allow) : [];
          }
          if (viol && viol.length) {
            const tokens = [...new Set(viol.map((v) => v.token))].slice(0, 8).join(", ");
            return deny("design-color", false, tokens);
          }
        }
      } catch (_) { /* fail-open: 백스톱 오류가 정상 작업을 막지 않는다 */ }
    }

    // 4.8) 공용 component 경계(hard block, Claude 전용): 색 검사 뒤, soft 리마인더 전에 실행한다.
    // 색 정책의 기존 우회는 그대로 두되, component 경계는 어떤 lint ignore나 env로도 우회하지 않는다.
    if (COMPONENT_EDIT_RE.test(String(name || ""))) {
      let componentEntries;
      try { componentEntries = runComponentBoundaryChannel(input, input); }
      catch (error) { componentEntries = [boundaryIssue("component-boundary-error", error.message)]; }
      if (componentEntries.length) {
        const detail = [...new Set(componentEntries.map((entry) => `${entry.code}${entry.detail ? `:${entry.detail}` : ""}`))]
          .slice(0, 8).join(", ");
        return deny("component-boundary", false, detail);
      }
    }

    // 4.8b) 상황판 하드 차단 둘(v0.65.0 F-27): **비밀 값**과 **무시가 확인 안 된 상황판**.
    //    둘 다 (1) 손해가 되돌릴 수 없고 (2) 회복이 항상 있고 밟고 나면 차단이 스스로
    //    풀리는 자리라 단다. 이 잣대를 넘는 차단은 더 안 단다.
    //    🛑 차단할 때 `deny(key, false)` 로 부른다: `true` 로 부르면 무인 문구 표에 없는
    //    열쇠라 일반 park 문구로 떨어져 **회복 문구가 통째로 사라진다**(탈출구 없는 차단이라
    //    문구가 유일한 안내다). 기존 하드 차단 둘(design-color·component-boundary)도 false 다.
    //    🛑 판정이 실패하면 유인·무인 모두 통과(§4.6 관례): 상황판은 안전 장치가 아니라
    //    편의이고, 판정을 못 했다고 작업을 막으면 안 된다.
    //    ⚠ 이 자리는 PreToolUse 훅에서 자식 프로세스를 띄우는 첫 자리다. 정상 작업에서는
    //    두 번째 조건(절대 경로)이 사실상 항상 거짓이라 git 호출이 0회다.
    let boardTarget = null;
    try {
      boardTarget = boardTargetOf(name, ti, input.cwd || process.cwd());
      if (boardTarget && boardTarget.armed) {
        const cwd = path.resolve(input.cwd || process.cwd());
        // 🛑 **비밀값 사전은 대상 파일을 따라간다.** `collectSecrets` 는 준 폴더에서 아래로만
        //    2단 훑고 위로는 안 간다: 대상이 뿌리 상황판인데 사전을 켠 폴더에서 모으면,
        //    `.env` 가 없는 작업방(git 이 안 들고 다닌다)이나 `<저장소>/frontend` 같은 하위
        //    폴더 세션에서 **목록이 비어 findLeaks 가 아예 안 불리고 편집이 그대로 나간다.**
        //    두 곳을 합친다(같은 폴더면 한 번만): 넓은 쪽이 안전측이고, 이 자리는 무장된
        //    상황판 편집일 때만 도는 곳이라 비용이 문제되지 않는다.
        const boardDir = path.dirname(boardTarget.abs);
        const secrets = cwd === boardDir
          ? collectSecrets(cwd)
          : [...collectSecrets(cwd), ...collectSecrets(boardDir)];
        const leaks = secrets.length ? findLeaks(boardNewText(name, ti), secrets) : [];
        // 값은 절대 다시 안 적는다: 걸린 **열쇠 이름만** 붙인다.
        if (leaks.length) return deny("statusboard-secret", false, [...new Set(leaks)].slice(0, 8).join(", "));
        if (boardIgnoreVerdict(path.dirname(boardTarget.abs)) === "blocked") {
          return deny("statusboard-unignored", false);
        }
      }
    } catch (_) { /* fail-open: 판정 오류가 정상 작업을 막지 않는다 */ }

    // 4) P1 리마인더(soft): plan 문서를 쓰고 plan-validator 없이 첫 코드 수정 시작 →
    //    차단 없이 리마인더 한 줄 주입(additionalContext). 자체 try/catch: 리마인더는 어떤
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
          reminderEmitted = true;
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }

    // 4.7) 디자인 레지스트리 조회 리마인더(soft, Claude 전용): UI 파일 첫 수정인데 이번 세션에
    //    design-system 레지스트리 조회 흔적이 없으면 1회 주입. P1이 이미 주입했으면 침묵(JSON 단일 write).
    //    파싱 전 isUiTarget으로 걸러 비UI 편집은 전체 파싱 안 함(비용). 자체 try/catch로 격리(무인 fail-closed로 안 샘).
    if (!reminderEmitted && EDIT_RE.test(String(name || "")) && isUiTarget(ti.file_path || ti.notebook_path)) {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "");
        if (objs && designRegistryReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: UI 파일을 만들기 전 design-system 레지스트리(디자인 규칙·부품+변형 슬롯)를 아직 확인하지 않았습니다. 규칙상 새 화면·컴포넌트는 기존 토큰·변형을 재사용해야 합니다(코어 '디자인 시스템'). design-system 스킬을 로드하거나 docs/design-system.md를 확인해, 페이지 폭·모달 등은 새로 만들지 말고 기존 것을 쓰세요(규칙 파일이 없으면 시드).",
            },
          }));
          reminderEmitted = true;
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }

    // 4.5) routing 리마인더(soft, batch6): 구현 에이전트 첫 위임 직전 chageun:routing
    //    스킬 미로드 → 리마인더 1회 주입. P1과 동일하게 자체 try/catch로 격리(예외가 무인
    //    fail-closed catch로 새어 park가 되지 않게: plan-validator medium 반영). needle 조기
    //    탈출은 못 쓴다(부재가 신호): Agent 스폰은 드물어 전체 파싱 비용 수용.
    //    v0.65.0: 판정을 spawnIntent 로 옮겼다. **`readable` 일 때만** 이 절에 들어간다:
    //    `spawnIntent !== null` 로 적으면 `Workflow` 호출에서도 여기 들어와 트랜스크립트 전체를
    //    파싱한다(실측 400ms대). 불투명 통로는 무엇을 띄우는지 못 읽으니 라우팅 판정이 성립하지 않는다.
    if (!reminderEmitted && spawn && spawn.kind === "readable") {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "");
        if (objs && routingReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: 구현 에이전트에 위임하려는데 이번 세션에 chageun:routing 스킬을 아직 로드하지 않았습니다. 규칙상 서브에이전트 위임(병렬 포함) 전 로드가 필수입니다(코어 '모델·실행 라우팅'). 지금 Skill 도구로 로드해 라우팅 표·병렬 위임 규칙을 확인한 뒤 위임하세요.",
            },
          }));
          // ⚠ v0.65.0 F-29: 이 절이 그동안 이 깃발을 **안 세우고 있었다**(확인함). 세 축이 같은 꼬리에
          //   알림을 붙이는 판이라 그대로 두면 여기서 stdout 을 쓴 뒤 아래 §4.9 가 **두 번째 write** 를
          //   내고, 뒤엣것이 무시되거나 JSON 이 깨진다. 깃발 규율은 이 파일의 기존 계약이다(:319 주석).
          reminderEmitted = true;
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }

    // 4.5b) 상황판 안내(soft · v0.65.0 F-27 주 경로). 그 세션에서 **파일을 처음 만지거나
    //    처음 위임할 때** 한 번만, 이 프로젝트에 상황판이 없다고 알린다.
    //    🛑 **막지 않는다(exit 0)**. 상황판은 안전 장치가 아니라 편의라, 없다고 편집을 막으면
    //    상황판을 안 쓰는 프로젝트가 통째로 멈춘다. stderr 는 exit 2 일 때만 Claude 에게
    //    가므로 통로는 stdout 의 additionalContext 다.
    //    🛑 **훅이 파일을 만들지 않는다.** 빈 껍데기를 만들면 그 순간 조건 (d)가 참이 되어
    //    다음부터 안내가 영영 안 나가고, §2.1 절차의 판단 걸린 갈래를 10초 제한 훅이
    //    대신 내리게 된다.
    //    🛑 앞 리마인더가 이미 나갔으면 **표식도 안 만든다**: 그래야 다음 편집에서 다시
    //    시도한다(양보는 미룸이지 취소가 아니다).
    //    ⚠ 위임 갈래에는 `file_path` 가 없다. 삼항이 빠지면 path.resolve 가 TypeError 를
    //    내고 이 절의 try/catch 가 조용히 삼켜, **위임만 하는 세션에서 안내가 영영 안 나간다.**
    //    🛑 "없다" 판정은 **켠 폴더 한 곳이 아니라** board-root-core.js 가 짓는다. 켠 폴더만
    //    보면 작업방(`<repo>/.claude/worktrees/<이름>`)이나 하위 폴더에서 켠 세션이 저장소
    //    뿌리의 상황판을 못 보고 "없으니 만들어라"를 낸다 - 세션 시작 부록은 같은 세션에서
    //    "있으니 갱신하라"를 이미 낸 뒤다. 그 말을 따르면 작업방 안에 상황판이 한 장 더 생기고
    //    기계가 채우는 칸이 새 파일로 가, 사용자가 웹으로 보던 원래 상황판이 조용히 멈춘다.
    //    🛑 갈래가 **둘**이다. 상황판이 위에 있는 세션에는 "없다"가 아니라 **다른 말**이 필요하다:
    //    그 세션은 §2 를 안 쓴다(posttooluse 의 읽기/쓰기 경계). 아무 말도 안 하면 사용자는 웹에서
    //    얼어붙은 `마지막 확인` 을 보고 "아무것도 안 돌고 있다"로 읽는다 - 얼어붙은 값은 "낡았다"
    //    로도 "안 돈다"로도 읽혀서 눈에 보이는 것만으로는 신호가 안 된다. 두 갈래는 서로
    //    배타라 세션당 한 번 규율(claimBoardNotice)은 그대로다.
    if (!reminderEmitted && !IS_SUBAGENT) {
      try {
        const cwd = path.resolve(input.cwd || process.cwd());
        const abs = ti.file_path ? path.resolve(cwd, ti.file_path) : null;   // 상대경로 오판 방지
        let msg = null;
        if (statusboardTrigger(name, abs, ti) && !boardRoot.isBoundaryDir(cwd)) {
          const dir = boardRoot.findBoardDir(cwd);
          if (dir === null) {
            msg = "차근 안내: 이 프로젝트에는 작업 상황판(`status.md`)이 없습니다. 뒤에서 돌 일이 생기거나 사용자가 결정할 것이 생기는 일이면 지금 만드는 것이 좋습니다: 파일 하나를 15분 안에 고치고 끝나는 일이면 안 만들어도 됩니다. **상황판을 만들기로 정했으면 파일부터 만들지 말고 `chageun:statusboard` 를 먼저 열어 git 무시 절차부터 밟으세요**(안 그러면 이 평문 보고서가 저장소에 올라갑니다).";
          } else if (dir !== cwd) {
            msg = "차근 안내: 이 세션의 작업 상황판은 `" + path.join(dir, boardRoot.FILE) + "` 입니다(켠 폴더가 아니라 몇 단 위입니다). **여기에 새로 만들지 마세요** - 하나 더 만들면 기계는 위 파일에 쓰고 사람 칸은 새 파일에 쌓여, 사용자가 웹에서 보는 상황판에 끝난 일이 영영 안 올라옵니다. 그리고 **이 세션은 그 파일의 §2(뒤에서 도는 것)를 갱신하지 않습니다**: 여러 세션이 같은 칸을 서로 지우지 않게 뿌리 폴더에서 켠 세션만 씁니다. §2 가 멈춰 보이면 고장이 아니라 이 사정입니다.";
          }
        }
        if (msg) {
          const key = boardNoticeKey(input);
          if (key && claimBoardNotice(key)) {
            process.stdout.write(JSON.stringify({
              hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
            }));
            reminderEmitted = true;
          }
        }
      } catch (_) { /* 안내 실패는 어떤 경우에도 차단·park 사유가 아니다 */ }
    }

    // 4.5c) 표시 없이 **지금 만드는** 편집: 차단이 아니라 안내 한 줄(v0.65.0 F-27).
    //    위 4.8b 가 내용 신호까지 보게 되면서, 스킬을 안 열고 손으로 만드는 그 편집은
    //    표시가 없어 차단에 안 걸린다. 🛑 **차단을 되돌리지 않는다**: 남의 루트
    //    `status.md` 오차단이 더 나쁘다. 대신 막지 않고 한 줄만 낸다(exit 0).
    //    🛑 **이미 있는 파일에는 안 낸다.** 남의 팀 문서를 고칠 때마다 같은 잔소리가 붙으면
    //    그것도 마찰이고, 그 파일은 이 기능과 무관하다.
    //    판정을 두 번 짜지 않는다: 4.8b 의 결과(boardTarget)를 갈라 쓰기만 하고 git 은
    //    안 부른다(내용 신호에서 이미 끝나는 자리라 비용도 그대로 0이다).
    //    🛑 **갈래가 하나 더 있다: 위에 이미 있는데 여기에 또 만드는 편집.** 사용자가 작업방
    //    안에서 직접 세션을 켜면, 모델이 스킬을 안 연 채 켠 폴더에서 못 찾아 본보기를 그대로
    //    `Write` 할 수 있다. 본보기에는 표시가 있어 `armed` 로 잡히지만 작업방은 뿌리와 같은
    //    `info/exclude` 를 공유해 무시 판정이 통과한다. 그 순간부터 `findBoardDir(작업방)` 이
    //    작업방을 가리켜 **기계가 그 파일에 §2 를 쓰고 사용자가 보는 뿌리 상황판은 조용히
    //    멈춘다**(덤으로 그 세션이 뿌리 상황판을 고칠 때의 차단 둘도 함께 사라진다).
    //    그래서 이 갈래는 `armed` 를 안 본다: 표시가 있든 없든 **여기 만들면 안 된다**가 답이다.
    //    부록에 절대 경로를 싣는 것을 미룬 동안의 임시 방벽이라 훅 문자열로만 둔다.
    //    🛑 **삼항으로 이어 붙이지 않는다.** 조건 셋을 물음표 하나로 엮었더니 어떤 입력이 어떤
    //    문구를 받는지 눈으로 셀 수 없었고, 그 자리에서 `already && !armed` 한 갈래가 **무시 절차
    //    경고를 통째로 잃었다**(3회차 게이트). 그 조합은 `armed` 가 아니라 4.8b 하드 차단도 안
    //    도는 자리라 안전 안내가 0이 된다: 뿌리 `.gitignore` 가 `/status.md` 로 앵커된 모노레포에서
    //    `<repo>/packages/api` 를 켜고 손으로 만들면, 그 경로는 무시 대상이 아닌데 아무도 안 말해
    //    평문 업무 보고가 커밋 이력에 남는다. 네 갈래를 아래 표로 못박는다:
    //      already && armed    → 이미문구(+무시절차 확인)
    //      already && !armed   → 이미문구(+무시절차 확인)   (4.8b 가 안 도는 자리 - 여기가 뚫렸던 곳)
    //      !already && armed   → 조용(4.8b 가 이미 봤다)
    //      !already && !armed  → 무시절차(먼저 밟으세요)
    //    `already` 에 무시절차 언급을 **조건 없이** 붙이는 이유: 조건을 하나 더 달면 그 조건이
    //    다음에 또 한 갈래를 삼킨다. 둘 다 소프트 안내라 붙여도 마찰이 안 는다.
    //    🛑 **`already` 갈래의 뒷문장은 "먼저 밟으세요"가 아니라 "확인하세요"다.** "여기에 새로
    //    만들지 말라"는 앞문장과 "절차를 먼저 밟으라"는 뒷문장을 나란히 두면, 읽는 쪽이 "절차
    //    밟고 나서 여기 만들라"로 읽어 상황판이 두 권이 된다. 게다가 이 갈래에 닿았다는 것 자체가
    //    대개 git 이 이미 무시하고 있다는 뜻이라 "먼저 밟으세요"는 사실과도 어긋난다(실행 재현
    //    완료, 4회차 게이트 지적). `!already` 갈래(IGNORE_LINE)는 실제로 아직 안 밟았을 자리라
    //    그대로 "먼저 밟으세요"를 쓴다.
    if (!reminderEmitted && boardTarget && !boardTarget.exists) {
      try {
        const cwd = path.resolve(input.cwd || process.cwd());
        // 켠 폴더에 **새로** 만드는 편집인가, 그렇다면 위에 이미 한 장 있는가.
        const upper = boardTarget.abs === path.join(cwd, BOARD_FILE)
          ? boardRoot.findBoardDir(cwd) : null;
        const already = upper !== null && upper !== cwd;
        const IGNORE_LINE = "차근 안내: 이 파일은 저장소에 올라갈 수 있습니다 - `chageun:statusboard` 의 무시 절차를 먼저 밟으세요.";
        const ALREADY_IGNORE_TAIL = "혹시 이미 만들었다면, 그 파일은 저장소에 올라갈 수 있습니다 - `chageun:statusboard` 의 무시 절차를 확인하세요.";
        let msg = null;
        if (already) {
          msg = "차근 안내: 이미 `" + path.join(upper, BOARD_FILE) + "` 에 이 프로젝트의 작업 상황판이 있습니다. **여기에 새로 만들지 말고 그 파일을 고치세요.** 하나 더 만들면 기계가 채우는 칸은 새 파일로 가고, 사용자가 웹에서 보던 원래 상황판은 그 자리에서 멈춥니다. " + ALREADY_IGNORE_TAIL;
        } else if (!boardTarget.armed) {
          msg = IGNORE_LINE;
        }
        if (msg) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
          }));
          reminderEmitted = true;
        }
      } catch (_) { /* 안내 실패는 차단 사유가 아니다 */ }
    }

    // 4.9) 목록 밖 도구 알림(soft · v0.65.0 F-29 층3). **가장 낮은 우선순위**: "그 밖에 할 말이
    //    없을 때"만 나간다. 상황판(F-27)이 자기 안내를 붙일 때 이 순서를 전제한다.
    //    🛑 **어떤 경우에도 exit 2 를 내지 않는다.** 모르는 도구를 막으면 판올림마다 사용자 작업이
    //    멈춘다(이 저장소의 최대 실패 양식은 오차단이다). 자체 try/catch 로 격리해 예외가 무인
    //    fail-closed catch 로 새지 않게 한다: 알림 실패가 park 사유가 되면 안 된다.
    //    🛑 **세션 dedup 을 하지 않는다.** 상태 파일이 없어 못 하기도 하고(결정 1번: 파일 안 만듦),
    //    안 하는 편이 낫다: 같은 도구가 다시 쓰이면 다시 알린다. dedup 이 없으니 **소음의 유일한
    //    방어선은 스폰꼴 열쇠 목록**이고, 그래서 거기서 `code`·`script` 를 뺐다(tool-ledger-core.js).
    //    비용: 집합 조회 1번. 파일도 트랜스크립트도 안 읽는다.
    if (!reminderEmitted) {
      try {
        const unknown = unknownToolNotice(name, ti);
        if (unknown && unknown.spawnShaped) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: unknownToolMessage(unknown.name),
            },
          }));
          reminderEmitted = true;
        }
      } catch (_) { /* 알림 실패가 차단 사유가 되지는 않는다 */ }
    }
  } catch (_) {
    // 무인: 판정 중 예외 = 불확실 = 안전측(park). 유인: 기존대로 fail-open(사람이 백스톱).
    // 🛑 v0.65.0: 여기서 조건을 **뒤집어** 적는다. 그냥 `옛 집합.test(name)` 으로 쓰면
    //   **fail-closed 가 fail-open 으로 뒤집힌다**: 이 catch 가 잡는 **대표 경우가 입력 JSON
    //   파싱 실패**이고, 그때는 도구 이름이 아예 없다. 빈 이름은 옛 집합에 안 맞아 통과해 버리는데
    //   **지금은 park 하는 자리**다. 규칙 한 문장: **"도구 이름을 못 읽었으면 옛 집합에 있는 것으로 본다."**
    //   검사 = test/hook-net.test.mjs 의 무인 (라).
    if (UNATTENDED && (!name || LEGACY_UNATTENDED_SCOPE.test(String(name)))) {
      process.stderr.write(reasonForUnattended("u-error")); process.exit(2);
    }
  }
  process.exit(0);
});
