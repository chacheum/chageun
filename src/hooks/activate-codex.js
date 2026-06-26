import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
function readSafe(p) { try { return fs.readFileSync(p, "utf8"); } catch (_) { return ""; } }

const rules = readSafe(path.join(root, "rules", "operating-rules.md"));
const addendum = readSafe(path.join(root, "codex", "operating-rules-addendum.md"));
const body = rules
  ? ("차근 워크플로우 활성. 아래 운영 규칙을 이번 세션 내내 따른다:\n\n" + rules + (addendum ? "\n\n---\n\n" + addendum : ""))
  : "차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.";

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: body }
}));
