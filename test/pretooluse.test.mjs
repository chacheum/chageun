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

test("무인 DB: 모든 쓰기 SQL 차단(읽기는 허용)", () => {
  const { unattendedBlock } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
  const ub = (query) => unattendedBlock("mcp__plugin_supabase_supabase__execute_sql", { query }, {});
  assert.equal(ub("INSERT INTO users(name) VALUES('x')"), "u-db-write", "유인은 통과하지만 무인은 INSERT 차단");
  assert.equal(ub("UPDATE users SET name='x' WHERE id=1"), "u-db-write", "WHERE 있어도 무인은 차단");
  assert.equal(ub("DELETE FROM users WHERE id=1"), "u-db-write");
  assert.equal(ub("CREATE TABLE t(id int)"), "u-db-write");
  assert.equal(ub("ALTER TABLE t ADD c int"), "u-db-write");
  assert.equal(ub("SELECT * FROM users"), null, "읽기는 허용");
  assert.equal(ub("EXPLAIN SELECT 1"), null);
  assert.equal(ub("SELECT 1; INSERT INTO t VALUES(1)"), "u-db-write", "다중문장 중 하나라도 쓰기면 차단");
});

test("무인 경로가드: worktree 밖·보호경로·동결기준 차단", () => {
  const { unattendedBlock } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
  const opts = { worktreeRoot: "/work/wt", criteriaPath: "criteria.md" };
  const w = (file_path) => unattendedBlock("Write", { file_path }, opts);
  assert.equal(w("/work/wt/src/app.js"), null, "트리 안 쓰기는 허용");
  assert.equal(w("src/app.js"), null, "상대경로(트리 기준)는 허용");
  assert.equal(w("/work/other/x.js"), "u-out-of-tree", "트리 밖 절대경로 차단");
  assert.equal(w("../other/x.js"), "u-out-of-tree", "상위 탈출 차단");
  assert.equal(w("/work/wt/.claude/settings.json"), "u-protected-path", ".claude 보호");
  assert.equal(w("/work/wt/hooks/pretooluse.js"), "u-protected-path", "훅 자체 보호");
  assert.equal(w("/work/wt/criteria.md"), "u-frozen-criteria", "동결된 성공기준 보호");
  assert.equal(unattendedBlock("Read", { file_path: "/work/other/x" }, opts), null, "읽기 도구는 무관");
});

test("무인 사유문: 모든 무인 키에 메시지 + 우회 안내 없음", () => {
  const { reasonForUnattended } = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
  for (const k of ["u-push","u-deploy","u-db-write","u-install","u-out-of-tree","u-protected-path","u-frozen-criteria","u-pr"]) {
    const m = reasonForUnattended(k);
    assert.match(m, /park/, `${k} 메시지에 park 안내`);
    assert.doesNotMatch(m, /CHAGEUN_(ALLOW|SKIP)/, `${k} 메시지에 우회 env 노출 금지`);
    assert.doesNotMatch(m, /=1/, `${k} 메시지에 우회 방법 금지`);
  }
});

test("무인 우회 방지: push/설치/배포/SQL/경로 강화", () => {
  const CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js");
  const { unattendedBlock } = require(CORE);
  const ub = (command) => unattendedBlock("Bash", { command }, {});
  assert.equal(ub("git -C /some/dir push origin main"), "u-push");
  assert.equal(ub("git --git-dir=/x push"), "u-push");
  assert.equal(ub("git log --oneline"), null, "push 아닌 git은 통과");
  assert.equal(ub("npm install --save-dev foo"), "u-install");
  assert.equal(ub("npm i -D foo"), "u-install");
  assert.equal(ub("yarn global add foo"), "u-install");
  assert.equal(ub("npm --prefix . install foo"), "u-install");
  assert.equal(ub("npm ci"), null);
  assert.equal(ub("npm install"), null);
  assert.equal(ub("echo done-vercel-setup"), "u-deploy", "안전 우선: 셸 래퍼 우회 차단 위해 vercel 문자열은 과차단(park) 감수");
  assert.equal(ub("vercel --prod"), "u-deploy");
  const sqlw = (q) => unattendedBlock("mcp__x_execute_sql", { query: q }, {});
  assert.equal(sqlw("IN/**/SERT INTO t VALUES(1)"), "u-db-write", "코멘트 분절 우회 차단");
  assert.equal(sqlw("SELECT * INTO new_t FROM t"), "u-db-write", "SELECT INTO는 쓰기");
  assert.equal(sqlw("SELECT * FROM t"), null);
  const opts = { worktreeRoot: "/work/wt", criteriaPath: "criteria.md" };
  const w = (f) => unattendedBlock("Write", { file_path: f }, opts);
  assert.equal(w("/work/wt/.Claude/x"), "u-protected-path", "대소문자 무관 보호");
  assert.equal(w("/work/wt/CRITERIA.MD"), "u-frozen-criteria");
  assert.equal(unattendedBlock("MultiEdit", { file_path: "/work/other/x" }, opts), "u-out-of-tree", "MultiEdit도 가드");
  assert.equal(ub('sh -c "vercel --prod"'), "u-deploy", "셸 래퍼로 감싼 배포도 차단");
  assert.equal(ub("bunx vercel --prod"), "u-deploy");
  assert.equal(ub("yarn dlx vercel --prod"), "u-deploy");
  assert.equal(ub("env vercel --prod"), "u-deploy");
  assert.equal(ub("npm run i-love-cats"), null, "스크립트명 속 i는 오탐 아님");
});

test("무인 최종보강: git -c push·Bash DML·MCP쓰기·멀티생태계 설치 차단", () => {
  const CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js");
  const { unattendedBlock } = require(CORE);
  const ub = (command) => unattendedBlock("Bash", { command }, {});
  // C1
  assert.equal(ub("git -c user.name=x push origin main"), "u-push");
  assert.equal(ub("git -c http.extraHeader=A push"), "u-push");
  assert.equal(ub("git log --oneline"), null);
  // C2 (Bash SQL 클라이언트 DML)
  assert.equal(ub('psql -c "INSERT INTO users VALUES(1)"'), "u-db-write");
  assert.equal(ub('mysql -e "UPDATE t SET x=1 WHERE id=1"'), "u-db-write");
  assert.equal(ub('psql -c "SELECT * FROM t"'), null, "Bash 읽기 쿼리는 허용");
  // I2 (멀티 생태계 설치)
  assert.equal(ub("pip install requests"), "u-install");
  assert.equal(ub("cargo add serde"), "u-install");
  assert.equal(ub("go get github.com/x/y"), "u-install");
  assert.equal(ub("gem install rails"), "u-install");
  assert.equal(ub("npx create-react-app foo"), "u-install");
  // I1 (MCP 쓰기/파괴 도구)
  assert.equal(unattendedBlock("mcp__plugin_supabase_supabase__deploy_edge_function", {}, {}), "u-mcp-write");
  assert.equal(unattendedBlock("mcp__plugin_supabase_supabase__delete_branch", {}, {}), "u-mcp-write");
  assert.equal(unattendedBlock("mcp__plugin_supabase_supabase__restore_project", {}, {}), "u-mcp-write");
  assert.equal(unattendedBlock("mcp__plugin_supabase_supabase__list_tables", {}, {}), null, "MCP 읽기(list)는 허용");
  assert.equal(unattendedBlock("mcp__plugin_supabase_supabase__get_logs", {}, {}), null, "MCP 읽기(get)는 허용");
});

test("무인: 중첩 claude/codex 실행 + .chageun 제어파일 변형 차단", () => {
  const CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js");
  const { unattendedBlock } = require(CORE);
  const ub = (command) => unattendedBlock("Bash", { command }, {});
  // 중첩 claude/codex (env 없는 자식으로 탈출)
  assert.equal(ub('claude -p "git push origin main"'), "u-nested");
  assert.equal(ub("codex exec 'deploy'"), "u-nested");
  assert.equal(ub("echo claude"), null, "문자열 언급은 오탐 아님");
  // .chageun 제어파일 변형(통과표/STOP 위조·삭제 시도)
  assert.equal(ub("rm .chageun/STOP"), "u-protected-path");
  assert.equal(ub("rm -f .chageun/token"), "u-protected-path");
  assert.equal(ub("echo x > .chageun/token"), "u-protected-path");
  assert.equal(ub("mv .chageun/token /tmp/t"), "u-protected-path");
  assert.equal(ub("cat .chageun/token"), null, "읽기는 허용");
  // Write 도구로 .chageun 쓰기도 보호
  assert.equal(unattendedBlock("Write", { file_path: "/w/.chageun/token" }, { worktreeRoot: "/w" }), "u-protected-path");
});

test("무인 보강: .chageun 세그먼트/인터프리터 우회 차단 + nested 정밀화", () => {
  const CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js");
  const { unattendedBlock } = require(CORE);
  const ub = (c) => unattendedBlock("Bash", { command: c }, {});
  // .chageun 우회 차단
  assert.equal(ub("cd .chageun && rm -f STOP"), "u-protected-path");
  assert.equal(ub("( cd .chageun ; rm -f STOP )"), "u-protected-path");
  assert.equal(ub('sed -i "s/.*/x/" .chageun/token'), "u-protected-path");
  assert.equal(ub("python3 -c \"import os; os.remove('.chageun/token')\""), "u-protected-path");
  assert.equal(ub("node -e \"require('fs').writeFileSync('.chageun/token','{}')\""), "u-protected-path");
  assert.equal(ub("rm .CHAGEUN/token"), "u-protected-path", "대소문자 무관");
  assert.equal(ub("cat .chageun/token"), null, "읽기 허용");
  assert.equal(ub("grep x .chageun/STOP"), null, "읽기 허용");
  // nested 과차단 제거
  assert.equal(ub("grep claude -A5 file.py"), null, "언급은 오탐 아님");
  assert.equal(ub("curl https://example.com/claude --output foo"), null);
  assert.equal(ub('git commit -m "mention claude -p in docs"'), null);
  // nested 미탐 보강
  assert.equal(ub('claude "delete sandbox and push"'), "u-nested", "플래그 없어도 중첩");
  assert.equal(ub("echo hi | claude"), "u-nested");
  assert.equal(ub("sh -c 'claude -p x'"), "u-nested");
  assert.equal(ub("/usr/bin/claude -p x"), "u-nested");
  assert.equal(ub("claudexyz -p x"), null, "다른 바이너리는 오탐 아님");
});
