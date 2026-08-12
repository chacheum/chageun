const fs = require("fs");
const path = require("path");

// SessionStart 훅. 인자로 조각 번호(1~6)를 받아 **그 조각 하나만** 낸다.
// 인자가 없으면 옛날처럼 전부 낸다 — 설치본 배선이 옛것이어도 침묵하지 않게(오늘과 같이 잘리지만
// 아무것도 안 나가는 것보다는 낫다). 조립은 전부 코어에 맡기고 여기서는 파일 읽기와 env 판정만 한다.
const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
const rulesPath = path.join(root, "rules", "operating-rules.md");
const arg = process.argv[2];
const n = arg === undefined || arg === "" ? null : Number(arg);

try {
  // 🛑 `require` 도 이 안이다. 최상위 require 는 **모듈 로드 시점**에 던져서 이 파일 안 어떤
  //    try/catch 도 못 잡는다. 밖에 두면 activate-core.js 하나가 없어질 때(업데이트 중단·백신 격리)
  //    훅 6개가 전부 아무 글도 안 내고 아래 안내까지 함께 사라진다 — 세션은 멀쩡히 시작되는데
  //    규칙이 한 줄도 안 닿는다. 소스에는 파일이 늘 있어 **배포판에서만 죽는다.**
  const core = require("./activate-core.js");
  const rulesText = fs.readFileSync(rulesPath, "utf8");
  // 조건이 맞는 부록만 읽는다(일반 세션 상시 비용 0).
  const appendixTexts = [];
  const appendixMissing = [];
  for (const a of core.APPENDICES) {
    if (!a.applies({ env: process.env })) continue;
    try {
      appendixTexts.push(fs.readFileSync(path.join(root, "rules", a.file), "utf8"));
    } catch (err) {
      // 부록 읽기 실패해도 코어 규칙 주입은 유지(안전 우선) — 조각 1~5 는 코어가 본체다.
      // 단 조각 6 은 **부록이 전부**라 여기서 삼키면 완전 침묵이 된다. 아래에서 안내를 낸다.
      appendixMissing.push(a.file);
      process.stderr.write("chageun: 부록 읽기 실패(" + a.file + "): " + err.message + "\n");
    }
  }
  let out = core.assemble({ rulesText, n, rulesPath, appendixTexts });
  // 🛑 조건이 맞아 **주입돼야 할** 부록을 못 읽었는데 조각 6이 조용히 빈 값을 내면, 나머지 5조각이
  //    멀쩡히 도착해 세션은 완전히 정상으로 보인다. 하필 그 조각이 무인 세션의 유일한 안전 상세
  //    (멈추는 법 · 8시간/2,000번 한도 · 바깥 통신 차단의 한계)라, 사람 없이 도는 세션에서
  //    그것만 통째로 빠진다 — 알아챌 사람이 자리에 없다. 조건이 안 맞아 안 읽은 부록은 결손이
  //    아니므로(평시 세션) 여기 안 걸린다.
  if (n === core.APPENDIX_PIECE && appendixMissing.length) {
    const notice = "차근: 이번 세션에 필요한 규칙 부록(" + appendixMissing.join(", ") +
      ")을 찾지 못함. 설치를 확인하세요.";
    out = out ? out + "\n\n" + notice : notice;
  }
  process.stdout.write(out);
} catch (e) {
  // stdout 문구는 그대로 둔다(옛 설치본과 같은 안내). stderr 만 원인을 넓혀 적는다 —
  // 이제 규칙 파일 읽기뿐 아니라 activate-core.js 로드 실패도 여기로 온다.
  process.stderr.write("chageun: 규칙 주입 실패(rules 또는 activate-core.js): " + e.message + "\n");
  process.stdout.write("차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.");
}
