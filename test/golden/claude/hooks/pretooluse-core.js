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

// G7 변형 우회 차단: .env(.local 등)를 인코더/슬라이서로 변형해 마스킹을 우회하려는 Bash. 평문 cat은 허용(PostToolUse 마스킹이 처리).
// example 계열(.env.example|sample|template|dist)은 제외 — collectSecrets 제외 목록과 정합(F4).
const ENV_REF_RE = /\.env\b(?!\.(?:example|sample|template|dist))/i;
const ENCODER_RE = /\b(base64|xxd|od|hexdump|rev|tr|fold|cut|dd|uuencode|openssl\s+enc)\b/;

// 되돌리기 불가 배포·퍼블리시 CLI(프리뷰·dry-run 제외). 탈출구는 래퍼(process.env.CHAGEUN_ALLOW_DEPLOY).
// 한계: git push→자동배포(Vercel/Netlify 깃연동)는 못 잡음 — 텍스트 멈춤규칙 의존(래퍼 메시지에 명시).
const DEPLOY = /\b(vercel|netlify)\b[^\n]*--prod\b|\bfly(ctl)?\s+deploy\b|\bwrangler\s+(pages\s+)?deploy\b|\brailway\s+up\b|\b(npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bsupabase\s+db\s+push\b/;

// 배포 여부: 명령을 세그먼트(&&·;·| ·개행)로 쪼개 각 세그먼트별로 판정 —
// --dry-run 예외가 무관한 세그먼트(`npm publish && echo --dry-run`)로 새는 것 방지.
function shellSegments(cmd) { return String(cmd || "").split(/&&|\|\||[;|\n]/); }
function isDeploy(cmd) {
  for (const seg of shellSegments(cmd)) {
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
  "gate-skip": "차단: PR 생성·push 전에 pr-reviewer 게이트를 거치세요(이 세션에 신선한 실행 흔적이 없습니다 — 리뷰 후 코드를 다시 수정했으면 재실행이 필요합니다). pr-reviewer에게 **재검토를 요청**하세요 — 이미 돌린 리뷰어를 SendMessage로 이어 부른 재검토도 인정됩니다(새 Agent로 다시 띄워도 됩니다). 예외로 건너뛰어야 하면 **세션 자체를 CHAGEUN_SKIP_GATE_CHECK=1로 시작**해야 합니다(명령 앞에 인라인으로 붙이는 건 훅 프로세스에 안 닿아 안 켜집니다).",
  "env-encoder": "차단: .env를 인코딩·조각내 노출하려는 시도입니다(G7). 시크릿 값은 화면에 찍지 말고 이름/존재만 다뤄주세요. 설정에 값을 넣어야 하면 값을 출력하지 않는 셸(cp·sed)로 옮기세요.",
  "ra-write": "차단: 리뷰 에이전트는 자기 `~/.claude/agent-memory/` 밖 파일을 수정할 수 없습니다 — 고치지 말고 발견으로 보고하세요. 검토는 Read/Grep으로 계속하세요.",
  "ra-bash": "차단: 리뷰 에이전트의 Bash는 **git 읽기 명령 하나**만 허용됩니다(diff·log·status·show·grep·ls-files·ls-tree·blame·rev-parse·rev-list·shortlog·describe·cat-file·for-each-ref·name-rev·whatchanged, 그리고 **branch는 읽기 형태만** — `--show-current`·`--list`·`--contains`·`-a`·`-r`·`-v` 등이나 인자 없는 `git branch`. 브랜치 이름을 인자로 주거나 `-d`·`-m`·`-f`를 붙이면 쓰기라 막힙니다). 막히는 것: 앞머리 `cd`·`echo`, `2>/dev/null` 같은 오류 감추기, 리다이렉션·명령치환, 다른 명령·파일 쓰기·파괴적 git·테스트 실행. 분량 줄이는 `| head -50`은 됩니다. 정규식·글롭은 따옴표로 감싸세요(`--grep='fix$'` · `-- '*.ts'`), 붙임형 인자는 띄어 쓰세요(`-S OAuth`). 자주 막히던 것의 이미 허용된 대체: 현재 브랜치는 `git rev-parse --abbrev-ref HEAD`, 특정 커밋을 담은 브랜치는 `git for-each-ref --contains <sha>`. 파일 열람은 Read, 검색은 Grep·Glob. 고치지 말고 발견으로 보고하세요.",
  "ra-error": "차단: 리뷰 에이전트 안전 판정 중 오류라 안전측 차단(fail-closed)합니다. 검토는 Read/Grep으로 계속하세요.",
  "gate-model-downgrade": "차단: 검증 게이트를 기본보다 약한 모델로 띄우려 했습니다. 게이트는 \"검토 대상보다 최소 같거나 강한 독립 심판\"이라 약한 모델로 내리면 게이트의 의미가 사라집니다(심판이 일꾼보다 약해짐). **`model` 파라미터를 빼면** 에이전트 설정의 기본 모델이 그대로 쓰입니다 — 그게 정답인 경우가 대부분입니다. 그 모델을 못 쓰는 환경이면 실행 전 사용자가 CHAGEUN_ALLOW_GATE_MODEL=1로만 열 수 있습니다(게이트를 아예 안 부르는 것보다는 약한 심판이 낫기 때문입니다).",
  "design-color": "차단(차근 색 백스톱): 새로 넣는 코드에 디자인 토큰 대신 직접 색이 있습니다. 팔레트 색 클래스(`bg-blue-500` 등)·임의값(`-[#hex]`) 대신 docs/design-system.md의 토큰을 쓰세요. 색 견본판·Tailwind safelist처럼 색 이름이 원래 나열되는 파일이면, design-system.md front-matter의 `lint-allow-colors`에 그 팔레트명을 선언하거나 그 줄에 `design-lint-ignore` 주석을 붙이세요(그 줄만 통과). 전체 우회는 실행 전 사용자가 CHAGEUN_SKIP_DESIGN_LINT=1로만 켤 수 있습니다.",
};

// 어떤 도구·입력이 위험한지 판정. 위험하면 사유 키를, 아니면 null.
function block(toolName, toolInput) {
  const name = toolName || "";
  if (name === "Bash") {
    const cmd = String((toolInput && toolInput.command) || "");
    if (FORCE_PUSH.test(cmd)) return "force-push";
    if (RM_RECURSIVE.test(cmd) && RM_DANGER_TARGET.test(cmd)) return "rm-recursive";
    if (isDeploy(cmd)) return "deploy";
    // .env를 인코딩/조각내 마스킹을 우회하려는 시도 차단(G7). 평문 cat/grep은 허용 — PostToolUse 마스킹이 처리.
    if (ENV_REF_RE.test(cmd) && ENCODER_RE.test(cmd)) return "env-encoder";
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

// 서브에이전트용 문구 변형(v0.42). **왜 필요한가(실측):** 배포 차단 문구가 "세션에
// CHAGEUN_ALLOW_DEPLOY=1을 설정하라"고 안내하는데, 이 탈출구는 **훅 프로세스의 환경변수**라
// 서브에이전트가 켤 수 없다(명령 앞 `VAR=1 ...` 접두는 훅에 닿지 않는다 — 라이브 확인).
// 게다가 운영 배포 승인은 애초에 사람이 내릴 판단이다. 원래 문구를 그대로 주면 서브에이전트가
// 켤 수도 없는 스위치를 찾다가 왕복만 늘린다(실측 1건: 켜지 않고 BLOCKED 보고로 끝났지만
// 그 판단을 서브에이전트에게 떠넘긴 셈이었다).
const REASONS_SUBAGENT = {
  "deploy": "차단(배포는 되돌리기 어려움): **서브에이전트는 배포를 승인할 수 없습니다.** 이 탈출구는 사람이 세션을 시작할 때만 켤 수 있고(명령 앞에 환경변수를 붙여도 안 켜집니다), 운영 배포 승인은 사람이 내릴 판단입니다. 지금 작업을 멈추고(park) 본 세션에 **BLOCKED**로 보고하세요 — 무엇을 배포하려 했는지, 왜 필요한지, 사전 점검에서 확인한 것을 함께 적으세요.",
};
function reasonFor(key, forSubagent) {
  if (forSubagent && REASONS_SUBAGENT[key]) return REASONS_SUBAGENT[key];
  return REASONS[key] || "차단: 되돌리기 어려운 고위험 명령입니다.";
}

// gh pr create/merge 명령인지(게이트 감지 대상).
function isPrCreate(toolName, toolInput) {
  if (toolName !== "Bash") return false;
  return /\bgh\s+pr\s+(create|merge)\b/.test(String((toolInput && toolInput.command) || ""));
}

// ── routing 리마인더(soft) — batch6 ─────────────────────────────────────────
// "code-implementer 위임 직전인데 이번 세션에 chageun:routing 스킬 로드 흔적이 없다"의
// 첫 1회만 참(이미 code-implementer 스폰 흔적이 있으면 침묵 — 첫 위임 전에만 알린다).
// 차단이 아니라 리마인더 주입 판정. 게이트(plan-validator/pr-reviewer) 스폰은 대상 아님
// (게이트 모델은 각 agent frontmatter·라우팅 규칙이 관장). 순수함수(fs 없음).
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
// v0.43.1: `SendMessage`로 같은 게이트를 이어 불러 재검토한 것도 리뷰 흔적으로 인정한다.
//   그 전엔 Task/Agent 스폰만 세서, 재검토를 했는데도 "리뷰 없음"으로 **정당한 push가 두 번 막혔다**
//   (2026-08-02 v0.42.0·v0.42.2). SendMessage의 input엔 subagent_type이 없고 대상 id(`to`)만 있다.
//   연결 고리: 에이전트 실행 결과 레코드의 **최상위** `toolUseResult`에 `agentId`+`agentType`이 같이 실린다
//   (실측: 최근 세션의 SendMessage 10건 전부 이 경로로 매핑 성공).
//   **2패스인 이유**: run_in_background 에이전트는 완료 레코드가 SendMessage보다 뒤에 올 수 있어
//   1패스면 그 건을 놓친다. 덤으로 "아직 안 끝난 리뷰는 맵에 없어 불인정"이라는 안전측 부수 속성이 생긴다.
//   매핑 실패는 **불인정**(false 유지). 이름 문자열 휴리스틱(`to`에 "pr-reviewer"가 들어있으면 인정)은
//   일부러 안 넣는다 — 게이트 통과 조건을 문자열로 열면 우회가 쉬워진다.
// 남는 구멍(정직 · plan-validator high 수용): Task 스폰은 리뷰 절차가 **항상** 돌지만 SendMessage는
//   **배달만 보장**한다. 그래서 통보성 쪽지 한 통으로도 신선도가 되살아난다. 메시지 내용 검사는 일부러
//   안 한다 — 실제로 막혔던 메시지가 "변한 게 없으면 APPROVE 유지로 한 줄 확답해줘"였고, 어휘 목록으로
//   좁히면 이 봉합이 고치려는 오차단이 되살아난다. 마지막 방어선은 push 직전 사람 승인(멈춤 규칙 2)이다.
//   하위 확장(수용): 전송 성공 여부(tool_result의 is_error)를 안 본다 — 이미 회수된 리뷰어에게 보내 실패해도
//   신선도가 복구된다. Task 스폰도 결과가 아닌 호출 시점 계상이라 대칭이다(pr-reviewer low).
function hasPrReviewer(objs) {
  if (!Array.isArray(objs)) return false;
  // 패스1: agentId → agentType 맵.
  const agentTypeById = new Map();
  for (const o of objs) {
    const tur = o && o.toolUseResult;
    if (tur && typeof tur === "object" && tur.agentId) {
      agentTypeById.set(String(tur.agentId), String(tur.agentType || ""));
    }
  }
  // 패스2: 리뷰 흔적과 코드 수정의 선후.
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
      } else if (nm === "SendMessage") {
        const to = String(inp.to || inp.recipient || "");
        if (to && /pr-reviewer/.test(agentTypeById.get(to) || "")) lastReview = seq;
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
// v0.43.1: 순수 삭제 push(`git push --delete <ref>`)는 리뷰할 diff가 없어 게이트 대상에서 뺀다
// (회고 실측 2026-08-01: 머지된 브랜치를 지우려는데 게이트가 리뷰를 요구해 막혔다).
// git은 `--delete`가 붙으면 나열된 ref를 **전부** 삭제한다(혼합 불가)라 세그먼트 단위로 안전하게 판정 가능.
// ⚑ 토큰은 그 세그먼트의 `push` **뒤**만 본다 — 안 그러면 `git tag -d v1 && git push origin main`처럼
//   아주 흔한 결합 명령에서 앞쪽 -d가 뒤쪽 진짜 push를 면제해 **리뷰 안 받은 코드가 통과**한다
//   (plan-validator high). 세그먼트 분리(isDeploy와 같은 분할기)와 이 위치 제한이 같이 있어야 닫힌다.
// 알려진 한계(정직): (a) git이 허용하는 장옵션 축약 `--de`는 exact 토큰이 못 알아봐 게이트가 그대로
//   발동한다(과차단 = 안전 방향) (b) 셸 주석 뒤 `-d`(`git push origin main # cleanup -d`)는 git엔 안 닿는데
//   여기선 보인다 (b') 형제 사례 — git이 **값으로 먹는 옵션 뒤의 `-d`**(`git push --repo -d origin main` ·
//   `git push -o -d origin main`)는 삭제가 아닌데 여기선 삭제로 본다(pr-reviewer low). (b)·(b')는 둘 다
//   탈출 방향이지만 고의 조립이 필요한 클래스라 수용 — 다음에 손볼 때 값 소비 옵션(--repo·-o·--push-option·
//   --receive-pack·--exec) 뒤 토큰 1개 건너뛰기가 후속 후보. 콜론 refspec 삭제(`git push origin :foo`)는 미처리 — 혼합
//   (`:old new`)이 가능해 파싱이 커지고, 안 고치면 "게이트를 더 요구"라 안전측이다.
function isDeleteOnlyPush(seg) {
  const toks = String(seg || "").trim().split(/\s+/);
  const i = toks.indexOf("push");
  if (i === -1) return false;
  for (let j = i + 1; j < toks.length; j++) {
    if (toks[j] === "--delete" || toks[j] === "-d") return true;
  }
  return false;
}
function isPush(toolName, toolInput) {
  if (toolName !== "Bash") return false;
  const cmd = String((toolInput && toolInput.command) || "");
  // 삭제 아닌 push 세그먼트가 하나라도 있으면 게이트 발동.
  for (const seg of shellSegments(cmd)) {
    if (PUSH_RE.test(seg) && !isDeleteOnlyPush(seg)) return true;
  }
  return false;
}

// ── P1 plan-validator 리마인더(soft) ────────────────────────────────────────
// "이번 세션에 plan 문서(.md, 경로에 plan)를 썼는데 plan-validator 없이 코드 수정을 시작"의
// 첫 1회만 참(무상태 1회 보장 — plan 이후 코드 수정 흔적이 이미 있으면 침묵).
// 차단이 아니라 리마인더 주입 판정. 넓은 감지보다 소음 회피 우선(스펙 🙋 합의: plan 파일명 휴리스틱).
// 새 plan을 다시 쓰면 재무장(validated·codeEdited 리셋 — 새 plan은 새 검증 대상). 순수함수(fs 없음).
const EDIT_TOOLS_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
function isPlanDocPath(p) { const s = String(p || ""); return /\.md$/i.test(s) && /plan/i.test(s); }
// v0.43.1: 어느 저장소 diff에도 못 들어가는 임시·스크래치 위치는 코드가 아니다 —
// 실측(honclwd 최근 트랜스크립트 12개): 코드로 계상된 편집 192건 중 43건(22%)이 저장소 밖 스크래치라
// 저장소를 안 건드렸는데 리뷰가 헛되이 stale이 됐다.
// ⚑ 앵커 주의: `/tmp/`·`/var/tmp/`는 **선두 앵커**로만 본다. substring으로 짜면
//   `~/projects/myrepo/tmp/build.js`(Rails·빌드 산출물 등 저장소 안 tmp)까지 면제돼
//   **진짜 코드 수정이 리뷰를 안 무효화**한다(plan-validator medium · 탈출 방향).
//   `/.cache/claude-tmp/`는 디렉토리명이 고유해 substring 허용. `scratchpad/`는 별도 규칙을 두지 않는다
//   (위 둘에 포섭 · "어디서나 scratchpad/"로 열면 저장소 안 같은 이름 폴더가 면제되는 구멍).
// 남는 오탐(정직): `~/.bashrc` 같은 홈 설정파일은 여전히 코드로 계상된다 — 과차단이라 안전측으로 수용.
//   "cwd 하위만 코드"로 뒤집지 않는 이유: 워크트리 작업(다른 저장소를 고치고 그쪽을 push)에서
//   진짜 리뷰 대상이 면제되는 구멍이 생긴다.
// 주의(부수효과): 이 함수는 hasPrReviewer 말고 planReminderNeeded(P1 소프트 리마인더)도 쓴다.
const SCRATCH_ROOT_RE = /^\/(?:var\/)?tmp\//;
function isScratchPath(s) {
  return SCRATCH_ROOT_RE.test(s) || s.indexOf("/.cache/claude-tmp/") !== -1;
}
function isCodeTarget(p) {
  const s = String(p || "");
  if (!s) return false;
  if (/\.mdx?$/i.test(s)) return false;      // 문서는 구현 아님
  if (/(^|\/)docs\//i.test(s)) return false; // docs/ 밑도 문서
  if (isScratchPath(s)) return false;        // 임시·스크래치는 어느 diff에도 안 들어감
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

// ── 디자인 레지스트리 조회 리마인더(soft, Claude 전용) ───────────────────────
// UI 파일(디자인이 걸리는 확장자)인가. 로직 .ts/.js는 소음 회피 위해 제외.
// 한계(정직): plain .js/.ts 컴포넌트(CRA App.js·styled-components in .ts)는 미탐 — 소프트 넛지라
// '침묵 쪽 실패'는 안전, 대표 스택(React+Tailwind=.tsx)엔 충분.
const UI_TARGET_RE = /\.(tsx|jsx|vue|svelte|astro|css|scss)$/i;
function isUiTarget(p) { return UI_TARGET_RE.test(String(p || "")); }
// 이 tool_use가 레지스트리 조회 흔적인가: design-system*.md Read 또는 design-system 스킬 로드.
function consultedRegistry(b) {
  const nm = String((b && b.name) || ""); const inp = (b && b.input) || {};
  if (nm === "Read" && /design-system[^/]*\.md/i.test(String(inp.file_path || ""))) return true;
  if (nm === "Skill" && /design-system/.test(String(inp.skill || ""))) return true;
  return false;
}
// "UI 파일 첫 수정인데 이번 세션에 레지스트리를 조회한 흔적이 없다"의 첫 1회만 참.
// 조회함(위) → 침묵. 이미 UI 편집(1회 보장) → 침묵. 순수함수(fs 없음). planReminderNeeded 형제.
function designRegistryReminderNeeded(objs, toolName, toolInput) {
  if (!EDIT_TOOLS_RE.test(String(toolName || ""))) return false;
  const ti = toolInput || {};
  if (!isUiTarget(ti.file_path || ti.notebook_path)) return false;
  if (!Array.isArray(objs)) return false;
  for (const o of objs) {
    const m = (o && o.message) || o; const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      if (consultedRegistry(b)) return false;
      if (EDIT_TOOLS_RE.test(String(b.name || "")) && isUiTarget((b.input || {}).file_path || (b.input || {}).notebook_path)) return false;
    }
  }
  return true;
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
const PROTECTED_REF = /\.(?:claude|chageun)\b|(?:pre|post)tooluse[^/\s]*\.js\b|secret-scan[^/\s]*\.js\b|finish-work[^/\s]*\.(?:js|mjs)\b/i;
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
  return shellSegments(cmd).some((seg) => GIT_COMMIT.test(seg)); // 분할기는 한 곳(shellSegments)만 — 사본이 갈리면 조용히 표류(pr-reviewer [정리])
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
const PROTECTED = /(^|\/)\.(?:claude|chageun)(\/|$)|(^|\/)settings(\.local)?\.json$|(^|\/)hooks(\/|$)|(?:pre|post)tooluse[^/]*\.js$|secret-scan[^/]*\.js$|finish-work[^/]*\.(?:js|mjs)$/i;
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

// ── 리뷰 에이전트 격리(Claude 서브에이전트 한정) ──────────────────────────────
// plan-validator·pr-reviewer가 "리뷰만·자기 agent-memory에만 쓰기"라는 자기 계약(에이전트 문서
// pr-reviewer의 "Bash는 git 전용·npm/node 금지"·"Write/Edit는 agent-memory만")을 어기고 프로젝트
// 메모리 수정·git checkout을 한 실측 사고(2건) 봉합. 산문을 기계로 참되게 만든다. 순수함수(fs 없음) —
// 훅 초반·fail-closed로 배선. 네임스페이스 무관 매칭(honclwd→chageun 리브랜드 전례: 접두사 하드코딩이면
// 리네임에 무음 해제). code-implementer·메인 세션은 대상 아님(호출부가 isReviewAgent로 가드).
const os = require("os");
const REVIEW_AGENT_RE = /(?:^|:)(plan-validator|pr-reviewer)$/;
function isReviewAgent(agentType) {
  return typeof agentType === "string" && REVIEW_AGENT_RE.test(agentType);
}
const AGENT_MEM = path.join(os.homedir(), ".claude", "agent-memory");
// symbolic-ref(HEAD 재기록)·reflog(expire/delete로 복구로그 파기)는 변경 명령이라 제외(pr-reviewer low).
// v0.42: `branch` 추가 — 실측 32건의 리뷰 차단 중 3건이 읽기 전용 branch 조회였다
// (`--show-current` 2 · `--contains` 1). 단 branch는 **읽기 형태만** 통과시킨다(아래 branchArgsAllowed).
const GIT_READ_SUB = /^(?:diff|log|status|show|ls-files|ls-tree|blame|rev-parse|rev-list|shortlog|describe|cat-file|for-each-ref|name-rev|whatchanged|grep|branch)$/;
// `branch`는 **allowlist로만** 연다. 거부목록으로 만들면 뚫린다(plan-validator F-5):
//   (a) `git branch 새이름` 은 **옵션이 하나도 없는 쓰기**라 거부목록이 원천적으로 못 잡는다
//   (b) 장형 `--delete/--move/--copy` (c) 단형 `-f` (d) git이 허용하는 접두 축약(`--del`) (e) 묶음 `-rd`
// allowlist는 (d)(e)를 공짜로 막는다 — 모르는 형태는 전부 거부이기 때문이다(과차단은 안전 방향).
// 값을 하나 먹는 플래그는 그 다음 토큰을 소비해야 positional 로 오인하지 않는다.
const BRANCH_READ_FLAG = /^(?:--show-current|--list|--all|--remotes|--verbose|--contains|--no-contains|--merged|--no-merged|--points-at|--format|--sort|--color|--no-color|--ignore-case|--column|--no-column|--omit-empty)$/;
const BRANCH_READ_BUNDLE = /^-[avrli]+$/;                    // -a · -r · -v · -vv · -l · -i 및 그 묶음(-av 등)
const BRANCH_VALUE_FLAG = /^(?:--contains|--no-contains|--merged|--no-merged|--points-at|--format|--sort)$/;
function branchArgsAllowed(args) {
  if (!args.length) return true;                              // bare `git branch` = 목록 조회(읽기 전용)
  for (let k = 0; k < args.length; k++) {
    const t = args[k];
    if (t === "--") return false;                             // 이후는 전부 positional
    if (t.charAt(0) !== "-") return false;                    // positional → `git branch 새이름`·`-m a b` 류
    const head = t.split("=")[0];
    if (BRANCH_READ_BUNDLE.test(head)) continue;
    if (!BRANCH_READ_FLAG.test(head)) return false;           // 모르는·쓰기 플래그 → 거부
    if (BRANCH_VALUE_FLAG.test(head) && t.indexOf("=") === -1) k += 1;  // 값 소비(그 토큰은 positional 아님)
  }
  return true;
}
// 읽기 필터(파이프 우측): stdin→stdout만, 위치인자 파일쓰기 불가한 것만. sort(-o)·uniq(OUTPUT 위치인자)·
// less/more(대화형 !cmd)는 쓰기·탈출 가능해 제외(plan-validator medium).
const READ_FILTER = /^(?:head|tail|grep|egrep|fgrep|wc|cat|cut|nl|tr)$/;
// 따옴표를 셸 규칙대로 훑어 지운다(왼→오 한 번, 먼저 열린 쪽이 이긴다). 반환 null = 안전측 거부.
// 옛 구현(정규식 짝짓기)에 실측 재현된 침투 경로 3개가 있었다:
//  (1) `git log --grep="$(id > /tmp/x)"` — 큰따옴표 내용을 먼저 지워 `$(` 검사를 통과했다(셸은 그 안을 실제 실행).
//  (2) `git log --grep="don't" && rm -rf /tmp/x && git log --grep="won't"` — 큰따옴표 속 아포스트로피 2개가
//      짝지어져 가운데(`rm -rf`)가 통째로 사라졌다.
//  (3) 닫히지 않은 따옴표를 그냥 통과시켰다.
// 작은따옴표 안은 셸이 아무것도 확장하지 않으므로 버린다. **여기에 백슬래시 이스케이프 처리를 넣으면 즉시
// 뚫린다**(`git log --grep='\' ; id #'` — bash에선 `id`가 실행된다. plan-validator medium, 테스트로 못 박음).
// 큰따옴표 안은 치환·확장이 일어나므로 `$(`·백틱·`${`만 거부한다 — `git grep -n "TODO$"` 같은 정규식 끝
// 앵커의 `$`는 셸이 리터럴로 두므로 통과시킨다(무조건 거부하면 흔한 코드 검색이 새로 막힌다. plan-validator high).
// 따옴표 구간·이스케이프는 공백이 아니라 **자리표시 한 글자**로 바꾼다 — 공백으로 지우면 토큰이 사라져
// `git -C "/mnt/g/내 드라이브/proj" diff`가 `git -C diff`가 되고, `-C`가 뒤 두 토큰을 먹는 규칙 때문에
// 서브명령이 없어져 정상 명령이 막혔다(pr-reviewer medium — 새 안내문이 권한 관용구가 공백 경로에서 못 쓰임).
// 인용 구간을 **통째로 지우지 않는다.** 셸은 따옴표를 벗겨 원문 그대로를 git argv로 넘기므로, 인용됐다는
// 이유로 내용을 감추면 위험 옵션 denylist가 통째로 비켜간다(실측 4형 — 전부 셸에서 실행됐고 훅은 통과했다):
//   `git grep '--open-files-in-pager=touch X' TODO` · `git grep "-Otouch X" TODO` ·
//   `git log \\--output=X`(백슬래시로 첫 대시 가리기) · `git grep '--open'-files-in-pager='touch X' TODO`
// 그래서 **토큰 모양을 드러내는 안전 글자는 그대로 내보내고**, 구분자·확장·공백처럼 위험한 글자만 자리표시로
// 바꾼다. head·서브명령은 allowlist(가려지면 오히려 막힘)라 안전 방향이었지만 옵션 검사만 denylist라 반대였다.
// (pr-reviewer high 2차. 이 구멍은 이번 델타가 만든 게 아니라 1차 봉합본에도 있었다.)
const QTOK = "\u0001";
const SAFE_IN_QUOTE = /[A-Za-z0-9\-._/=+:@,%~^]/;
function stripQuotes(s) {
  const src = String(s);
  let out = "", q = null, ansiC = false;
  const emit = (ch) => { out += SAFE_IN_QUOTE.test(ch) ? ch : QTOK; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q === null) {
      if (c === "\\") { emit(src[++i] || ""); continue; }             // 따옴표 밖 이스케이프 → 다음 글자는 리터럴(구분자 아님)
      // `$'...'`(ANSI-C 인용)·`$"..."`는 확장이 아니라 **인용의 한 형태**다 — 리뷰 실무에서 CR·이모지 검색에
      // 실제로 쓰인다(`git grep -c $'\\r$' HEAD -- f`). 인용으로 인식해야 (a) 정상 사용이 안 막히고
      // (b) `$'-Oid'`처럼 인용으로 대시를 감추는 것도 안전 글자 보존 덕에 옵션 검사에 그대로 드러난다.
      if (c === "$" && (src[i + 1] === "'" || src[i + 1] === '"')) { q = src[++i]; ansiC = q === "'"; continue; }
      if (c === "'" || c === '"') { q = c; ansiC = false; continue; }  // 따옴표 문자 자체는 버린다(토큰 접합 보존)
      out += c; continue;
    }
    // `$'...'` 안에서만 백슬래시가 이스케이프다. **수치 이스케이프는 디코드한다** — bash가 `\x2d`·`\055`·`\u002d`를
    // 디코드해 대시를 만들어내므로, 글자만 보는 스캐너와 argv가 갈라진다(실측: `git grep $'\x2dOtouch X' TODO`가
    // 실제로 파일을 만들었다). 이름 이스케이프(`\r \n \t \a \b \e \f \v \\ \' \"`)는 값이 제어문자·구두점이라
    // 대시를 못 만들어 그대로 통과 — 실무 관용구 `$'\r$'`(CR 검색)가 살아 있는 이유다. (pr-reviewer high 4차)
    if (ansiC && c === "\\") {
      const e = src[++i] || "";
      let code = null, m = null, rest = src.slice(i + 1);
      if (e === "x" && (m = /^[0-9a-fA-F]{1,2}/.exec(rest))) { code = parseInt(m[0], 16); i += m[0].length; }
      else if (e === "u" && (m = /^[0-9a-fA-F]{1,4}/.exec(rest))) { code = parseInt(m[0], 16); i += m[0].length; }
      else if (e === "U" && (m = /^[0-9a-fA-F]{1,8}/.exec(rest))) { code = parseInt(m[0], 16); i += m[0].length; }
      else if (/[0-7]/.test(e) && (m = /^[0-7]{0,2}/.exec(rest))) { code = parseInt(e + m[0], 8); i += m[0].length; }
      // 수치 이스케이프는 **디코드해서** 내보낸다 — 거부해버리면 이모지·바이트 검색(`$'\xe2\x9c\x89'`) 같은
      // 실무 명령이 막히고, 그대로 글자로 두면 bash가 만드는 값과 갈라진다(`$'\x2dOid'` → argv `-Oid`, 실측 실행됨).
      // 디코드하면 `\x2d`는 `-`로 드러나 옵션 검사에 걸리고, 이모지 바이트는 안전 글자가 아니라 자리표시로 남는다.
      // `\U`는 8자리라 0x10FFFF를 넘을 수 있고 그러면 fromCodePoint가 던진다(훅 try/catch가 fail-closed로
      // 받지만 판정이 아니라 예외 경로에 기대게 된다) → 범위 밖은 글자 방출로 폴백(그 값으론 대시를 못 만든다).
      if (!(code >= 0 && code <= 0x10ffff)) code = null;
      emit(code === null ? e : String.fromCodePoint(code));
      continue;
    }
    if (q === '"') {
      if (c === "\\") { emit(src[++i] || ""); continue; }             // `"\$"` 등 — 다음 글자는 리터럴
      if (c === "$" && /[({]/.test(src[i + 1] || "")) return null;    // 명령치환 `$(` · 중괄호확장/함수치환 `${`
      if (c === "`") return null;                                    // 백틱 치환
    }
    if (c === q) { q = null; continue; }
    emit(c);                                                         // 인용 안: 안전 글자만 드러내고 나머지는 자리표시
  }
  return q === null ? out : null;                                    // 닫히지 않은 따옴표 → 거부(fail-closed)
}
function bashSegmentAllowed(rawSeg) {
  const seg = String(rawSeg).trim();
  if (!seg) return true;
  const stripped = stripQuotes(seg);
  if (stripped === null) return false;                         // 따옴표 미닫힘·큰따옴표 속 치환 → 거부
  if (/[<>]|\$\(|`/.test(stripped)) return false;              // 리다이렉션·명령치환 금지
  const toks = stripped.split(/\s+/).filter(Boolean);
  // **불변식: 스캐너가 본 토큰 == 셸이 git에 넘기는 argv.** 이게 성립해야 아래 옵션 denylist가 의미를 갖는다.
  // 이 판정기는 머리·서브명령이 앵커된 allowlist(가려지면 오히려 막힘)인데 **옵션 검사만 denylist**라,
  // 셸이 토큰을 나중에 다시 쓰는 수법마다 구멍이 났다 — 실측 3회차: (1) 옵션 축약·묶음 (2) 인용·이스케이프로
  // 첫 글자 가리기 (3) 확장으로 가리기. 그래서 수법이 아니라 **다시 쓰기 자체**를 막는다.
  // 인용 안은 이미 자리표시로 중화됐으므로 여기 남은 것은 전부 "따옴표 밖"이다:
  //   · `$` — 변수·명령·산술 확장. `git grep -${x}Oid TODO`는 미설정 변수가 지워져 argv가 `-Oid`가 되고 실제 실행됐다.
  //   · `{a,b}`·`{1..9}` — 중괄호 확장. `{-Oid,x}`는 `-Oid x`로 펼쳐진다(`HEAD@{1}`·`HEAD^{tree}`는 콤마·범위가
  //     없어 셸이 리터럴로 두므로 통과 — 이 둘은 git 리비전 관용구다).
  //   · 글롭(`*`·`?`·`[`) — 그 이름의 파일이 있으면 토큰이 통째로 바뀐다(`*Oid` → `-Oid`). 선두 글롭과 **옵션 이름부**
  //     (첫 `=` 앞) 글롭을 거부한다. 값부 글롭(`--include=*.ts`)은 **옵션 이름이 온전해** 검사가 그대로 본다 —
  //     "선두 `-`가 유지된다"가 아니라 이름의 온전함이 진짜 근거다(pr-reviewer 4차).
  // 글로빙이 필요하면 따옴표를 씌운다(`git log -- '*.ts'`) — git이 직접 글롭하는 권장형이라 실무 손실이 없다.
  // (pr-reviewer high 3차 — 뿌리 처방. 남은 이론적 잔여는 F-24 정직 고지에 적었다.)
  for (const t of toks) {
    if (t.includes("$")) return false;                          // 확장 일체
    if (/\{[^}]*,|\{[^}]*\.\./.test(t)) return false;             // 중괄호 확장(콤마·범위만 — `@{1}`·`^{tree}`는 리터럴)
    if (/^[*?[]/.test(t)) return false;                         // 선두 글롭 → 토큰이 통째로 바뀔 수 있다
    // 옵션 **이름부**(첫 `=` 앞)의 글롭도 거부 — `git grep -n* TODO`는 트리에 `-nO…` 파일이 있으면 그 이름으로
    // 대체돼 실행된다(실측 재현). 값부 글롭(`--include=*.ts`)은 이름이 온전해 옵션 검사가 그대로 본다.
    // "선두 `-`가 유지된다"가 아니라 **옵션 이름이 온전한가**가 진짜 근거였다(pr-reviewer medium 4차).
    if (/^-/.test(t) && /[*?[]/.test(t.split("=")[0])) return false;
  }
  if (toks.length === 0) return true;
  if (/^[A-Za-z_]\w*=/.test(toks[0])) return false;            // 선두 env 프리픽스 금지(PAGER=… 등)
  const head = toks[0];
  if (READ_FILTER.test(head)) return true;
  if (head !== "git") return false;
  let i = 1;
  while (i < toks.length && toks[i].startsWith("-")) {          // git 글로벌 옵션 처리
    const t = toks[i];
    if (t === "-c") return false;                              // 설정/파거 주입 차단
    if (t === "-C") { i += 2; continue; }                      // dir 인자 소비
    if (t.startsWith("--git-dir") || t.startsWith("--work-tree")) { i += 1; continue; }
    if (t === "--no-pager") { i += 1; continue; }
    return false;                                              // 알 수 없는 글로벌 옵션 → 안전측 거부
  }
  if (!GIT_READ_SUB.test(toks[i] || "")) return false;
  // branch 는 읽기 형태만(위 branchArgsAllowed 주석 참조). 쓰기형은 여기서 걸린다.
  if (toks[i] === "branch" && !branchArgsAllowed(toks.slice(i + 1))) return false;
  // (pr-reviewer low) 읽기 서브명령이어도 파일쓰기·명령실행 옵션은 차단:
  // git diff --output=경로(파일 씀), git grep -O<cmd>/--open-files-in-pager(명령 실행).
  // 끝앵커 `--open-files-in-pager$`가 **등호형을 빠뜨려** 임의 명령이 실행됐다(실측 재현).
  // 이름 문자열 대조는 git의 **축약·묶음 표기**에 뚫린다 — 실측(2026-07-30, 빈 저장소):
  //   `git grep --op=touch M TODO` 실행됨 · `--ope`·`--open`·`--open-f` 전부 실행됨(`--o`만 모호로 거부),
  //   `git grep -nO'touch M' TODO`(묶음형) 실행됨. pager는 `use_shell=1`이라 `sh -c`로 넘어간다.
  // → `^--op`(축약 최소단위부터) + `^-[A-Za-z]*O`(묶음)로 넓힌다. 허용 서브명령 중 `--op*`로 시작하는
  // 다른 옵션은 없어 과차단 위험 없음(`--oneline`은 `--on`, git grep `--or`는 `--or`).
  // `--output`은 등호형·단독형만 — 축약(`--out`·`--outp`)은 `--output-indicator-*`와 모호해 git이 거부하고,
  // `--output-indicator-new=X`는 파일을 안 쓰는데 프리픽스 매칭에 걸렸다(low, 실측 확인).
  for (let j = i + 1; j < toks.length; j++) {
    if (/^--output(?:=|$)|^--op|^-[A-Za-z]*O/.test(toks[j])) return false;
  }
  return true;
}
// 리뷰 에이전트의 도구 호출 판정: 쓰기는 agent-memory 안만, Bash는 git 읽기 허용목록만. 사유 or null.
function reviewAgentBlock(agentType, toolName, toolInput) {
  const name = String(toolName || "");
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) {
    let fp = String((toolInput && (toolInput.file_path || toolInput.notebook_path)) || "");
    if (!fp) return "ra-write";
    if (fp.startsWith("~")) fp = path.join(os.homedir(), fp.slice(1));   // ~ 확장(path.resolve는 ~ 미확장)
    const abs = path.resolve(fp);
    const rel = path.relative(AGENT_MEM, abs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return "ra-write";  // 형제폴더·이탈·빈/상대 차단
    return null;
  }
  if (name === "Bash") {
    // 따옴표를 먼저 떼고 조각낸다 — 따옴표 속 `|`(`git grep 'a|b'`의 정규식 교대 등)를 셸 파이프로
    // 오인해 정상 명령을 과차단하던 것 방지(pr-reviewer low). 단일 `&`(백그라운드)도 분할에 포함.
    const cmd = stripQuotes(String((toolInput && toolInput.command) || ""));
    if (cmd === null) return "ra-bash";                          // 따옴표 미닫힘·큰따옴표 속 치환 → 거부
    for (const seg of cmd.split(/&&|\|\||[;|&\n]/)) if (!bashSegmentAllowed(seg)) return "ra-bash";
    return null;
  }
  return null;  // 그 외 도구(Read/Grep/Glob 등 — 매처에도 없음)는 관여 안 함
}

// ── 게이트 모델 런타임 강등 가드(v0.42 · Claude 전용) ────────────────────────
// gate-model-tier.test.mjs 는 **frontmatter만** 본다. 그런데 Task/Agent 호출의 `model` 파라미터는
// frontmatter를 덮어쓴다 — 실측: 한 세션이 plan-validator 를 `model: "opus"` 로 띄웠고(frontmatter는
// fable), "게이트 규칙대로 Opus"라는 잘못된 믿음까지 적혀 있었다. 아무 층도 이걸 안 막았다.
// 등급표를 **여기(core)에 두고** 테스트가 "core == 각 agent frontmatter" 를 대조한다(사본 2개로 고정 —
// 세 번째 사본은 모델 마이그레이션 때 한 곳만 올려 가드가 조용히 죽는 길이다).
const GATE_MODEL_TIER = { haiku: 1, sonnet: 2, opus: 3, fable: 4 };
// 게이트별 기본(=frontmatter의 model:). 테스트가 lockstep으로 묶는다.
const GATE_DEFAULT_MODEL = { "plan-validator": "fable", "pr-reviewer": "fable" };
// subagent_type 은 "plan-validator" 와 "chageun:plan-validator" 두 형태로 온다 — 네임스페이스 무관
// 매칭(REVIEW_AGENT_RE와 같은 이유). 순진한 동등 비교면 네임스페이스 형태에서 조용히 죽는다.
function gateOf(agentType) {
  const m = /(?:^|:)(plan-validator|pr-reviewer)$/.exec(String(agentType || ""));
  return m ? m[1] : null;
}
// Task/Agent 로 게이트를 띄우면서 등급표상 기본보다 **낮은** 모델을 명시했으면 사유, 아니면 null.
// 오차단 0 요건: 모델 미명시(상속) 통과 · 게이트 아닌 에이전트 통과 · 동급 이상 통과 ·
// **등급표에 없는 값 통과(fail-open)** — 모르는 값을 막으면 오차단이고, 이건 백스톱이지 유일 방어선이 아니다.
function gateModelBlock(toolName, toolInput) {
  if (!AGENT_TOOLS_RE.test(String(toolName || ""))) return null;
  const inp = toolInput || {};
  const gate = gateOf(subagentOf(inp));
  if (!gate) return null;
  const asked = String(inp.model || "").toLowerCase();
  if (!asked) return null;                                   // 미명시 = frontmatter 상속 → 정상
  const want = GATE_DEFAULT_MODEL[gate];
  const a = GATE_MODEL_TIER[asked], w = GATE_MODEL_TIER[want];
  if (!a || !w) return null;                                 // 모르는 값 → fail-open
  return a < w ? "gate-model-downgrade" : null;
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

module.exports = { block, reasonFor, isPrCreate, isPush, hasPrReviewer, planReminderNeeded, routingReminderNeeded, designRegistryReminderNeeded, isUiTarget, unattendedBlock, isEgress, isWriteSql, reasonForUnattended, budgetStep, isGitCommit, BUDGET, isReviewAgent, reviewAgentBlock, branchArgsAllowed, gateModelBlock, GATE_MODEL_TIER, GATE_DEFAULT_MODEL };
