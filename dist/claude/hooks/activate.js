const fs = require("fs");
const path = require("path");

const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
const rules = path.join(root, "rules", "operating-rules.md");

try {
  let text = fs.readFileSync(rules, "utf8");
  // 무인 세션에서만 무인 상세를 덧붙인다(일반 세션 상시 비용 0).
  if (process.env.CHAGEUN_UNATTENDED === "1") {
    try {
      const appendix = fs.readFileSync(path.join(root, "rules", "unattended-appendix.md"), "utf8");
      text += "\n\n---\n\n" + appendix;
    } catch (_) {
      // appendix 읽기 실패해도 코어 규칙 주입은 유지(안전 우선).
    }
  }
  process.stdout.write(
    "차근 워크플로우 활성. 아래 운영 규칙을 이번 세션 내내 따른다:\n\n" + text
  );
} catch (e) {
  process.stderr.write("chageun: operating-rules.md 읽기 실패: " + e.message + "\n");
  process.stdout.write("차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.");
}
