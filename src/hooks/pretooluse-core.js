// chageun pretooluse 코어 — 순수 판정 로직(테스트 대상). 고위험·되돌리기불가 소수 패턴만.
"use strict";

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
const ANY_PUSH = /\bgit\s+push\b/;                                    // force 여부 무관 모든 push
const ANY_DEPLOY = /\b(vercel|netlify|surge)\b|\bfly(ctl)?\s+deploy\b|\bwrangler\s+(pages\s+)?deploy\b|\brailway\s+up\b|\b(npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bsupabase\s+db\s+(push|deploy)\b/;
// 새 의존성 추가만 차단(락파일 재설치 npm ci / 인자없는 install은 허용). yarn/pnpm/bun add는 항상 추가.
const PKG_ADD = /\b(?:yarn\s+add|pnpm\s+add|bun\s+add)\b|\bnpm\s+(?:install|i)\s+(?!-)\S/;

function unattendedBlock(toolName, toolInput, opts) {
  const name = String(toolName || "");
  if (name === "Bash") {
    const cmd = String((toolInput && toolInput.command) || "");
    if (ANY_PUSH.test(cmd)) return "u-push";
    for (const seg of cmd.split(/&&|\|\||[;|\n]/)) if (ANY_DEPLOY.test(seg)) return "u-deploy";
    if (PKG_ADD.test(cmd)) return "u-install";
    return null;
  }
  return null; // DB쓰기·경로가드는 뒤 태스크에서 추가
}

module.exports = { block, reasonFor, isPrCreate, hasPrReviewer, unattendedBlock };
