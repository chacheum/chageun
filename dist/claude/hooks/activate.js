const fs = require("fs");
const path = require("path");

// SessionStart 훅. 인자로 조각 번호(1~6)를 받아 **그 조각 하나만** 낸다.
// 인자가 없으면 옛날처럼 전부 낸다: 설치본 배선이 옛것이어도 침묵하지 않게(오늘과 같이 잘리지만
// 아무것도 안 나가는 것보다는 낫다). 조립은 전부 코어에 맡기고 여기서는 파일 읽기와 env 판정만 한다.
const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
const rulesPath = path.join(root, "rules", "operating-rules.md");
const arg = process.argv[2];
const n = arg === undefined || arg === "" ? null : Number(arg);

const MAX_HEAD = 512 * 1024;   // 표시는 파일 앞쪽에 있다(§4 안전 바닥과 같은 상한)

// 큰 파일을 통째로 안 읽는다: 크기를 먼저 보고 앞부분만 가져온다.
function head(file, max) {
  const len = Math.max(0, Math.min(fs.statSync(file).size, max));
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf.toString("utf8");
  } finally { fs.closeSync(fd); }
}

// 표시 한 벌이 **짝으로 정확히 하나씩**, 여는 것이 먼저일 때만 온전하다고 본다.
function pairOk(text, open, close) {
  const a = text.indexOf(open), b = text.indexOf(close);
  if (a === -1 || b === -1 || b < a) return false;
  return text.indexOf(open, a + 1) === -1 && text.indexOf(close, b + 1) === -1;
}

// 두 벌(§2 · 머리)이 다 온전한가. 🛑 읽기 실패는 침묵이다: 못 읽으면 안내를 안 붙이고
// 나머지 부록은 그대로 간다(없는 사실을 지어내지 않는다).
function markersIntact(file) {
  let text;
  try { text = head(file, MAX_HEAD); } catch (_) { return true; }
  return pairOk(text, "<!-- chageun:auto -->", "<!-- /chageun:auto -->")
    && pairOk(text, "<!-- chageun:auto:head -->", "<!-- /chageun:auto:head -->");
}

try {
  // 🛑 `require` 도 이 안이다. 최상위 require 는 **모듈 로드 시점**에 던져서 이 파일 안 어떤
  //    try/catch 도 못 잡는다. 밖에 두면 activate-core.js 하나가 없어질 때(업데이트 중단·백신 격리)
  //    훅 6개가 전부 아무 글도 안 내고 아래 안내까지 함께 사라진다: 세션은 멀쩡히 시작되는데
  //    규칙이 한 줄도 안 닿는다. 소스에는 파일이 늘 있어 **배포판에서만 죽는다.**
  const core = require("./activate-core.js");
  const rulesText = fs.readFileSync(rulesPath, "utf8");
  // 부록 판정에 필요한 **바깥 사실**을 여기서 모은다. 코어(activate-core.js)는 순수 함수라
  // fs 를 못 쓴다: 파일이 있는지·표식이 온전한지는 이 자리에서만 알 수 있다.
  // 🛑 상황판이 없는 프로젝트의 상시 비용은 `existsSync` **최대 12번**이다(켠 폴더부터 경계까지
  //    한 단씩 - board-root-core.js 의 MAX_UP). 켠 폴더 한 번만 보면 작업방·하위 폴더에서
  //    켠 세션이 있는 상황판을 "없다"고 판정한다. 표식 판정(파일 읽기)은 상황판이 있을 때만 한다.
  // 🛑 이 판정을 여기서 다시 짜지 않는다: pretooluse 안내 · posttooluse 자동 갱신과 **같은 답**이
  //    나와야 한 세션 안에서 두 지시가 어긋나지 않는다.
  // 🛑 **require 를 이 갈래 안에 가둔다.** 위 core 처럼 바깥에 두면 이 파일 하나가 없어질 때
  //    (업데이트 중단·백신 격리) 규칙 6조각이 **전부** 대신 안내 한 줄로 바뀐다. 상황판은
  //    편의고 무인 부록은 안전이라, 편의 모듈 하나가 안전 상세를 데려가면 안 된다.
  //    못 부르면 "상황판 없음"으로 본다: 부록 한 조각을 잃지 규칙을 잃지 않는다.
  let boardPath = null;
  try {
    boardPath = require("./board-root-core.js").findBoardPath(process.cwd());
  } catch (err) {
    process.stderr.write("chageun: 상황판 판정 모듈을 못 불렀다(board-root-core.js): " + err.message + "\n");
  }
  const hasBoard = boardPath !== null;
  // CLAUDE_PLUGIN_ROOT 는 Bash 도구에서 비어 있다(실측). 훅에서는 채워지므로 그때
  // 절대 경로를 박아 넣어 그 구멍을 피한다.
  // 조립은 core.buildCtx 에 맡긴다: 등록부의 sampleCtx/sampleCtxOff(test/rule-pieces.test.mjs)가
  // 이 함수의 결과 칸과 이름을 대조할 수 있어야 하기 때문이다. 값·칸은 그대로다(자리만 옮겼다).
  const ctx = core.buildCtx({
    env: process.env,
    board: hasBoard,
    boardMarkersIntact: hasBoard ? markersIntact(boardPath) : true,
    boardServer: path.join(root, "skills", "statusboard", "board-server.mjs"),
  });
  // 조건이 맞는 부록만 읽는다(일반 세션 상시 비용 0).
  // 🛑 부록은 **반드시 이 등록부를 지난다.** 여기 말고 다른 자리에서 파일을 하나 더 이어 붙이면
  //    그 글은 실제로 주입되면서 조합 매트릭스에도 바이트 예산에도 안 잡힌다
  //    (test/rule-pieces.test.mjs 가 src/rules 파일 목록과 양방향으로 대조하는 이유다).
  const appendixTexts = [];
  const appendixMissing = [];
  for (const a of core.APPENDICES) {
    if (!a.applies(ctx)) continue;
    try {
      const raw = fs.readFileSync(path.join(root, "rules", a.file), "utf8");
      // 다듬기(자리표시자·조건부 한 줄)도 코어가 한다: 훅과 검사가 **같은 함수**를 불러야
      // 검사가 재는 글이 실제 주입되는 글과 같다.
      appendixTexts.push(a.render(raw, a.variantOf(ctx), ctx));
    } catch (err) {
      // 부록 읽기 실패해도 코어 규칙 주입은 유지(안전 우선): 조각 1~5 는 코어가 본체다.
      // 단 조각 6 은 **부록이 전부**라 여기서 삼키면 완전 침묵이 된다. 아래에서 안내를 낸다.
      appendixMissing.push(a.file);
      process.stderr.write("chageun: 부록 읽기 실패(" + a.file + "): " + err.message + "\n");
    }
  }
  let out = core.assemble({ rulesText, n, rulesPath, appendixTexts });
  // 🛑 조건이 맞아 **주입돼야 할** 부록을 못 읽었는데 조각 6이 조용히 빈 값을 내면, 나머지 5조각이
  //    멀쩡히 도착해 세션은 완전히 정상으로 보인다. 하필 그 조각이 무인 세션의 유일한 안전 상세
  //    (멈추는 법 · 8시간/2,000번 한도 · 바깥 통신 차단의 한계)라, 사람 없이 도는 세션에서
  //    그것만 통째로 빠진다: 알아챌 사람이 자리에 없다. 조건이 안 맞아 안 읽은 부록은 결손이
  //    아니므로(평시 세션) 여기 안 걸린다.
  if (n === core.APPENDIX_PIECE && appendixMissing.length) {
    const notice = "차근: 이번 세션에 필요한 규칙 부록(" + appendixMissing.join(", ") +
      ")을 찾지 못함. 설치를 확인하세요.";
    out = out ? out + "\n\n" + notice : notice;
  }
  process.stdout.write(out);
} catch (e) {
  // stdout 문구는 그대로 둔다(옛 설치본과 같은 안내). stderr 만 원인을 넓혀 적는다:
  // 이제 규칙 파일 읽기뿐 아니라 activate-core.js 로드 실패도 여기로 온다.
  process.stderr.write("chageun: 규칙 주입 실패(rules 또는 activate-core.js): " + e.message + "\n");
  process.stdout.write("차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.");
}
