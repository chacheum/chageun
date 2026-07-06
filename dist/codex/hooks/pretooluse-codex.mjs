// chageun pretooluse (Codex PreToolUse 훅). 판정은 Claude판과 같은 pretooluse-core.js 재사용 —
// 정규식 중복 금지(미러 표류 방지). 차단은 Codex 문서 정식 형태(permissionDecision deny).
// Codex 훅은 guardrail(문서 자인: unified_exec 등 미가로채기 경로 존재) — 텍스트 멈춤 규칙이 1차 방어.
// 셸 도구명 "Bash"·MCP tool_input 형태는 공식 문서(2026-07-06) 기준이며 실기기 미검증(끝 점검 표기).
// 무인 분기 없음(Codex 무인 미지원). 예외·불확실은 전부 안전 통과(유인 fail-open).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { block, reasonFor } = require("./pretooluse-core.js");

export function decidePre(input, env = {}) {
  const name = input && input.tool_name;
  const ti = (input && input.tool_input) || {};
  const hit = block(name, ti);
  if (!hit) return { deny: false };
  if (hit === "deploy" && env.CHAGEUN_ALLOW_DEPLOY === "1") return { deny: false };
  return { deny: true, reason: reasonFor(hit) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const r = decidePre(JSON.parse(raw), process.env);
      if (r.deny) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r.reason },
        }));
      }
    } catch (_) { /* 안전 통과 */ }
    process.exit(0);
  });
}
