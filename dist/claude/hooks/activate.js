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
  for (const a of core.APPENDICES) {
    if (!a.applies({ env: process.env })) continue;
    try {
      appendixTexts.push(fs.readFileSync(path.join(root, "rules", a.file), "utf8"));
    } catch (_) {
      // 부록 읽기 실패해도 코어 규칙 주입은 유지(안전 우선).
    }
  }
  process.stdout.write(core.assemble({ rulesText, n, rulesPath, appendixTexts }));
} catch (e) {
  // stdout 문구는 그대로 둔다(옛 설치본과 같은 안내). stderr 만 원인을 넓혀 적는다 —
  // 이제 규칙 파일 읽기뿐 아니라 activate-core.js 로드 실패도 여기로 온다.
  process.stderr.write("chageun: 규칙 주입 실패(rules 또는 activate-core.js): " + e.message + "\n");
  process.stdout.write("차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.");
}
