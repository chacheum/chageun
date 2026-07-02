// chageun pretooluse 코어 — 순수 판정 로직(테스트 대상). 고위험·되돌리기불가 소수 패턴만.
"use strict";

const path = require("path");

// git push --force / -f 차단(단 --force-with-lease는 허용 — 안전한 강제 push).
const FORCE_PUSH = /\bgit\s+push\b[^\n]*?(--force(?!-with-lease)\b|(?:^|\s)-[a-zA-Z]*f\b)/;
// rm 재귀+강제(-rf·-fr·-r -f·--recursive --force)가 루트/홈/현재트리 등 위험 타깃을 지울 때.
const RM_RECURSIVE = /\brm\s+(?:-[a-zA-Z]*\b\s*){0,3}(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive|--force)\b/;
const RM_DANGER_TARGET = /(?:\s|^)(?:\/(?:\s|$|\*)|~\/?\s*$|~\/\s*\*|\$HOME\b|\/\*|\.\s*$|\*\s*$)/;

// 파괴적 SQL(스키마·대량삭제). DELETE는 WHERE 없을 때만.
const SQL_DESTRUCTIVE = /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+(TABLE\s+)?\w)/i;

// 되돌리기 불가 배포·퍼블리시 CLI(프리뷰·dry-run 제외). 탈출구는 래퍼(process.env.CHAGEUN_ALLOW_DEPLOY).
// 한계: git push→자동배포(Vercel/Netlify 깃연동)는 못 잡음 — 텍스트 멈춤규칙 의존(래퍼 메시지에 명시).
const DEPLOY = /\b(vercel|netlify)\b[^\n]*--prod\b|\bfly(ctl)?\s+deploy\b|\bwrangler\s+(pages\s+)?deploy\b|\brailway\s+up\b|\b(npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bsupabase\s+db\s+push\b/;

// 배포 여부: 명령을 세그먼트(&&·;·| ·개행)로 쪼개 각 세그먼트별로 판정 —
// --dry-run 예외가 무관한 세그먼트(`npm publish && echo --dry-run`)로 새는 것 방지.
function isDeploy(cmd) {
  for (const seg of String(cmd || "").split(/&&|\|\||[;|\n]/)) {
    if (DEPLOY.test(seg) && !/--dry-run\b/.test(seg)) return true;
  }
  return false;
}

// 파괴적 SQL 판정: 주석 제거 후 세미콜론으로 문장 분리해 각 문장을 개별 검사
// (뒤 문장의 무관한 WHERE로 앞의 전체삭제가 통과하던 우회·주석 오탐 방지).
function destructiveSql(text) {
  const noComments = String(text || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const stmt of noComments.split(";")) {
    if (SQL_DESTRUCTIVE.test(stmt)) return "sql-destructive";
    if (/\bDELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) return "sql-delete-no-where";
  }
  return null;
}

const REASONS = {
  "force-push": "차단: `git push --force`는 남의 커밋을 덮어써 되돌리기 어렵습니다. 필요하면 `--force-with-lease`를 쓰세요(안전 강제 push).",
  "rm-recursive": "차단: 루트/홈/현재 트리 전체를 지우는 `rm -rf`는 되돌릴 수 없습니다. 지울 대상 경로를 구체적으로 좁히세요.",
  "sql-destructive": "차단: DROP/TRUNCATE 같은 파괴적 스키마 명령입니다. 운영 데이터라면 되돌릴 수 없으니, 테스트 환경인지·백업이 있는지 먼저 확인하세요.",
  "sql-delete-no-where": "차단: WHERE 없는 DELETE는 테이블 전체를 지웁니다. 조건(WHERE)을 넣거나 대상을 확인하세요.",
  "deploy": "차단(배포는 되돌리기 어려움): 사용자 확인 후 진행하려면 세션에 CHAGEUN_ALLOW_DEPLOY=1을 설정하세요(그 세션 동안 배포 검사가 꺼집니다). 이 브레이크는 CLI 배포만 막고 git push→자동배포(Vercel/Netlify 깃연동)는 못 막습니다 — 그건 멈춤 규칙으로 확인하세요.",
  "gate-skip": "차단: PR 생성 전에 pr-reviewer 게이트를 거치세요(이 세션에 pr-reviewer 실행 흔적이 없습니다). 이미 검토했거나 예외면 CHAGEUN_SKIP_GATE_CHECK=1로 재실행하세요.",
};

// 어떤 도구·입력이 위험한지 판정. 위험하면 사유 키를, 아니면 null.
function block(toolName, toolInput) {
  const name = toolName || "";
  if (name === "Bash") {
    const cmd = String((toolInput && toolInput.command) || "");
    if (FORCE_PUSH.test(cmd)) return "force-push";
    if (RM_RECURSIVE.test(cmd) && RM_DANGER_TARGET.test(cmd)) return "rm-recursive";
    if (isDeploy(cmd)) return "deploy";
    // 파괴적 SQL은 SQL 클라이언트 명령일 때만 검사(커밋 메시지·문자열에 "DROP TABLE"이 들어간
    // 무해한 명령을 오탐하지 않도록).
    if (/\b(psql|mysql|mariadb|sqlite3|mongosh?|clickhouse-client)\b/.test(cmd)) return destructiveSql(cmd);
    return null;
  }
  // Supabase MCP 등 DB 도구로 나가는 파괴적 SQL(가장 위험한 운영 DB 경로 — Bash가 아님).
  // NOTE: matcher는 부분일치라 도구명 `mcp__..._execute_sql`을 잡는다(실 MCP 환경 확인 권장).
  if (/execute_sql|apply_migration/.test(name)) {
    return destructiveSql((toolInput && (toolInput.query || toolInput.sql)) || "");
  }
  return null;
}

function reasonFor(key) { return REASONS[key] || "차단: 되돌리기 어려운 고위험 명령입니다."; }

// gh pr create/merge 명령인지(게이트 감지 대상).
function isPrCreate(toolName, toolInput) {
  if (toolName !== "Bash") return false;
  return /\bgh\s+pr\s+(create|merge)\b/.test(String((toolInput && toolInput.command) || ""));
}

// transcript objs에 pr-reviewer가 "실제로 실행"된 흔적이 있는지(문자열 언급이 아니라
// Task/Agent tool_use의 subagent_type/agentType에 pr-reviewer 포함). 순수함수(fs 없음).
function hasPrReviewer(objs) {
  if (!Array.isArray(objs)) return false;
  for (const o of objs) {
    const m = (o && o.message) || o;
    const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      const nm = String(b.name || "");
      if (!/^(Task|Agent)$/.test(nm)) continue;
      const inp = b.input || {};
      const sub = String(inp.subagent_type || inp.agentType || inp.agent_type || "");
      if (/pr-reviewer/.test(sub)) return true;
    }
  }
  return false;
}

// ── 무인 모드(CHAGEUN_UNATTENDED=1) 전용 추가 차단 ──────────────────────────
// 유인 모드엔 영향 없음(래퍼가 무인일 때만 호출). base block보다 넓게 막고, 탈출구 env는 래퍼에서 무시.
// 모든 git push(force 무관). git와 push 사이 플래그(-C dir, --git-dir=…)를 허용해 삽입 우회 차단.
const ANY_PUSH = /\bgit\b(?:\s+-{1,2}[\w-]+(?:=\S+)?|\s+-C\s+\S+)*\s+push\b/;
// 배포·퍼블리시. 동사형은 느슨히, 단독 툴명(vercel/netlify/surge)은 세그먼트 선두에서만(문자열 속 오탐 축소).
const DEPLOY_VERB = /\bfly(ctl)?\s+deploy\b|\bwrangler\s+(pages\s+)?deploy\b|\brailway\s+up\b|\b(npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bsupabase\s+db\s+(push|deploy)\b/;
const DEPLOY_TOOL = /^\s*(?:sudo\s+|npx\s+)?(?:vercel|netlify|surge)\b/;
// 설치/추가 계열: 무인 중 새 의존성 유입을 넓게 차단, 락파일 재설치 표준형만 허용.
const PKG_INSTALLISH = /\b(?:npm|pnpm|yarn|bun)\b[^\n]*\b(?:install|i|add)\b/;
const PKG_SAFE_REINSTALL = /^\s*(?:npm\s+(?:ci|install|i)|(?:pnpm|yarn|bun)\s+install|pnpm\s+i)\s*(?:--[\w-]+)?\s*$/;

// 무인 모드: SELECT/EXPLAIN/SHOW 외 모든 쓰기성 SQL(DML+DDL) 차단. 주석 제거 후 문장별 검사.
const SQL_WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|MERGE|REPLACE|UPSERT|CALL|COPY)\b/i;
const SQL_SELECT_INTO = /\bSELECT\b[\s\S]*?\bINTO\b/i;
function isWriteSql(text) {
  // 블록 코멘트는 빈 문자열로 제거(IN/**/SERT 같은 키워드 분절 난독화 무력화), 라인 코멘트는 공백으로.
  const noComments = String(text || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const stmt of noComments.split(";")) {
    if (!stmt.trim()) continue;
    if (SQL_WRITE.test(stmt) || SQL_SELECT_INTO.test(stmt)) return true;
  }
  return false;
}

// 무인 모드: worktree 밖 쓰기 / 안전장치·설정·훅 / 동결된 성공기준 파일 수정 차단. Write류만 대상.
const PROTECTED = /(^|\/)\.claude(\/|$)|(^|\/)settings(\.local)?\.json$|(^|\/)hooks(\/|$)|pretooluse[^/]*\.js$/i;
function pathGuard(toolName, toolInput, opts) {
  if (!/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(String(toolName || ""))) return null;
  const fp = (toolInput && (toolInput.file_path || toolInput.notebook_path)) || "";
  if (!fp) return null;
  const root = (opts && opts.worktreeRoot) || ".";
  const abs = path.resolve(root, fp);
  if (PROTECTED.test(abs)) return "u-protected-path";
  if (opts && opts.criteriaPath && path.resolve(root, opts.criteriaPath).toLowerCase() === abs.toLowerCase()) return "u-frozen-criteria";
  const rel = path.relative(path.resolve(root), abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return "u-out-of-tree";
  return null;
}

function unattendedBlock(toolName, toolInput, opts) {
  const name = String(toolName || "");
  if (name === "Bash") {
    const cmd = String((toolInput && toolInput.command) || "");
    for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
      if (ANY_PUSH.test(seg)) return "u-push";
      if (DEPLOY_VERB.test(seg) || DEPLOY_TOOL.test(seg)) return "u-deploy";
      if (PKG_INSTALLISH.test(seg) && !PKG_SAFE_REINSTALL.test(seg)) return "u-install";
    }
    return null;
  }
  if (/execute_sql|apply_migration/.test(name)) {
    if (isWriteSql((toolInput && (toolInput.query || toolInput.sql)) || "")) return "u-db-write";
    return null;
  }
  return pathGuard(name, toolInput, opts);
}

const REASONS_UNATTENDED = {
  "u-push": "무인 모드 차단: git push는 자동배포로 이어질 수 있어 무인 중엔 못 합니다. 이 작업을 park하고 사람 복귀를 기다립니다.",
  "u-deploy": "무인 모드 차단: 배포·퍼블리시(프리뷰 포함)는 외부로 나가는 행동이라 무인 중 금지. park하고 사람 복귀를 기다립니다.",
  "u-db-write": "무인 모드 차단: DB 쓰기(INSERT/UPDATE/DELETE·스키마 변경)는 무인 중 금지 — 검증은 격리 샌드박스에서만. park하고 사람 복귀를 기다립니다.",
  "u-install": "무인 모드 차단: 새 의존성 설치는 무인 중 금지(공급망·임의코드 위험). 락파일 재설치(npm ci)만 허용. park하고 사람 복귀를 기다립니다.",
  "u-out-of-tree": "무인 모드 차단: 전용 worktree 밖 경로 쓰기는 금지(다른 작업물 보호). park하고 사람 복귀를 기다립니다.",
  "u-protected-path": "무인 모드 차단: .claude·설정·훅 파일은 무인 중 수정 금지(안전장치 자체 보호). park하고 사람 복귀를 기다립니다.",
  "u-frozen-criteria": "무인 모드 차단: 동결된 성공기준 파일은 무인 중 수정 금지. 기준을 바꿔야 하면 park하고 사람 복귀를 기다립니다.",
  "u-pr": "무인 모드 차단: PR 생성·머지는 외부로 나가는 행동이라 무인 중 금지. park하고 사람 복귀를 기다립니다.",
};
function reasonForUnattended(key) { return REASONS_UNATTENDED[key] || "무인 모드 차단: park하고 사람 복귀를 기다립니다."; }

module.exports = { block, reasonFor, isPrCreate, hasPrReviewer, unattendedBlock, isWriteSql, reasonForUnattended };
