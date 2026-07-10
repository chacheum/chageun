// chageun pretooluse 코어 — 순수 판정 로직(테스트 대상). 고위험·되돌리기불가 소수 패턴만.
"use strict";

const path = require("path");

// git 강제 push 차단(단 --force-with-lease는 허용). git↔push 사이 글로벌옵션(-c·-C·--git-dir·--work-tree) 허용,
// refspec 강제(+ref)·--mirror도 강제로 간주. 매칭은 첫 셸 연산자 전까지(파이프 뒤 문자열 오탐 방지).
const FORCE_PUSH = /\bgit\b(?:\s+-c\s+\S+|\s+-C\s+\S+|\s+--git-dir=\S+|\s+--work-tree=\S+)*\s+push\b[^\n|&;<>]*?(?:--force(?!-with-lease)\b|(?:^|\s)-[a-zA-Z]*f\b|--mirror\b|\s\+[\w./:-]+)/;
// rm 재귀+강제(-rf·-fr·-r -f·--recursive --force)가 루트/홈/현재트리 등 위험 타깃을 지울 때.
const RM_RECURSIVE = /\brm\s+(?:-[a-zA-Z]*\b\s*){0,3}(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive|--force)\b/;
const RM_DANGER_TARGET = /(?:\s|^)(?:\/(?:\s|$|\*)|~\/?\s*$|~\/\s*\*|\$HOME\b|\/\*|\.\.(?:\s|$|\/(?:\s|$|\*|\.))|\.\s*$|\*\s*$)/;

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
    if (/\bUPDATE\s+\S/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) return "sql-update-no-where";
  }
  return null;
}

const REASONS = {
  "force-push": "차단: `git push --force`는 남의 커밋을 덮어써 되돌리기 어렵습니다. 필요하면 `--force-with-lease`를 쓰세요(안전 강제 push).",
  "rm-recursive": "차단: 루트/홈/현재 트리 전체를 지우는 `rm -rf`는 되돌릴 수 없습니다. 지울 대상 경로를 구체적으로 좁히세요.",
  "sql-destructive": "차단: DROP/TRUNCATE 같은 파괴적 스키마 명령입니다. 운영 데이터라면 되돌릴 수 없으니, 테스트 환경인지·백업이 있는지 먼저 확인하세요.",
  "sql-delete-no-where": "차단: WHERE 없는 DELETE는 테이블 전체를 지웁니다. 조건(WHERE)을 넣거나 대상을 확인하세요.",
  "sql-update-no-where": "차단: WHERE 없는 UPDATE는 테이블 전체를 덮어씁니다. 조건(WHERE)을 넣거나 대상을 확인하세요.",
  "deploy": "차단(배포는 되돌리기 어려움): 사용자 확인 후 진행하려면 세션에 CHAGEUN_ALLOW_DEPLOY=1을 설정하세요(그 세션 동안 배포 검사가 꺼집니다). 이 브레이크는 CLI 배포만 막고 git push→자동배포(Vercel/Netlify 깃연동)는 못 막습니다 — 그건 멈춤 규칙으로 확인하세요.",
  "gate-skip": "차단: PR 생성·push 전에 pr-reviewer 게이트를 거치세요(이 세션에 신선한 실행 흔적이 없습니다 — 리뷰 후 코드를 다시 수정했으면 재실행이 필요합니다). 이미 검토했거나 예외면 CHAGEUN_SKIP_GATE_CHECK=1로 재실행하세요.",
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

// ── routing 리마인더(soft) — batch6 ─────────────────────────────────────────
// "code-implementer 위임 직전인데 이번 세션에 chageun:routing 스킬 로드 흔적이 없다"의
// 첫 1회만 참(이미 code-implementer 스폰 흔적이 있으면 침묵 — 첫 위임 전에만 알린다).
// 차단이 아니라 리마인더 주입 판정. 게이트(plan-validator/pr-reviewer) 스폰은 대상 아님
// (게이트=Opus 규칙은 코어 안전 바닥에 잔류). 순수함수(fs 없음).
const AGENT_TOOLS_RE = /^(Task|Agent)$/;
function subagentOf(inp) { return String((inp && (inp.subagent_type || inp.agentType || inp.agent_type)) || ""); }
function routingReminderNeeded(objs, toolName, toolInput) {
  if (!AGENT_TOOLS_RE.test(String(toolName || ""))) return false;
  if (!/code-implementer/.test(subagentOf(toolInput))) return false;
  if (!Array.isArray(objs)) return false;
  for (const o of objs) {
    const m = (o && o.message) || o; const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      const nm = String(b.name || "");
      if (nm === "Skill" && /routing/.test(String((b.input && b.input.skill) || ""))) return false; // 로드됨
      if (AGENT_TOOLS_RE.test(nm) && /code-implementer/.test(subagentOf(b.input))) return false; // 이미 위임 시작(1회 보장)
    }
  }
  return true;
}

// transcript objs에 pr-reviewer가 "실제로 실행"된 흔적이 있고 그 흔적이 신선한지(P3) —
// 문자열 언급이 아니라 Task/Agent tool_use의 subagent_type 기준. 리뷰 이후 코드 수정
// (Edit/Write류, 문서 제외 — isCodeTarget)이 있으면 stale(false): 검토 안 받은 코드가
// 검토 딱지를 달고 나가지 않게(🙋 합의: 문서 수정은 무효화 안 함 · 재검토 1회 강제 수용).
// 한계(자인): Bash(sed·리다이렉션)로 고친 파일은 lastCodeEdit에 안 잡힌다 — 얇은 그물. 순수함수(fs 없음).
function hasPrReviewer(objs) {
  if (!Array.isArray(objs)) return false;
  let lastReview = -1, lastCodeEdit = -1, seq = 0;
  for (const o of objs) {
    const m = (o && o.message) || o;
    const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      seq++;
      const nm = String(b.name || "");
      const inp = b.input || {};
      if (/^(Task|Agent)$/.test(nm)) {
        const sub = String(inp.subagent_type || inp.agentType || inp.agent_type || "");
        if (/pr-reviewer/.test(sub)) lastReview = seq;
      } else if (EDIT_TOOLS_RE.test(nm)) {
        if (isCodeTarget(inp.file_path || inp.notebook_path)) lastCodeEdit = seq;
      }
    }
  }
  return lastReview !== -1 && lastReview > lastCodeEdit;
}

// P3: git push 감지(게이트 생략 검사용) — git 다음이 플래그류뿐일 때만 push 서브커맨드로 인정
// (bare "push" 문자열 오탐 방지 — 무인 ANY_PUSH(과차단 허용)보다 좁게). 알려진 한계:
// 따옴표를 해석하지 않아 명령 안의 "git push" 부분문자열은 오탐 가능(SKIP env로 해소, 테스트에 고정).
const PUSH_RE = /\bgit(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b/;
function isPush(toolName, toolInput) {
  if (toolName !== "Bash") return false;
  return PUSH_RE.test(String((toolInput && toolInput.command) || ""));
}

// ── P1 plan-validator 리마인더(soft) ────────────────────────────────────────
// "이번 세션에 plan 문서(.md, 경로에 plan)를 썼는데 plan-validator 없이 코드 수정을 시작"의
// 첫 1회만 참(무상태 1회 보장 — plan 이후 코드 수정 흔적이 이미 있으면 침묵).
// 차단이 아니라 리마인더 주입 판정. 넓은 감지보다 소음 회피 우선(스펙 🙋 합의: plan 파일명 휴리스틱).
// 새 plan을 다시 쓰면 재무장(validated·codeEdited 리셋 — 새 plan은 새 검증 대상). 순수함수(fs 없음).
const EDIT_TOOLS_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
function isPlanDocPath(p) { const s = String(p || ""); return /\.md$/i.test(s) && /plan/i.test(s); }
function isCodeTarget(p) {
  const s = String(p || "");
  if (!s) return false;
  if (/\.mdx?$/i.test(s)) return false;      // 문서는 구현 아님
  if (/(^|\/)docs\//i.test(s)) return false; // docs/ 밑도 문서
  return true;
}
function planReminderNeeded(objs, toolName, toolInput) {
  if (!EDIT_TOOLS_RE.test(String(toolName || ""))) return false;
  const ti = toolInput || {};
  if (!isCodeTarget(ti.file_path || ti.notebook_path)) return false;
  if (!Array.isArray(objs)) return false;
  let planSeen = false, validated = false, codeEdited = false;
  for (const o of objs) {
    const m = (o && o.message) || o; const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      const nm = String(b.name || ""); const inp = b.input || {};
      if (EDIT_TOOLS_RE.test(nm)) {
        const p = inp.file_path || inp.notebook_path;
        if (isPlanDocPath(p)) { planSeen = true; validated = false; codeEdited = false; }
        else if (planSeen && isCodeTarget(p)) codeEdited = true;
      } else if (/^(Task|Agent)$/.test(nm)) {
        const sub = String(inp.subagent_type || inp.agentType || inp.agent_type || "");
        if (planSeen && /plan-validator/.test(sub)) validated = true;
      }
    }
  }
  return planSeen && !validated && !codeEdited;
}

// ── 무인 모드(CHAGEUN_UNATTENDED=1) 전용 추가 차단 ──────────────────────────
// 유인 모드엔 영향 없음(래퍼가 무인일 때만 호출). base block보다 넓게 막고, 탈출구 env는 래퍼에서 무시.
// git과 push 사이에 어떤 토큰이 와도(-c key=val, -C dir, --git-dir=… 등) 차단. 과차단(커밋메시지 속 " push" 등)은 park라 안전.
const ANY_PUSH = /\bgit\b(?:\s+\S+)*?\s+push\b/;
// 배포·퍼블리시. 동사형은 느슨히, 단독 툴명(vercel/netlify/surge)은 세그먼트 선두에서만(문자열 속 오탐 축소).
const DEPLOY_VERB = /\bfly(ctl)?\s+deploy\b|\bwrangler\s+(pages\s+)?deploy\b|\brailway\s+up\b|\b(npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bsupabase\s+db\s+(push|deploy)\b/;
// 배포 CLI. 무인 중엔 오탐(park)을 감수하고 앵커 없이 어디서든 매칭 — 셸 래퍼(sh -c, bunx, *dlx, env 등)로 감싼 배포 우회 차단이 문자열 오탐 축소보다 우선.
const DEPLOY_TOOL = /\b(?:vercel|netlify|surge)\b/;
// (A안 격리 재설계) 로컬 작업은 풀고, 원격/관리형 쓰기만 남긴다:
//   걷어냄(로컬·목조름) = 설치(일회용 clone이라 안전)·Bash SQL 클라이언트의 **localhost** DML(격리 샌드박스).
//   남김(원격·백스톱) = MCP write·MCP 경유 DB DML·**Bash SQL의 명시적 비-localhost 대상 DML**.
//   MCP-off(--strict-mcp-config)가 primary지만 그 런타임 효과를 무인 harness에서 관측할 수 없어(관리 명령 mcp list는
//   세션 게이트 무시), 훅을 심층방어 백스톱으로 유지한다. supabase MCP는 OAuth로 원격 관리형 프로젝트(운영 가능)에
//   닿고, preflight는 **env만** 스캔해 명령·repo에 인라인으로 박힌 접속문자열은 못 거르므로, 이 훅 백스톱이 실질 방어.
// 무인: 외부·파괴적 MCP 도구(메서드명이 위험 동사로 시작). get/list/search/read/download 등 읽기는 통과.
const MCP_WRITE = /__(?:create|delete|deploy|pause|restore|merge|reset|rebase|update|apply|confirm|copy|upload|move|remove|write|insert|set)_/i;
// MCP 경유 DB 쓰기(execute_sql/apply_migration) 판정용. SELECT/EXPLAIN/SHOW 외 쓰기성 SQL(DML+DDL).
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

// Bash SQL 클라이언트(psql/mysql 등) — 명시적 원격 대상 DML만 백스톱으로 막기 위해(localhost 샌드박스는 허용).
const SQL_CLIENT = /\b(?:psql|mysql|mariadb|sqlite3|mongosh?|clickhouse-client)\b/;
const LOCAL_DB_HOST = /(?:localhost|127\.0\.0\.1|\[::1\]|(?:^|[^:\d])::1\b|0\.0\.0\.0)/i;
// 접속 대상이 명령에 '명시'됐나 — 연결문자열(scheme://…@host) 또는 -h/--host/host= 플래그.
const DB_CONN_STRING = /[a-z][a-z0-9+.-]*:\/\/[^\s]*@[^\s/]+/i;
const DB_HOST_FLAG = /(?:^|\s)-h\s+\S+|--host[=\s]+\S+|\bhost=\S+/i;
// 명시 대상이 있고 그게 localhost가 아니면 원격으로 본다. 대상 미명시(=기본 localhost 샌드박스)는 원격 아님(허용).
function targetsRemoteDb(seg) {
  const explicit = DB_CONN_STRING.test(seg) || DB_HOST_FLAG.test(seg);
  return explicit && !LOCAL_DB_HOST.test(seg);
}
// DB 클라이언트가 읽는 호스트 env(PGHOST 등)가 원격값으로 설정됐나 — `export PGHOST=원격 && psql …`(세그먼트 분리)와
// 인라인 `PGHOST=원격 psql …`을 잡기 위해 명령 전체를 스캔. 값이 localhost면 원격 아님. ($VAR 참조는 정적 판정 불가 — 미커버.)
const DB_HOST_ENV = /\b(?:PGHOST|PGHOSTADDR|MYSQL_HOST|MYSQL_TCP_HOST|MARIADB_HOST|MONGO_HOST|MONGODB_HOST|CLICKHOUSE_HOST|DB_HOST|DATABASE_HOST)\s*=\s*(\S+)/ig;
function envTargetsRemoteDb(cmd) {
  DB_HOST_ENV.lastIndex = 0;
  let m;
  while ((m = DB_HOST_ENV.exec(String(cmd || ""))) !== null) {
    if (!LOCAL_DB_HOST.test(m[1])) return true;
  }
  return false;
}

// claude/codex 중첩 실행(자식이 env를 잃고 유인으로 떠 무인 경계 탈출). 명령 위치(세그먼트 선두·셸연산자·명령치환·제어구조·래퍼(sh -c/bash -c/env/sudo/nohup/timeout 등)·인라인 VAR= 프리픽스)에서 실행될 때 차단. 단순 언급(grep/echo/curl/커밋메시지)은 제외.
const NESTED_AGENT = /(?:^|[;|&(){]|\bthen\b|\bdo\b|\$\(|`|\bsh\s+-c\s+["']?|\bbash\s+-c\s+["']?|\b(?:env|sudo|command|xargs|nohup|timeout|setsid|exec|nice|stdbuf|time|ionice|doas)\b[^|&;]*?\s|(?:\b[A-Za-z_]\w*=\S*\s+)+)\s*(?:\S*\/)?(?:claude|codex)\b/;
// 보호 경로(.chageun 통과표·STOP + .claude 안전판 + pretooluse 훅 파일)를 읽기 외로 건드리는 Bash 차단.
// H1: pathGuard는 Write류만 봐서 Bash `tee`/`>`/`sed -i`로 안전판 쓰기가 새던 구멍을 막는다. 순수 읽기(cat/grep/ls)는 통과.
// 차근 안전판은 항상 `.claude`/`.chageun` 아래라 그 둘로 충분 — bare `hooks/`·`settings.json`은 사용자 프로젝트(React src/hooks·.vscode/settings.json)를 오탐해 제외. ($HOME 밖 임의 절대경로 쓰기는 미커버 — 샌드박스가 근본대책.)
const PROTECTED_REF = /\.(?:claude|chageun)\b|pretooluse[^/\s]*\.js\b/i;
const CHAGEUN_TOUCH = /\b(?:rm|mv|cp|unlink|truncate|tee|dd|install|ln|chmod|sed|awk|python3?|node|perl|ruby|cd|find|shred|rsync|git)\b|>>?/i;

// ── P7 무인 egress(외부 데이터 전송) 차단 ──────────────────────────────────
// 되돌리기 불가 외부 유출을 무인 중 park. localhost는 허용(loop의 로컬 API 검증·포트 체크 보존).
// 트리거: curl 업로드/POST·PUT·PATCH, wget --post, scp/sftp/원격rsync, nc/ncat/telnet(명령 위치).
// 명령치환($()·백틱)은 먼저 제거 — curl 인자 위치 밖의 타 도구 플래그(date -d 등) 오탐 방지.
function stripSubst(s) { return String(s).replace(/\$\([^)]*\)/g, " ").replace(/`[^`]*`/g, " "); }
const EGRESS_SEND = /\bcurl\b[^\n]*?(?:--data(?:-\w+)?\b|(?:^|\s)-d\b|--form\b|(?:^|\s)-F\b|--upload-file\b|(?:^|\s)-T\b|-X\s*(?:POST|PUT|PATCH)\b)|\bwget\b[^\n]*?--post-(?:data|file)\b/i;
const EGRESS_XFER = /\b(?:scp|sftp)\b|\brsync\b[^\n]*(?:::|[\w.-]+@)/i;
// nc/telnet은 '명령 위치'(세그먼트 선두, env·wrapper 프리픽스 허용)에서 인자를 받을 때만 — 문자열·플래그(-nc)·커밋메시지 오탐 방지.
const EGRESS_SOCKET = /^\s*(?:[A-Za-z_]\w*=\S+\s+)*(?:sudo\s+|env\s+\S+\s+|timeout\s+\S+\s+)?(?:nc|ncat|netcat|telnet)\b\s+\S/i;
// 파일명(호스트 아님) 제외용 흔한 확장자.
const FILE_EXT = /\.(?:pdf|jsonl?|zip|tar|gz|tgz|png|jpe?g|gif|svg|webp|csv|tsv|txt|html?|css|jsx?|mjs|tsx?|md|xml|ya?ml|toml|sql|log|env|pem|key|crt|der|db|sqlite3?|bin|dat|bak|lock)$/i;
const LOOPBACK = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|::1)$/i;
// 목적지 호스트 '전부' 추출(하나라도 외부면 차단 — querystring에 localhost 심는 substring 우회 방어).
// URL은 userinfo(user@) 제거 후 실제 host 캡처, 파일명은 제외. 브라켓 IPv6 지원.
function egressHosts(seg) {
  const hosts = [];
  let m;
  const url = /https?:\/\/(?:[^/\s]*@)?(\[[^\]]*\]|[^/\s:'"@]+)/ig;    // URL(userinfo 제거 — 마지막 @까지, IPv6)
  while ((m = url.exec(seg)) !== null) hosts.push(m[1]);
  const at = /(?:^|\s)[\w.-]+@(\[[^\]]*\]|[\w.-]+)(?=[:\s]|$)/ig;      // scp user@host
  while ((m = at.exec(seg)) !== null) hosts.push(m[1]);
  const hp = /(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}|\d+\.\d+\.\d+\.\d+):\d/ig; // host:port
  while ((m = hp.exec(seg)) !== null) hosts.push(m[1]);
  const lit = /(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|\d+\.\d+\.\d+\.\d+)/ig; // 리터럴
  while ((m = lit.exec(seg)) !== null) hosts.push(m[1]);
  const bare = /(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?=[/\s]|$)/ig; // bare 도메인(파일명 제외)
  while ((m = bare.exec(seg)) !== null) if (!FILE_EXT.test(m[1])) hosts.push(m[1]);
  return hosts;
}
function isEgress(rawSeg) {
  const seg = stripSubst(rawSeg);
  if (!EGRESS_SEND.test(seg) && !EGRESS_XFER.test(seg) && !EGRESS_SOCKET.test(seg)) return false;
  const hosts = egressHosts(seg);
  if (hosts.length === 0) return true;                 // 목적지 판정 불가 → fail-safe park
  return hosts.some((h) => !LOOPBACK.test(h));         // 하나라도 외부면 park
}
// 못 잡는 것(정직 고지): GET 쿼리스트링 유출(curl external/?data=…), python/node/ruby 인라인 HTTP,
// base64 파이프, DNS 터널, 셸 래퍼(sh -c) 우회, $VAR 호스트, localhost POST 본문에 든 외부 URL은
// 안전측 park(오차단). python/node는 loop가 앱 실행에 정상 사용해 오차단 위험이 커 의도적 미포함.
// 이 그물은 흔한 업로드/전송 동사만 park하는 심층방어 한 겹이며 완전한 경계가 아니다 — 근본대책은
// OS 샌드박스 network allowlist(미룸: 이 환경서 실차단 검증 불가라 blind 구현 안 함, 계측 제거 교훈).

// 무인 예산·워치독 기본 한도. 8시간 / 2000 도구호출 / 30분 무진전.
const BUDGET = { maxMs: 8 * 60 * 60 * 1000, maxCalls: 2000, watchdogMs: 30 * 60 * 1000 };
// 이 도구 호출이 "진전"(git commit)인가 — 워치독 리셋 신호. 워치독은 과대검출이 "덜 안전"
// (헛돎을 늦게 잡음)이라 정밀하게: 명령을 세그먼트로 쪼개 선두가 git … commit일 때만 참.
// 그래서 "echo git commit"·"grep 'git commit'"은 진전으로 안 침.
const GIT_COMMIT = /^\s*git\b(?:\s+\S+)*?\s+commit\b/;
function isGitCommit(name, toolInput) {
  if (name !== "Bash") return false;
  const cmd = String((toolInput && toolInput.command) || "");
  return cmd.split(/&&|\|\||[;|\n]/).some((seg) => GIT_COMMIT.test(seg));
}
// 순수 예산 판정: 이전 상태 + 지금 시각 + 이번 호출이 진전인가 → 갱신 상태 + 사유(없으면 null).
// 상태 없으면 now로 생성. calls 증가. 진전이면 lastProgressAt=now. 한도 초과 시 사유.
function budgetStep(prevState, now, isProgress, limits) {
  const ok = prevState && typeof prevState.startedAt === "number";
  const state = ok
    ? { startedAt: prevState.startedAt, calls: (prevState.calls || 0) + 1, lastProgressAt: typeof prevState.lastProgressAt === "number" ? prevState.lastProgressAt : prevState.startedAt }
    : { startedAt: now, calls: 1, lastProgressAt: now };
  if (isProgress) state.lastProgressAt = now;
  let reason = null;
  if (now - state.startedAt > limits.maxMs) reason = "u-budget";
  else if (state.calls > limits.maxCalls) reason = "u-budget";
  else if (now - state.lastProgressAt > limits.watchdogMs) reason = "u-watchdog";
  return { state, reason };
}

// 무인 모드: worktree 밖 쓰기 / 안전장치·설정·훅 / 동결된 성공기준 파일 수정 차단. Write류만 대상.
const PROTECTED = /(^|\/)\.(?:claude|chageun)(\/|$)|(^|\/)settings(\.local)?\.json$|(^|\/)hooks(\/|$)|pretooluse[^/]*\.js$/i;
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
    if (PROTECTED_REF.test(cmd) && CHAGEUN_TOUCH.test(cmd)) return "u-protected-path";
    const envRemote = envTargetsRemoteDb(cmd);
    for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
      if (NESTED_AGENT.test(seg)) return "u-nested";
      if (ANY_PUSH.test(seg)) return "u-push";
      if (DEPLOY_VERB.test(seg) || DEPLOY_TOOL.test(seg)) return "u-deploy";
      if (isEgress(seg)) return "u-egress";
      // Bash SQL 클라이언트가 '명시적 원격'(호스트 플래그·접속문자열) 또는 원격 호스트 env로 쓰기 → 백스톱(localhost 샌드박스는 허용).
      if (SQL_CLIENT.test(seg) && isWriteSql(seg) && (targetsRemoteDb(seg) || envRemote)) return "u-db-write";
    }
    return null;
  }
  // 원격/관리형 백스톱(MCP-off가 primary, 이건 심층방어): MCP 경유 DB DML + 파괴적 MCP 도구.
  if (/execute_sql|apply_migration/.test(name)) {
    if (isWriteSql((toolInput && (toolInput.query || toolInput.sql)) || "")) return "u-db-write";
    return null;
  }
  if (/^mcp__/.test(name) && MCP_WRITE.test(name)) return "u-mcp-write";
  return pathGuard(name, toolInput, opts);
}

const REASONS_UNATTENDED = {
  "u-push": "무인 모드 차단: git push는 자동배포로 이어질 수 있어 무인 중엔 못 합니다. 이 작업을 park하고 사람 복귀를 기다립니다.",
  "u-deploy": "무인 모드 차단: 배포·퍼블리시(프리뷰 포함)는 외부로 나가는 행동이라 무인 중 금지. park하고 사람 복귀를 기다립니다.",
  "u-egress": "무인 모드 차단: 외부로 데이터를 내보내는 명령(전송·업로드·원시 소켓)은 되돌리기 불가·유출 위험이라 무인 중 금지. localhost 검증은 허용됩니다. park하고 사람 복귀를 기다립니다.",
  "u-db-write": "무인 모드 차단: 원격 MCP를 통한 DB 쓰기(INSERT/UPDATE/DELETE·스키마 변경)는 운영 위험이라 무인 중 금지. 검증은 localhost 샌드박스에서. park하고 사람 복귀를 기다립니다.",
  "u-mcp-write": "무인 모드 차단: 외부·파괴적 MCP 도구(배포·프로젝트/브랜치 생성·삭제 등)는 무인 중 금지. park하고 사람 복귀를 기다립니다.",
  "u-out-of-tree": "무인 모드 차단: 전용 worktree 밖 경로 쓰기는 금지(다른 작업물 보호). park하고 사람 복귀를 기다립니다.",
  "u-protected-path": "무인 모드 차단: .claude·.chageun·설정·훅 파일은 무인 중 수정 금지(안전장치·정지 스위치 보호). park하고 사람 복귀를 기다립니다.",
  "u-frozen-criteria": "무인 모드 차단: 동결된 성공기준 파일은 무인 중 수정 금지. 기준을 바꿔야 하면 park하고 사람 복귀를 기다립니다.",
  "u-pr": "무인 모드 차단: PR 생성·머지는 외부로 나가는 행동이라 무인 중 금지. park하고 사람 복귀를 기다립니다.",
  "u-error": "무인 모드 차단: 판정 중 오류가 나 안전을 위해 park합니다. 사람 복귀를 기다립니다.",
  "u-nested": "무인 모드 차단: 새 claude/codex 프로세스 실행은 무인 경계를 벗어나므로 금지. park하고 사람 복귀를 기다립니다.",
  "u-stop": "무인 모드 정지: .chageun/STOP 요청이 있어 모든 작업을 멈춥니다. 사람 복귀를 기다립니다.",
  "u-no-preflight": "무인 모드 차단: preflight 통과 증표가 없습니다. chageun-unattended 런처로 시작하세요. 그때까지 모든 작업을 park합니다.",
  "u-budget": "무인 모드 정지: 예산 한도(시간 또는 작업량)에 도달해 멈춥니다. 진행 상황은 저장돼 있고, 사람 복귀 후 이어서 재개하세요.",
  "u-watchdog": "무인 모드 정지: 오랫동안 진전(저장)이 없어 멈춥니다(헛돎 방지). 사람 복귀를 기다립니다.",
};
function reasonForUnattended(key) { return REASONS_UNATTENDED[key] || "무인 모드 차단: park하고 사람 복귀를 기다립니다."; }

module.exports = { block, reasonFor, isPrCreate, isPush, hasPrReviewer, planReminderNeeded, routingReminderNeeded, unattendedBlock, isEgress, isWriteSql, reasonForUnattended, budgetStep, isGitCommit, BUDGET };
