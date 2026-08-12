const fs = require("fs");
const path = require("path");
const core = require("./activate-core.js");

// SessionStart 훅. 인자로 조각 번호(1~6)를 받아 **그 조각 하나만** 낸다.
// 인자가 없으면 옛날처럼 전부 낸다 — 설치본 배선이 옛것이어도 침묵하지 않게(오늘과 같이 잘리지만
// 아무것도 안 나가는 것보다는 낫다). 조립은 전부 코어에 맡기고 여기서는 파일 읽기와 env 판정만 한다.
const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
const rulesPath = path.join(root, "rules", "operating-rules.md");
const arg = process.argv[2];
const n = arg === undefined || arg === "" ? null : Number(arg);

try {
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
  process.stderr.write("chageun: operating-rules.md 읽기 실패: " + e.message + "\n");
  process.stdout.write("차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.");
}
