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

// SKILL.md의 YAML frontmatter(--- ... ---)를 벗기고 본문만 반환.
// 스킬 시스템 어휘("발동한다" 등)가 스킬 메커니즘 없는 Codex에 지시문으로 새지 않게 한다.
function stripFrontmatter(t) {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(t || "");
  return m ? t.slice(m[0].length).trimStart() : (t || "");
}
// Claude는 이 절차 스킬을 트리거 시 지연로드하지만 Codex는 자동발동이 없어 본문을 인라인한다(단일원본=SKILL.md).
const procSkills = ["finish-check", "spec-gate", "run-verify"];
let procBodies = "";
for (const s of procSkills) {
  const skillBody = stripFrontmatter(readSafe(path.join(root, "skills", s, "SKILL.md")));
  if (skillBody) procBodies += "\n\n---\n\n" + skillBody;
}

const body = rules
  ? ("차근 워크플로우 활성. 아래 운영 규칙을 이번 세션 내내 따른다:\n\n" + rules + (addendum ? "\n\n---\n\n" + addendum : "") + procBodies)
  : "차근: 운영 규칙 파일을 찾지 못함. 설치를 확인하세요.";

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: body }
}));
