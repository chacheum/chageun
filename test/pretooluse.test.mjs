import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { block, isPrCreate, hasPrReviewer } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));

const bash = (command) => block("Bash", { command });
const sql = (query) => block("mcp__plugin_supabase_supabase__execute_sql", { query });

test("git push --force 차단 · --force-with-lease 허용", () => {
  assert.equal(bash("git push --force origin main"), "force-push");
  assert.equal(bash("git push -f origin main"), "force-push");
  assert.equal(bash("git push --force-with-lease origin main"), null, "force-with-lease는 허용");
  assert.equal(bash("git push origin main"), null);
});

test("rm 재귀삭제: 루트/홈/현재트리 차단 · 하위 경로 허용", () => {
  assert.equal(bash("rm -rf /"), "rm-recursive");
  assert.equal(bash("rm -rf ~"), "rm-recursive");
  assert.equal(bash("rm -fr /*"), "rm-recursive");
  assert.equal(bash("rm -rf ."), "rm-recursive");
  assert.equal(bash("rm -rf ~/"), "rm-recursive", "홈 루트");
  assert.equal(bash("rm -rf ./build"), null, "구체 하위 경로는 허용");
  assert.equal(bash("rm -rf node_modules"), null);
  assert.equal(bash("rm file.txt"), null);
});

test("파괴적 SQL: Bash(SQL클라이언트)·MCP 차단, 안전 쿼리 허용", () => {
  assert.equal(bash('psql -c "DROP TABLE users"'), "sql-destructive");
  assert.equal(sql("DROP TABLE users"), "sql-destructive");
  assert.equal(sql("TRUNCATE TABLE orders"), "sql-destructive");
  assert.equal(sql("DELETE FROM users"), "sql-delete-no-where");
  assert.equal(sql("DELETE FROM users WHERE id = 1"), null, "WHERE 있으면 허용");
  assert.equal(sql("SELECT * FROM users"), null);
  assert.equal(sql("UPDATE users SET name='x' WHERE id=1"), null);
});

test("SQL: 다중문장 우회 방지 + 주석 무시", () => {
  // 뒤 문장의 무관한 WHERE로 앞의 전체삭제가 통과하면 안 됨.
  assert.equal(sql("DELETE FROM users; SELECT * FROM logs WHERE id=1"), "sql-delete-no-where");
  assert.equal(sql("SELECT 1; DELETE FROM orders WHERE id=1"), null, "각 문장이 안전하면 통과");
  assert.equal(sql("DELETE FROM users -- WHERE 절 나중에"), "sql-delete-no-where", "주석 속 WHERE는 무효");
});

test("관계없는 도구·명령·문자열 속 SQL어는 통과(오탐 방지)", () => {
  assert.equal(block("Read", { file_path: "/x" }), null);
  assert.equal(bash("ls -la"), null);
  assert.equal(bash("npm test"), null);
  assert.equal(bash("git commit -m 'fix DROP TABLE parsing bug'"), null, "커밋 메시지의 DROP은 오탐 아님");
  assert.equal(bash("echo 'DELETE FROM cache'"), null, "SQL 클라이언트 아니면 미검사");
});

test("배포·publish CLI 차단 · 프리뷰/dry-run 통과", () => {
  assert.equal(bash("vercel --prod"), "deploy");
  assert.equal(bash("netlify deploy --prod"), "deploy");
  assert.equal(bash("fly deploy"), "deploy");
  assert.equal(bash("npm publish"), "deploy");
  assert.equal(bash("gh release create v1.0"), "deploy");
  assert.equal(bash("supabase db push"), "deploy");
  assert.equal(bash("vercel"), null, "프리뷰 배포는 통과");
  assert.equal(bash("npm publish --dry-run"), null, "dry-run 통과");
  assert.equal(bash("npm publish && echo --dry-run"), "deploy", "무관 세그먼트의 --dry-run으로 우회 불가");
  assert.equal(bash("wrangler deploy"), "deploy");
  assert.equal(bash("wrangler tail deploy-logs"), null, "wrangler 로그조회는 오탐 아님");
});

test("isPrCreate: gh pr create/merge만 감지", () => {
  assert.equal(isPrCreate("Bash", { command: "gh pr create --fill" }), true);
  assert.equal(isPrCreate("Bash", { command: "gh pr merge 12" }), true);
  assert.equal(isPrCreate("Bash", { command: "gh pr list" }), false);
  assert.equal(isPrCreate("Bash", { command: "git push" }), false);
});

test("hasPrReviewer: 실제 Task 실행만 감지(문자열 언급 무시)", () => {
  const ran = [{ message: { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "chageun:pr-reviewer" } }] } }];
  const mentionOnly = [{ message: { role: "assistant", content: [{ type: "text", text: "pr-reviewer 게이트를 거치겠습니다" }] } }];
  assert.equal(hasPrReviewer(ran), true);
  assert.equal(hasPrReviewer(mentionOnly), false, "언급만으론 흔적 아님");
  assert.equal(hasPrReviewer([]), false);
});

test("무인 Bash: 모든 push·프리뷰배포·의존성설치 차단", () => {
  const { unattendedBlock } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
  const ub = (command) => unattendedBlock("Bash", { command }, {});
  assert.equal(ub("git push origin main"), "u-push", "무인은 force 아니어도 push 차단");
  assert.equal(ub("git push --force-with-lease origin main"), "u-push");
  assert.equal(ub("vercel"), "u-deploy", "프리뷰 배포도 무인 차단");
  assert.equal(ub("netlify deploy"), "u-deploy");
  assert.equal(ub("npm publish --dry-run"), "u-deploy", "무인은 dry-run도 차단");
  assert.equal(ub("npm install left-pad"), "u-install");
  assert.equal(ub("yarn add react"), "u-install");
  assert.equal(ub("npm ci"), null, "락파일 재설치는 허용");
  assert.equal(ub("npm install"), null, "인자없는 install(락파일 기반)은 허용");
  assert.equal(ub("npm test"), null);
  assert.equal(ub("ls -la"), null);
});
