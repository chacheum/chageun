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
//
// ⚠ **판단 축은 하나다: 이 명령을 거치면 시크릿 값 문자열이 원문 그대로 남는가.**
// 뒤의 마스킹(`secret-scan-core.js` 의 `redact`)은 `out.split(value).join(marker)` 로 **값을 글자 그대로**
// 찾아 지운다. 그러니 값이 원문 그대로면 뒤에서 가려지고(막을 이유 없음), 값의 글자가 달라지면 못 찾는다(막아야 함).
// "위험해 보이나"로 판단하면 정상 작업만 막는다 — 평문 읽기(`cat .env`)가 애초에 통과인 규칙이다.
//
// ⚠ 단 **뒤의 마스킹도 전부는 못 가린다.** `envFiles` 는 현재 작업 폴더 아래 깊이 2까지의 `.env`·`.env.*`
// 만 읽는다(점으로 시작하는 폴더·node_modules·.git 은 건너뛰고 최대 20개). 다른 프로젝트 폴더의 파일이나
// `prod.env` 같은 이름은 **평문도 안 가려진다** — "평문은 어차피 가려진다"는 그 범위 안에서만 참이다.
//
// **실측 2026-08-10:** 낱말 목록만 보던 판이 정상 작업을 **91번 오차단**했다. 그중
//   - 24건은 `.env` 가 파일이 아니었다(`process.env` · `{{range .Config.Env}}`)
//   - 39건은 `tr` 이 `tr -d '"'` 처럼 값을 안 바꾸는 용법이었다(키 이름 뽑기는 이 규칙의 안내문이 권하는 행동인데 그걸 막았다)
//   - 11건은 `git rev-parse` 의 `rev` 처럼 명령이 아닌 자리에서 낱말만 걸렸다
// 지금 판은 같은 91건 중 60건을 풀고, 표본 38건(우회 21 + 정상 17)을 전부 의도대로 판정한다.
//
// 🛑 **한 번 거꾸로 만들었다(2026-08-10, pr-reviewer 가 high 로 되돌림).** 중간 판이 `tr` 을 "줄바꿈을
// 지우면 차단"으로 잡았는데, 위 축으로 보면 정반대다 — 줄바꿈을 지워도 값은 그대로라 마스킹이 잡고,
// 오히려 rot13·대문자화처럼 **글자를 바꾸는** 쪽이 마스킹을 벗어난다. 같은 판이 인코더를 "명령 자리"로
// 좁히다가 백틱 · `docker exec` · `ssh` · `sh -c` · `find -exec` · `sudo` 여섯 갈래를 새로 열었다.
// **이 규칙을 손댈 땐 먼저 `redact` 구현을 열어 축을 확인하라.**

// (1) `.env` 앞에 낱말 문자가 오면 파일 이름이 아니다 — `process.env` 를 뺀다.
const ENV_REF_RE = /(?<![A-Za-z0-9_])\.env\b(?!\.(?:example|sample|template|dist))/i;
// (2) 인코더는 **자리를 안 따진다**(래퍼·백틱·컨테이너·원격 실행을 다 덮어야 한다).
//     대신 "글자로만 등장하는" 경우를 뺀다: 앞에 `=` 가 오거나 뒤에 `:`·`-` 가 붙으면 명령이 아니라
//     값의 형식을 가리키는 문자열이다(`^APP_KEY=base64:` · `base64-format`).
const ENCODER_RE = /(?<![=\w])\b(?:base64|xxd|hexdump|uuencode|openssl\s+enc)\b(?![:\-\w])/;
//     `rev` 는 오차단의 유일한 원인이었다 — 하위명령 형태(`git rev-parse`·`rev-list`)만 뺀다.
const ENCODER_REV_RE = /\brev\b(?!-)(?<!git rev)/;
//     짧은 이름(`od`·`dd`·`fold`·`tr`·`cut`)은 아무 데나 나온다(`mm/dd/yyyy` · `ls -tr`).
//     그래서 이 다섯만 **명령 자리**를 따진다. 단 자리를 따지면 래퍼 뒤가 사각이 되므로
//     (`docker exec app od …` · `sudo dd …` · `find … -exec od …`) 래퍼 낱말 뒤도 명령 자리로 인정한다.
//     `git` 은 목록에 없다 — 넣으면 `git rev-parse` 오차단 11건이 돌아온다.
//     래퍼와 명령 사이의 낱말은 **없을 수도 있다**(`sudo dd` 는 바로 붙고 `docker exec app od` 는 둘이 낀다).
const WRAPPER = "(?:(?:sudo|env|command|nohup|time|timeout|xargs|exec|sh|bash|zsh|docker|ssh|find)\\s+(?:[^|;&\\n]*?\\s+)?)?";
const CMD_POS = "(?:^|[|;&(`]|\\n)\\s*" + WRAPPER;   // `[(]` 가 `$(` 도 받는다
const ENCODER_SHORT_RE = new RegExp(CMD_POS + "(?:od|dd|fold)\\b");
const hasEncoder = (cmd) => ENCODER_RE.test(cmd) || ENCODER_REV_RE.test(cmd) || ENCODER_SHORT_RE.test(cmd);

// (3) `cut` — 잘라낸 결과에 값이 **원문 그대로** 남으면 마스킹이 잡으니 막지 않는다.
//     열린 끝(`-f2-`)은 나머지 필드를 구분자로 다시 이어 붙여 원문이 나온다 → 통과.
//     닫힌 지정에 2 이상이 있으면(`-f2`·`-f1,2`·`-f2-3`) 값이 잘려 마스킹을 벗어난다 → 차단.
//     글자·바이트 자르기(`-c`·`-b`)는 언제나 값을 자른다 → 차단.
function cutSlicesValue(cmd) {
  for (const m of cmd.matchAll(/(?<![-\w])cut\b([^|;&\n]*)/g)) {
    const args = m[1];
    if (/(?:^|\s)(?:-[cb]|--characters|--bytes)[= ]?\S/.test(args)) return true;
    // `-f` 는 **모두** 본다. 하나만 보면 `cut -d= -f1 -f2` 가 첫 칸만 읽혀 통과한다.
    for (const f of args.matchAll(/(?:^|\s)(?:-f|--fields[= ])\s*(\S+)/g)) {
      const spec = f[1];
      if (spec.endsWith("-")) continue;
      if (/(?:^|[,-])(?:[2-9]|\d{2,})/.test(spec)) return true;
    }
  }
  return false;
}

// (4) `tr` — 값의 글자를 바꾸면 마스킹이 못 찾는다. **값을 안 바꾸는 쓰임만** 통과시킨다.
//     통과: `-d` 로 따옴표·공백·`=`·줄바꿈만 지우기(`tr -d '"'`) · 공백류를 바꾸기(`tr '\n' ' '`).
//     차단: rot13(`tr 'A-Za-z' 'N-ZA-Mn-za-m'`) · 대문자화(`tr a-z A-Z`) · 그 밖의 문자 삭제.
//     🛑 이스케이프는 **짝으로** 매치한다. 문자군 `[\\nrt]` 로 적으면 역슬래시·`n`·`r`·`t` 가 각각
//     안전으로 풀려 `tr 'nrt' 'xyz'` 가 통과한다(2026-08-10 리뷰가 high 로 잡음 — 실제로 그렇게 썼다).
//     시크릿 값에 n·r·t 는 거의 항상 들어 있어 그 세 글자만 바꿔도 마스킹을 벗어난다.
const TR_SAFE_DELETE = /^(?:[\s='"]|\\[nrt])*$/;
const TR_SAFE_FROM = /^(?:\s|\\[nrt])*$/;
function trAltersValue(cmd) {
  for (const m of cmd.matchAll(/(?<![-\w])tr\b([^|;&\n]*)/g)) {
    // 명령치환의 닫는 괄호와 리다이렉션은 인자가 아니다. 떼고 본다.
    // (`$(… | tr -d '"')` · `tr -d '\n' < .env` · `… | tr -d '=' > keys.txt`)
    // 🛑 **꼬리에서만 뗀다. 인자 수집을 `)` 에서 끊지 말 것.** 이 함수는 모아 온 인자 전체가
    //   안전 패턴에 딱 맞아야(`^…$`) 통과시키는 구조라, 수집 범위를 줄이면 위험한 꼬리가
    //   잘려 나가 "안전"으로 떨어진다. 실제로 2026-08-10 에 문자군을 `[^|;&\n)]*` 로 좁혔다가
    //   `tr -d ')aeiou'` 가 통째로 열렸다(캡처가 `-d '` 에서 끊겨 따옴표 한 글자만 남고,
    //   작은따옴표는 안전 문자군이라 통과). `)` 는 셸 문법 밖에도 **따옴표 안에** 올 수 있다.
    //   바로 위 `cutSlicesValue` 는 위험한 것을 찾으면 막는 반대 구조라 같은 좁힘에도 안 열린다.
    // 꼬리 청소가 `)` 뒤의 따옴표까지 먹는 이유: `echo "$(… | tr '\n' ' ')"` 는 괄호 **뒤에
    //   따옴표가 더 붙어** 두 인자 형태로 안 읽혔고 정상 작업이 막혔다(실측 오차단).
    //   중첩 명령치환(`))`)이 있어 반복(`+`)이 필요하다.
    const args = m[1].replace(/\s*[<>]{1,2}\s*\S+/g, "").replace(/(?:\)[\s'"]*)+$/, "").trim();
    // 따옴표 없는 인자에는 따옴표 글자가 올 수 없다(`([^'"\s]+)`). 이게 없으면 꼬리 청소가
    // 짝을 잃은 따옴표 한 글자를 남겼을 때(`tr -d ')'` → `-d '`) 그 한 글자가 "안전한 삭제
    // 문자군"으로 읽혀 통과한다. 짝이 안 맞는 따옴표는 안전으로 치지 않고 막는 쪽으로 떨어뜨린다.
    const del = /^-d\s+(?:'([^']*)'|"([^"]*)"|([^'"\s]+))\s*$/.exec(args);
    const set = del && (del[1] != null ? del[1] : del[2] != null ? del[2] : del[3]);
    if (set != null && TR_SAFE_DELETE.test(set)) continue;
    // 아래 `two` 쪽 좁힘은 **모양을 맞춘 것**이고 현재 판정에는 영향이 없다 — `TR_SAFE_FROM` 이
    // 공백과 `\n`·`\r`·`\t` 만 허용해 따옴표를 애초에 거부한다. 실제 봉합은 위 `del` 쪽이다.
    const two = /^(?:'([^']*)'|"([^"]*)"|([^'"\s]+))\s+(?:'[^']*'|"[^"]*"|\S+)\s*$/.exec(args);
    const from = two && (two[1] != null ? two[1] : two[2] != null ? two[2] : two[3]);
    if (from != null && TR_SAFE_FROM.test(from)) continue;
    return true;
  }
  return false;
}

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
  "plan-size":
    "차단: 계획서가 3,000줄을 넘습니다. **이 크기가 실패한다는 뜻이 아닙니다** — 이 크기부터는 " +
    "게이트도 사람도 통으로 못 읽어 **검증 결과를 믿기 어려워지므로, 계속 갈지 사용자가 정합니다.**\n" +
    "**문서를 쪼개지 마세요**(그 방식은 이미 실패했고 두 문서가 서로 어긋나는 새 문제를 만들었습니다). " +
    "**일을 쪼개세요** — 앞쪽 작업 몇 개만 남기고 나머지는 다음 계획으로 미룬 뒤 다시 부르세요. " +
    "**개정 로그·`재검증 회차` 머리는 지우지 말고 본문을 덜어냅니다**(회차 계수의 출처입니다).\n" +
    "**판단 재료는 이 메시지 맨 끝 `잰 파일`의 줄 수입니다.** 3,700줄 아래면 그 구간엔 잘 끝난 " +
    "계획도 있으니(3,017 · 3,080 · 3,456 · 3,523 · 3,651줄이 모두 코드를 출하했습니다) 승인 후 진행이 " +
    "맞을 수 있습니다. **그보다 크면 알려진 사례 밖이라 쪼개는 쪽을 먼저 권합니다.** " +
    "다만 실측 사고는 **1건**뿐이라(차단 시점 4,020줄·최종 4,043줄 계획이 10회 넘게 재검증되며 " +
    "나흘간 코드 0줄) " +
    "이 숫자들은 통계가 아니라 참고입니다 — 정하는 것은 사용자입니다.\n" +
    "이 크기로 가야 하면 AskUserQuestion 으로 사용자에게 위험을 알리고 승인을 받으세요 — 질문 본문에 " +
    "아래 대괄호 키를 **그대로** 넣고, 선택지 2개 중 **두 번째**를 승인으로 두면 됩니다. " +
    "키는 이 메시지 끝 `(위반:` **바로 뒤 대괄호**입니다 — 대괄호까지 통째로 복사하세요.\n" +
    "**그 질문 본문에 두 가지를 함께 적으세요: (가) 잰 파일 이름과 실제 줄 수 + 3,700과 비교한 결과, " +
    "(나) 왜 멈췄는지 — 이 크기부터는 검증 결과를 믿기 어렵다는 것.** (나)를 빼면 사용자 화면에 " +
    "안심 쪽 절반만 도착해 승인이 고무도장이 됩니다. " +
    "(3,700 아래 예: `my-plan.md는 3,200줄입니다. 이 구간엔 잘 끝난 계획도 있지만, 이 크기부터는 " +
    "게이트도 사람도 통으로 못 읽어 검증 결과를 믿기 어렵습니다`) " +
    "(3,700 초과 예: `my-plan.md는 4,800줄로 알려진 사례 밖입니다 — 쪼개기를 먼저 권합니다. " +
    "이 크기는 게이트도 사람도 통으로 못 읽어 검증 결과를 믿기 어렵습니다`). 이 차단문은 사용자가 " +
    "아니라 당신이 읽습니다 — 안 적으면 사용자 화면엔 승인 키의 천 단위 버킷(`3k`)만 남습니다. " +
    "**아래 형식 요건과 달리 이건 기계가 못 잡으니 전적으로 당신 몫입니다** — 빠지면 사용자는 위험을 " +
    "못 본 채 누릅니다(줄 수 표기를 기계로 대조하면 `3,200`↔`3200` 같은 차이로 승인이 영영 인정 " +
    "안 되는 오차단이 나서 일부러 안 겁니다).\n" +
    "**승인 질문의 형식 요건(하나라도 어긋나면 인정되지 않습니다):** (1) 그 호출에 질문은 **이것 하나만** " +
    "— 다른 질문과 묶지 마세요 (2) `multiSelect`는 **false**(복수 선택 금지) (3) 선택지는 **정확히 2개** " +
    "(4) 사용자가 **두 번째 선택지를 눌러야** 합니다 — 직접 입력한 답은 승인이 아닙니다 " +
    "(5) 키는 질문 본문에 **한 번만**(이 메시지 전문을 붙여넣으면 두 번 들어갑니다).\n" +
    "승인 키에는 잰 줄수가 천 단위로 들어갑니다 — **본문을 덜어 천 단위가 바뀌면 승인을 다시 받아야 합니다**" +
    "(4,020줄 승인은 3,100줄에 안 통합니다. 같은 차단문이 또 떠도 편집이 반영 안 된 게 아닙니다).\n" +
    "잰 파일은 프롬프트에 적힌 계획서 후보 중 **가장 큰 것**입니다 — 이번 검증 대상이 아니라 " +
    "참고로 언급한 옛 계획서라면, 그 경로를 프롬프트에서 빼고 다시 부르세요.\n" +
    "⚠ **검증 대상 계획서 경로를 빼고 다시 부르는 것은 우회이며 규칙 위반입니다**(코어: 게이트에 대상 경로를 항상 넘긴다).",
  "force-push": "차단: `git push --force`는 남의 커밋을 덮어써 되돌리기 어렵습니다. 필요하면 `--force-with-lease`를 쓰세요(안전 강제 push).",
  "rm-recursive": "차단: 루트/홈/현재 트리 전체를 지우는 `rm -rf`는 되돌릴 수 없습니다. 지울 대상 경로를 구체적으로 좁히세요.",
  "sql-destructive": "차단: DROP/TRUNCATE 같은 파괴적 스키마 명령입니다. 운영 데이터라면 되돌릴 수 없으니, 테스트 환경인지·백업이 있는지 먼저 확인하세요.",
  "sql-delete-no-where": "차단: WHERE 없는 DELETE는 테이블 전체를 지웁니다. 조건(WHERE)을 넣거나 대상을 확인하세요.",
  "sql-update-no-where": "차단: WHERE 없는 UPDATE는 테이블 전체를 덮어씁니다. 조건(WHERE)을 넣거나 대상을 확인하세요.",
  "deploy": "차단(배포는 되돌리기 어려움): 사용자 확인 후 진행하려면 세션에 CHAGEUN_ALLOW_DEPLOY=1을 설정하세요(그 세션 동안 배포 검사가 꺼집니다). 이 브레이크는 CLI 배포만 막고 git push→자동배포(Vercel/Netlify 깃연동)는 못 막습니다 — 그건 멈춤 규칙으로 확인하세요.",
  // v0.65.0 F-28: **감독(supervisor)을 띄운 세션도 여기 걸린다**(DELEGATE_AGENTS 주석). 감독은 파일을
  //   안 고치는데도 걸리므로, "코드를 다시 수정했으면"만 적혀 있으면 **코드를 안 고친 사람에게
  //   사실과 다르게 읽힌다.** 그래서 한 조각을 더한다. 🛑 REASONS_SUBAGENT["gate-skip"] 은 안 건드린다
  //   — 감독을 띄우는 것은 메인뿐이라 서브에이전트용 문구가 이 상황을 만날 일이 없고, 그 문구는
  //   회복 경로를 네 회차에 걸쳐 다듬은 자리라 손대면 잃는 것이 크다.
  "gate-skip": "차단: PR 생성·push 전에 pr-reviewer 게이트를 거치세요(이 세션에 신선한 실행 흔적이 없습니다 — 리뷰 후 코드를 다시 수정했으면 재실행이 필요합니다). **감독(`supervisor`)을 띄운 세션도 여기 포함됩니다** — 감독은 파일을 안 고치지만, 감독이 띄운 일꾼이 고쳤을 수 있어 한 번 더 검토를 받습니다. pr-reviewer에게 **재검토를 요청**하세요 — 이미 돌린 리뷰어를 SendMessage로 이어 부른 재검토도 인정됩니다(새 Agent로 다시 띄워도 됩니다. 그땐 **프롬프트에 `재리뷰 회차: N`과 지난 회차 blocker/high 제목을 적으세요** — 새로 띄우면 회차 소스가 그것뿐이라 안 적으면 몇 번째인지 아무도 못 셉니다). 예외로 건너뛰어야 하면 **세션 자체를 CHAGEUN_SKIP_GATE_CHECK=1로 시작**해야 합니다(명령 앞에 인라인으로 붙이는 건 훅 프로세스에 안 닿아 안 켜집니다).",
  "env-encoder": "차단: .env를 인코딩·조각내 노출하려는 시도입니다(G7). 시크릿 값은 화면에 찍지 말고 이름/존재만 다뤄주세요. 설정에 값을 넣어야 하면 값을 출력하지 않는 셸(cp·sed)로 옮기세요.",
  "ra-write": "차단: 리뷰 에이전트는 자기 `~/.claude/agent-memory/` 밖 파일을 수정할 수 없습니다 — 고치지 말고 발견으로 보고하세요. 검토는 Read/Grep으로 계속하세요.",
  "ra-bash": "차단: 리뷰 에이전트의 Bash는 **git 읽기 명령 하나**만 허용됩니다(diff·log·status·show·grep·ls-files·ls-tree·blame·rev-parse·rev-list·shortlog·describe·cat-file·for-each-ref·name-rev·whatchanged·check-ignore, 그리고 **branch는 읽기 형태만** — `--show-current`·`--list`·`--contains`·`-a`·`-r`·`-v` 등이나 인자 없는 `git branch`. 브랜치 이름을 인자로 주거나 `-d`·`-m`·`-f`를 붙이면 쓰기라 막힙니다). 막히는 것: 앞머리 `cd`·`echo`, `2>/dev/null` 같은 오류 감추기, 그 밖의 리다이렉션·명령치환, 다른 명령·파일 쓰기·파괴적 git·테스트 실행. 분량 줄이는 `| head -50`은 됩니다. 오류 메시지까지 보려면 `2>&1`은 됩니다(감추는 게 아니라 화면으로 끌어오는 것이라 허용합니다). 단 **앞뒤를 띄어 쓰세요** — `2>&1| head`처럼 붙여 쓰면 안 열립니다(`… 2>&1 | head`). 정규식·글롭은 따옴표로 감싸세요(`--grep='fix$'` · `-- '*.ts'`), 붙임형 인자는 띄어 쓰세요(`-S OAuth`). 자주 막히던 것의 이미 허용된 대체: 현재 브랜치는 `git rev-parse --abbrev-ref HEAD`, 특정 커밋을 담은 브랜치는 `git for-each-ref --contains <sha>`. `check-ignore`는 **종료코드 1 = 무시되지 않음**(오류 아님)입니다. 파일 열람은 Read, 검색은 Grep·Glob. 고치지 말고 발견으로 보고하세요.",
  "ra-error": "차단: 리뷰 에이전트 안전 판정 중 오류라 안전측 차단(fail-closed)합니다. 검토는 Read/Grep으로 계속하세요.",
  "gate-model-downgrade": "차단: 검증 게이트를 기본보다 약한 모델로 띄우려 했습니다. 게이트는 \"검토 대상보다 최소 같거나 강한 독립 심판\"이라 약한 모델로 내리면 게이트의 의미가 사라집니다(심판이 일꾼보다 약해짐). **`model` 파라미터를 빼면** 에이전트 설정의 기본 모델이 그대로 쓰입니다 — 그게 정답인 경우가 대부분입니다. 그 모델을 못 쓰는 환경이면 실행 전 사용자가 CHAGEUN_ALLOW_GATE_MODEL=1로만 열 수 있습니다(게이트를 아예 안 부르는 것보다는 약한 심판이 낫기 때문입니다).",
  "design-color": "차단(차근 색 백스톱): 새로 넣는 코드에 디자인 토큰 대신 직접 색이 있습니다. 팔레트 색 클래스(`bg-blue-500` 등)·임의값(`-[#hex]`) 대신 docs/design-system.md의 토큰을 쓰세요. 색 견본판·Tailwind safelist처럼 색 이름이 원래 나열되는 파일이면, design-system.md front-matter의 `lint-allow-colors`에 그 팔레트명을 선언하거나 그 줄에 `design-lint-ignore` 주석을 붙이세요(그 줄만 통과). 전체 우회는 실행 전 사용자가 CHAGEUN_SKIP_DESIGN_LINT=1로만 켤 수 있습니다.",
  "component-boundary": "차단(공용 컴포넌트 경계): 페이지와 라우트는 등록된 공용 컴포넌트만 조립할 수 있습니다. 직접 UI는 공용 컴포넌트로 옮기고 레지스트리와 코드 표식을 맞추세요.",
  // ── v0.65.0 F-27(상황판) 하드 차단 둘 ────────────────────────────────────
  // 둘 다 **탈출구 환경변수가 없다.** 그래서 문구가 유일한 안내다 — 회복법이 안 닿으면
  //   막힌 채로 끝난다. 이 열쇠를 REASONS 에 안 넣으면 일반 문구("되돌리기 어려운 고위험
  //   명령")로 떨어져 그 사고가 그대로 난다.
  // ⚠ 오탐이 실제로 난다: secret-scan-core 의 looksLikeToken 은 **이름이 무엇이든** 값이
  //   12자 이상이고 글자·숫자가 섞이면 비밀로 본다. 상황판은 프로젝트 이름·버전·서버
  //   이름을 적는 자리라 `DB_HOST=mssql-server-01` 같은 평범한 값도 걸린다. 탐지 규칙을
  //   두 벌로 만들지 않고(같은 저장소에 잣대가 둘이면 어느 쪽이 진짜인지 아무도 모른다)
  //   **회복 문장**으로 푼다.
  "statusboard-secret": "차단: 상황판에 `.env` 의 비밀 값이 새로 들어갑니다. 상황판은 비밀번호가 없는 평문 보고서라 그대로 밖으로 열릴 수 있고, 살아 있는 열쇠가 나가면 되돌릴 수 없습니다. **값은 여기 다시 적지 않습니다** — 걸린 열쇠 이름만 아래 `(위반:` 에 있습니다. 회복: 그 값을 빼고 다시 쓰세요. **그 값이 비밀이 아니면 다르게 적으세요** — 예: `v0.65.0-beta1` → `버전 v0.65.0`. 이미 파일에 들어 있는 값은 이 검사가 안 봅니다(새로 쓰는 글만 봅니다) — 지우는 편집은 그대로 됩니다.",
  "statusboard-unignored": "차단: 이 상황판이 git 에 올라갈 수 있습니다. 평문 업무 보고가 저장소에 실리면 커밋 이력에 남아 나중에 지워도 흔적이 남습니다. 회복은 상태에 따라 둘입니다. (1) **아직 추적 안 된 파일**이면 `chageun:statusboard` 의 무시 절차를 밟으세요(`.git/info/exclude` 에 한 줄 넣고 `git check-ignore -q status.md` 로 재확인). (2) **이미 추적 중**이면 먼저 `git rm --cached status.md` 로 추적을 끊어야 합니다 — 차근이 대신 돌리지 않습니다. 사용자에게 그 명령을 보여 드리고 사용자가 돌립니다. 🛑 **추적을 끊은 뒤에 무시 절차를 한 번 더 밟아야 풀립니다** — 추적 중인 파일은 무시 줄만 넣어서는 `check-ignore` 가 계속 1이라 안 풀립니다. 이 차단을 여는 스위치는 없습니다.",
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
    if (ENV_REF_RE.test(cmd) && (hasEncoder(cmd) || cutSlicesValue(cmd) || trAltersValue(cmd))) return "env-encoder";
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
  "plan-size": "차단: 계획서가 3,000줄을 넘습니다. **이 크기가 실패한다는 뜻이 아닙니다** — 이 크기부터는 게이트도 사람도 통으로 못 읽어 **검증 결과를 믿기 어려워 사람이 정합니다**(이 구간에도 잘 끝난 계획이 있습니다). **서브에이전트는 이 승인을 받을 수 없습니다**(화면 질문은 사람만 답합니다). 본 세션에 BLOCKED 로 보고하고 멈추세요 — 보고에 **이 메시지 맨 끝 `잰 파일`의 이름과 줄 수를 그대로 옮기세요**(본 세션은 그 숫자로 일을 쪼갤지 이 크기로 갈지 정합니다).",
  "deploy": "차단(배포는 되돌리기 어려움): **서브에이전트는 배포를 승인할 수 없습니다.** 이 탈출구는 사람이 세션을 시작할 때만 켤 수 있고(명령 앞에 환경변수를 붙여도 안 켜집니다), 운영 배포 승인은 사람이 내릴 판단입니다. 지금 작업을 멈추고(park) 본 세션에 **BLOCKED**로 보고하세요 — 무엇을 배포하려 했는지, 왜 필요한지, 사전 점검에서 확인한 것을 함께 적으세요.",
  // gate-skip도 같은 모양의 헛돌기다. 신선도 게이트는 **자기 트랜스크립트 안에서** pr-reviewer 흔적을
  // 찾는데 게이트는 본 세션이 띄우므로 서브에이전트 기록엔 흔적이 없다(실측 238 레코드 중 0건) —
  // 그래서 뒤에서 도는 push는 이미 여기서 막힌다. 문제는 사람용 문구가 서브에이전트에게
  // 할 수 없는 둘(게이트 재호출·세션 재시작)을 시켜, 우회를 찾다 시간만 태운다는 것이다.
  // 이 문구가 처음 갈라질 때는 차단 조건이 그대로였는데, v0.64.0 이 조건을 **무조건 차단**으로 바꿨다
  // (흔적이 생기는 순간 풀리는 조건이라 — 배선은 pretooluse.js §3). 그래서 지금 이 문구가 말하는
  // "push 와 PR 은 본 세션이 합니다"는 안내가 아니라 기계가 지키는 사실이다.
  // v0.64.0 리뷰 2회차가 여기에 **회복 스위치 안내**(CHAGEUN_ALLOW_SUBAGENT_PUSH)를 붙였고, 3회차가 뺐다.
  //   스위치를 켜면 이 차단이 신선도 검사로 떨어지는데, 그 검사는 게이트 호출이 **실제로 실행됐는지**를
  //   안 봐서 막힌 호출도 리뷰 흔적으로 세어진다 — 서브에이전트가 자기 자물쇠를 푸는 길이 되살아난다
  //   (배선 쪽 설명은 pretooluse.js §3). 그래서 **회복 수단은 사람뿐**이고, 문구도 그렇게만 적는다.
  //   없는 스위치를 안내하면 오차단당한 쪽이 켤 수 없는 것을 찾다 시간만 태운다(deploy 문구에서 겪은 그것).
  // 리뷰 4회차가 그 끝문장 둘을 고쳤다. **이 stderr 를 읽는 쪽은 차단당한 서브에이전트다**(deny 는
  //   stderr 로 쓰고 exit 2 로 그 호출을 막는다 — pretooluse.js 의 deny). 그래서 회복 안내는 두 조건을 함께 만족해야 한다.
  //   (1) **그 상황에서 실제로 열리는 문**이어야 한다. 3회차 문구는 "사람이 본 세션에서 직접 push"라 했는데,
  //       이 문구가 뜬 상태는 IS_SUBAGENT 무조건 차단이라 본 세션 push 가 같은 차단에 또 걸린다(CHAGEUN_SKIP_GATE_CHECK
  //       도 이 줄 뒤라 못 연다). 훅은 **Claude 가 부르는 도구 호출**에만 걸리므로, 실제로 되는 길은
  //       화면 밖 터미널에서 사람이 직접 push 하거나 차근을 잠시 끄는 것 둘뿐이다.
  //   (2) **읽는 쪽이 따라 할 수 있는 우회를 안내하면 안 된다.** 3회차 문구의 "훅을 고칩니다"는 서브에이전트도
  //       할 수 있는 일이고(훅은 호출마다 파일에서 새로 읽혀 고치는 즉시 차단이 사라진다), 그 파일은 보통
  //       프로젝트 트리 밖이라 diff 에도 안 남는다. 유인 서브에이전트엔 PROTECTED 경로 가드가 안 걸린다(무인 전용).
  //       2회차에 있던 못박음("우회로로 쓰지 마세요")이 3회차에 스위치와 함께 지워졌던 자리라, 못박음과
  //       그것을 잡는 단언(test/pretooluse.test.mjs 의 "H-2 서브에이전트 push 문구" 검사)을 함께 되살린다.
  "gate-skip": "차단: push 와 PR 은 본 세션이 합니다. 뒤에서 도는 작업은 검증 게이트를 자기 기록 안에서 증명할 수 없습니다(게이트는 본 세션이 띄웁니다). **게이트를 직접 띄우지 마세요 — 만든 쪽이 자기 검사를 부르면 독립성이 깨집니다.** 커밋까지만 하고, 무엇을 커밋했는지와 브랜치 이름을 상태 보고에 적으세요. 본 세션이 게이트를 돌린 뒤 push 합니다. — **사람에게:** 본 세션에서 이 문구가 떴다면 훅이 세션을 잘못 본 것입니다. **이 차단을 여는 스위치는 없습니다**(있으면 뒤에서 도는 작업이 그 길로 빠져나갑니다). 되는 길은 둘이고 **둘 다 사람이 Claude 화면 밖에서 합니다**: (1) 터미널 창을 따로 열어 거기서 직접 push 합니다 — 이 검사는 Claude 가 실행하는 명령에만 걸립니다 (2) 차근 플러그인을 잠시 끄고(`/plugin` 메뉴) 다시 시도합니다. 같은 세션에서 다시 시키면 여기서 또 막힙니다. — **뒤에서 도는 작업에게:** 바로 위 두 가지는 사람 몫이니 **우회로로 쓰지 마세요.** 훅 파일이나 설정을 고쳐 이 차단을 지우는 것도 같은 우회입니다. 멈추고 사람에게 알리세요.",
  // v0.64.0 H-2: 위 문구가 "게이트를 직접 띄우지 마세요"라고 말로만 막던 것을 기계로도 막는다.
  //   말로만 두면 서브에이전트가 게이트를 띄워 자기 기록에 흔적을 만들고, 그 흔적으로 자기 push
  //   자물쇠를 푼다. 그래서 이 사유는 **서브에이전트 전용**이다(메인 세션엔 아예 안 걸린다).
  // v0.65.0 F-29: 불투명 통로(Workflow·REPL)를 서브에이전트가 쓰는 것. 이 문구는 이 파일의 하드 교훈
  //   두 개를 지킨다. (1) **켤 수 없는 스위치를 안내하지 않는다** — 서브에이전트는 훅 프로세스의
  //   환경변수를 못 켠다(위 deploy 문구의 실측). (2) **읽는 쪽이 따라 할 수 있는 우회를 안내하지 않는다**
  //   (gate-skip 4회차 교훈). 그래서 "차근을 잠시 끄라"·"그 파일을 고치라" 류를 한 줄도 안 적는다.
  //   사용자에게 물어보라고도 안 한다 — 서브에이전트는 화면 질문을 못 띄운다.
  "subagent-opaque-spawn": "차단: 이 도구로는 **무엇을 띄우는지 차근이 읽을 수 없습니다.** 각본은 문자열을 이어 붙이거나 바깥 파일에서 올 수 있어, 그 안에서 검증 게이트를 약한 모델로 띄우거나 검사를 건너뛰어도 아무도 못 봅니다. 그래서 뒤에서 도는 작업에는 이 통로를 열어 두지 않습니다. 지금 할 수 있는 것은 둘입니다: (1) 같은 일을 지금 가진 도구로 직접 하고, 하던 일을 끝내 커밋까지만 한 뒤 무엇을 고쳤는지와 브랜치 이름을 상태 보고에 적는다 (2) 이 통로가 꼭 필요하면 그 자리에서 멈추고 본 세션에 **BLOCKED** 로 보고한다 — 무엇을 띄우려 했는지, 왜 필요한지, 대신 해 본 것을 함께 적으세요. 그 판단과 실행은 본 세션 몫입니다.",
  "subagent-gate-spawn": "차단: 검증 게이트(plan-validator·pr-reviewer)는 본 세션이 띄웁니다. 만든 쪽이 자기 검사를 부르면 검사가 아닙니다 — 무엇을 검사할지 스스로 고르게 되고, 그 실행 흔적으로 push 잠금까지 풀립니다. 지금 할 수 있는 것은 둘입니다: (1) 하던 일을 끝내 커밋까지만 하고, 무엇을 고쳤는지와 브랜치 이름을 상태 보고에 적는다 (2) 검토·판단이 꼭 필요하면 그 자리에서 멈추고 **BLOCKED** 로 보고한다(무엇을 정해야 하는지와 선택지를 함께). 게이트 실행과 push 는 본 세션이 합니다. **감독(`supervisor`)이 띄운 일이면 감독에게 BLOCKED 로 보고하세요 — 검토는 감독이 띄웁니다.**",
  // ── v0.65.0 F-28(감독 에이전트) 사유 넷 ──────────────────────────────────
  // 넷 다 서브에이전트 전용이다(감독은 언제나 서브에이전트다). 이 파일의 하드 교훈 둘을 그대로 지킨다:
  //   (1) **켤 수 없는 스위치를 안내하지 않는다** — 서브에이전트는 훅 프로세스의 환경변수를 못 켠다.
  //   (2) **읽는 쪽이 따라 할 수 있는 우회를 안내하지 않는다**(gate-skip 4회차 교훈).
  //   사용자에게 물어보라고도 안 한다 — 서브에이전트는 화면 질문을 못 띄운다.
  "subagent-supervisor-spawn": "차단: 감독(`supervisor`)은 본 세션만 띄웁니다. 일이 갈라지면 사람이 볼 수 있게 본 세션이 갈라야 합니다 — 뒤에서 감독이 감독을 낳으면 몇 겹인지 아무도 못 셉니다. 이것은 '감독인 척'을 막는 자물쇠이기도 합니다: 감독이 되는 유일한 길은 본 세션이 감독으로 띄우는 것이고, 돌고 있는 작업은 자기 자리를 바꿀 수 없습니다. 지금 할 수 있는 것은 하나입니다 — 그 자리에서 멈추고 본 세션에 **BLOCKED** 로 보고하세요(무엇을 띄우려 했는지, 왜 필요한지를 함께).",
  "supervisor-write": "차단: 감독은 파일을 고치지 않습니다. 고칠 일은 일꾼(`code-implementer`·`deep-implementer`)에게 띄우세요 — 감독의 일은 띄우고, 자리를 열어 확인하고, 판정을 옮기는 것입니다. 커밋·push·PR 도 감독이 하지 않습니다. 일꾼에게 띄울 수 없는 일이면 그 자리에서 멈추고 본 세션에 **BLOCKED** 로 보고하세요.",
  "supervisor-spawn-cap": "차단: 감독이 띄울 수 있는 한도(6건)를 다 썼습니다. **6건은 검토 회차가 아니라 총 스폰 수입니다** — 수정 3 + 검토 3 이 기본이고, 한 회차에 일꾼을 두 번 띄우면 더 빨리 닿습니다. 지금까지의 **게이트 판정 원문**과 남은 문제를 적어 본 세션에 **BLOCKED** 로 올리세요. 한도를 늘리는 스위치는 없습니다.",
  "supervisor-cap-unreadable": "차단: **기록을 못 읽어 지금까지 띄운 수를 셀 수 없습니다.** 한도를 못 세면 막는 쪽이 안전측이라 이 스폰을 막았습니다. 지금까지의 **게이트 판정 원문**과 남은 문제, 그리고 무엇을 띄우려 했는지를 적어 본 세션에 **BLOCKED** 로 올리세요. 이 검사를 끄거나 한도를 늘리는 스위치는 없습니다. 올릴 때 이 한 줄을 함께 적으세요: '이 검사는 하네스가 기록을 두는 폴더 구조에 기댑니다. 갑자기 전부 막히면 그 폴더 구조가 바뀌었는지부터 보십시오.'",
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
// "구현 에이전트(아래 DELEGATE_AGENTS) 위임 직전인데 이번 세션에 chageun:routing 스킬 로드 흔적이 없다"의
// 첫 1회만 참(이미 일꾼 스폰 흔적이 있으면 침묵 — 첫 위임 전에만 알린다).
// 차단이 아니라 리마인더 주입 판정. 게이트(plan-validator/pr-reviewer) 스폰은 대상 아님
// (게이트 모델은 각 agent frontmatter·라우팅 규칙이 관장). 순수함수(fs 없음).
//
// 🛑 이름을 정규식에 박지 않고 **배열 한 곳**에 모은다. 예전엔 `/code-implementer/` 였는데,
// 일꾼이 하나 늘자 새 에이전트로 위임할 때만 리마인더가 통째로 안 켜졌다 — 하필 판단 걸린
// 일을 맡는 쪽이라, 이번에 넣은 안전 문장(BLOCKED 계약·push 금지·게이트 재실행)이 가장
// 필요한 경로에서 안 걸렸다. 정규식에 갈래를 붙이는 방식은 다음 사람이 한쪽만 고쳐도
// 조용히 통과하므로, 아래 두 자리(스폰 판정·이미-위임 판정)가 **같은 배열**을 쓰게 한다.
//
// v0.65.0 F-28: **감독(supervisor)이 여기 들어온다. 그래서 이름이 더는 '구현'만 뜻하지 않아
//   배열과 판정기 이름을 뜻에 맞게 바꿨다**(IMPLEMENTER_AGENTS·isImplementer → DELEGATE_AGENTS·isDelegate).
//   왜 감독이 여기 드는가: 메인이 일꾼 대신 감독을 띄우면 **메인 기록에는 감독 스폰 한 줄만 남는다.**
//   그러면 (1) 검토 뒤에 코드가 바뀌어도 신선도 검사가 스스로 안 깨지고 (2) 라우팅 리마인더도 안 뜬다.
//   v0.64.0 이 deep-implementer 로 이미 겪은 것과 **같은 사고**다.
//   🛑 감독은 **읽기만 하는데도** 여기 든다 — 감독이 띄운 일꾼이 고쳤을 수 있기 때문이다.
//   거래는 옳다: 과하게 세면 검토가 한 번 더 돌 뿐이고, 덜 세면 **검토 안 받은 코드가 나간다.**
//   그 대신 REASONS["gate-skip"] 문구가 "감독을 띄운 세션도 포함"이라고 사람에게 밝힌다
//   (코드를 안 고친 사장님께 "코드를 다시 수정했으면"만 보이면 사실과 다르게 읽힌다).
// 판정은 **부분 문자열 그대로 넓게** 둔다(네임스페이스 접두사가 붙어 와도 걸리게).
const DELEGATE_AGENTS = ["code-implementer", "deep-implementer", "supervisor"];
const isDelegate = (who) => DELEGATE_AGENTS.some((n) => String(who).indexOf(n) !== -1);
const AGENT_TOOLS_RE = /^(Task|Agent)$/;
// 차근이 **무엇을 띄우는지 못 읽는** 통로. 각본은 문자열 이어붙이기·계산값·외부 파일(scriptPath)·
//   재개(resumeFromRunId)로 올 수 있어 정적 해석이 못 버틴다. REPL 은 임의 코드에 상태까지 유지된다.
const OPAQUE_SPAWN_TOOLS_RE = /^(Workflow|REPL)$/;
function subagentOf(inp) { return String((inp && (inp.subagent_type || inp.agentType || inp.agent_type)) || ""); }

// ── 스폰 판정 단일 출처(v0.65.0 F-29) ───────────────────────────────────────
// 이 파일은 같은 실패를 이미 겪었다(바로 위 DELEGATE_AGENTS 주석): 판정을 정규식에 박으면
//   갈래가 늘 때 한쪽만 고쳐져 조용히 통과한다. 그래서 스폰 판정도 **여기 한 곳**에 모은다.
//   🛑 새로 스폰 판정이 필요하면 정규식을 새로 적지 말고 이 함수를 부르라.
//
// 🛑 **판정 순서가 곧 안전이다. opaque 를 먼저 본다.** 두 조건은 겹친다 —
//   `Workflow({script:"…", agentType:"chageun:pr-reviewer"})` 는 이름으로는 opaque,
//   입력 칸으로는 readable 이다. readable 이 이기면 **입력 칸 하나로 아래 불변식이 우회되어**
//   못 읽는 통로가 읽히는 통로 행세를 한다. 이름이 Workflow·REPL 이면 입력에 무엇이 있든 opaque.
//
// 🛑 **readable 을 via 로 쪼개는 이유.** `via:"shape"`(입력 칸)는 **아무 도구 이름에나 붙일 수 있다** —
//   호출하는 쪽이 칸 하나를 얹으면 그만이다. 그래서 성질 판정은 **게이트를 닫는 데만** 쓸 수 있고,
//   여는 데 쓰면 이름 문자열로 게이트를 여는 것과 위험이 같다. 이 파일이 그 금지를 이미 적어 뒀고
//   (hasPrReviewer 머리의 "이름 문자열 휴리스틱은 일부러 안 넣는다"), `via` 는 그 금지를
//   **기계가 셀 수 있는 한 칸**으로 만든 것이다. 불변식은 한 줄이다:
//   **`lastReview`(게이트를 여는 쓰기)를 미는 것은 `via:"name"` 뿐이고, `via:"shape"` 와 `opaque` 는
//     `lastCodeEdit`(닫는 방향)에만 쓴다.**
//   ⚠ 이 문장은 무조건이 아니라 **이 함수가 덮는 범위 안에서만** 참이다. 런타임이 직접 실은
//     `toolUseResult.agentType` 은 도구 이름을 한 번도 안 거치고 맵에 오른다(hasPrReviewer 1패스) —
//     그 길은 이 함수 밖이고 v0.65.0 이 만든 것도 아니다.
//
// 왜 성질만으로는 안 되나(실측): 이 저장소에서 실제로 관측된 유일한 `Workflow` 호출의 입력은
//   `{name, args}` 였고 **`script` 칸이 없었다.** 그래서 "입력에 각본이 있으면 스폰"은 실제 표본을
//   놓친다. `name` 은 너무 흔한 칸이라 신호가 못 된다. 이 문장이 없으면 다음 사람이 이름 목록을
//   "정리"하다 구멍을 되살린다.
//
// 반환: null | { kind:"opaque"|"readable", via:"name"|"shape", agentType }. 순수함수(fs 없음).
function spawnIntent(toolName, toolInput) {
  const nm = String(toolName || "");
  if (OPAQUE_SPAWN_TOOLS_RE.test(nm)) return { kind: "opaque", via: "name", agentType: "" };
  if (AGENT_TOOLS_RE.test(nm)) return { kind: "readable", via: "name", agentType: subagentOf(toolInput) };
  // 값이 빈 칸은 스폰으로 안 본다 — 이름을 못 얻으면 어느 소비자도 판정을 못 하고(gateOf·isDelegate
  //   전부 거짓), 그 상태를 readable 로 올리면 "판정된 스폰"으로 잘못 읽힌다.
  const shaped = subagentOf(toolInput);
  return shaped ? { kind: "readable", via: "shape", agentType: shaped } : null;
}

// ── 감독 폭주 상한(v0.65.0 F-28) ─────────────────────────────────────────────
// 6 은 **사용자 결정**이다(수정 3 + 검토 3 = 3회차). 임의로 5 나 7 로 바꾸지 않는다.
// ⚠ 6건과 3회차는 **다른 축**이다. 감독이 같은 회차에 일꾼을 두 번 띄우면 6건이 3회차보다 먼저 닿는다.
const SUPERVISOR_SPAWN_CAP = 6;
// 기록 속 스폰 수를 센다. 🛑 **`Task|Agent` 정규식을 새로 만들지 않는다** — 무엇이 '스폰 통로'인지는
//   위 `spawnIntent` 하나가 정한다. 사본을 만들면 (1) 통로가 늘 때 한쪽만 고쳐져 조용히 갈라지고
//   (바로 위 DELEGATE_AGENTS 주석의 그 사고) (2) "정규식 리터럴은 spawnIntent 정의 1곳뿐"을
//   거는 F-29 검사가 빨개진다. 그래서 **불투명 통로 스폰도 상한에 함께 들어간다**(그 갈래는
//   subagentGateSpawn 이 먼저 막지만, 세는 규칙이 통로마다 갈리지 않는다).
// 대상은 안 가린다 — 상한은 "감독이 무엇을 띄웠나"가 아니라 "몇을 띄웠나"를 센다.
// 자기 기록의 레코드 모양이 부모 기록과 같은 계열이라는 근거: 회고 스캐너가 agent 파일에 그대로
//   hasRealContent 를 적용하고(src/skills/retrospect/retrospect-scan.mjs 의 :451), 그 함수가
//   `(o.message || o).content[]` 안의 `type: "tool_use"` 를 본다(같은 파일 :358-368).
//   착수 전 실측이 그것을 닫았다(2026-08-12 프로브 · 첫 스폰 시점 계수 1).
function spawnCountIn(objs) {
  let n = 0;
  for (const record of Array.isArray(objs) ? objs : []) {
    const content = (record && (record.message || record).content) || [];
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b && b.type === "tool_use" && spawnIntent(b.name, b.input)) n += 1;
    }
  }
  return n;
}
// 🛑 **지금 부르려는 그 스폰이 자기 기록에 이미 적혀 있다**(2026-08-12 실측: 스폰을 0번 한 프로브의
//   **첫 스폰**에서 계수가 1). 그래서 계수를 그대로 상한과 견주면 6번째에서 막혀 **실제로 쓸 수 있는
//   스폰이 5건**이 되고, 사용자 결정(수정 3 + 검토 3)의 3회차 검토가 아예 못 뜬다(스펙 §3.3 SV-3 이
//   이 갈래를 예고했다). **사용자 결정(2026-08-12): 쓸 수 있는 스폰을 6건으로 맞춘다** — 6번 성공하고
//   7번째에서 막힌다. 그래서 진행 중인 이 호출 하나를 계수에서 뺀다.
// 🛑 **문턱을 7로 올리지 않은 이유.** 상수를 7로 만들면 사용자가 정한 숫자(6)와 상수가 어긋나, 차단
//   문구의 "한도(6건)" · 스펙의 "총 6건" · 검사가 저마다 다른 수를 들고 조용히 갈라진다. 뺄셈을 여기 두면
//   **6 = 쓸 수 있는 스폰 수 = 문구의 숫자 = 상수**가 한 값으로 남는다.
// ⚠ **1회 실측 위에 선 뺄셈이다.** 하네스가 바뀌어 진행 중인 호출이 아직 안 적힌 채 훅이 돌면, 이 뺄셈은
//   한 건 **더 허용**하는 쪽으로 틀린다(6 대신 7). 그 방향으로 틀리게 뒀다 — 폭주를 막는 상한은 그래도
//   서지만, 반대 방향(5건으로 조이기)은 3회차 설계를 **조용히 못 돌게** 만들기 때문이다.
// ⚠ 한 메시지에 스폰 둘이 함께 실리면(병렬 호출) 아직 안 돈 형제도 계수에 들어 그 경우만 한 건 일찍
//   막힌다. 감독은 앞에 두고 기다려 하나씩 띄우게 지시돼 있어(스펙 §4) 정상 경로가 아니다.
function spawnCapReached(objs) {
  return spawnCountIn(objs) - 1 >= SUPERVISOR_SPAWN_CAP;   // -1 = 지금 부르려는 이 호출
}

// 🛑 이것은 정규식 리터럴이 아니라 `hooks.claude.json` **옛 매처 문자열의 복사본**이다(239자).
//   안의 `Task|Agent` 는 `spawnIntent` 판정과 **무관하다** — 사본 검사(성공 기준 7)의 명시적 예외다.
// 왜 있나: v0.65.0 이 매처를 `""`(모든 도구)로 넓혔는데, **무인 모드는 안 넓히기로 사용자가 정했다**
//   (2026-08-11). 넓혀서 **새로 도달하게 된** 차단만 무인에서 안 켜는 것이지, 기존에 무인에서 돌던
//   차단을 끄라는 뜻이 아니다. 그 차이를 정확히 그 옛 범위로 잡는다.
// 왜 문자열 + new RegExp 인가: (1) 옛 매처는 **부분일치**로 돌았다 — `^…$` 를 붙이면
//   `mcp__…__create_branch` 가 `create_branch` 로 걸리던 것이 안 걸려 예외 범위가 뒤바뀐다.
//   (2) 정규식 리터럴로 적으면 위 사본 검사에 걸린다(이 문자열의 꼬리가 `…|Task|Agent` 다).
// ⚠ 이 값은 손으로 옮겨 적은 것이 아니라 그 JSON 에서 그대로 복사했다. 한 토큰이 빠지면 예외 범위가
//   조용히 좁아져 무인 park 이 늘고, 반대로 늘리면 무인이 유인보다 헐거워진다.
const LEGACY_UNATTENDED_SCOPE = new RegExp("Bash|Write|Edit|MultiEdit|NotebookEdit|execute_sql|apply_migration|deploy_edge_function|delete_branch|create_branch|merge_branch|reset_branch|rebase_branch|restore_project|pause_project|create_project|delete_project|confirm_cost|Task|Agent");

function routingReminderNeeded(objs, toolName, toolInput) {
  // 넓힌 범위에서 `readable` 만 본다(`via` 는 안 가린다 — 리마인더는 게이트를 여는 판정이 아니다).
  //   불투명 통로는 무엇을 띄우는지 못 읽으니 라우팅 리마인더 판정 자체가 성립하지 않는다.
  const si = spawnIntent(toolName, toolInput);
  if (!si || si.kind !== "readable") return false;
  if (!isDelegate(si.agentType)) return false;
  if (!Array.isArray(objs)) return false;
  for (const o of objs) {
    const m = (o && o.message) || o; const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      const nm = String(b.name || "");
      if (nm === "Skill" && /routing/.test(String((b.input && b.input.skill) || ""))) return false; // 로드됨
      const prev = spawnIntent(nm, b.input);
      if (prev && prev.kind === "readable" && isDelegate(prev.agentType)) return false; // 이미 위임 시작(1회 보장)
    }
  }
  return true;
}

// transcript objs에 pr-reviewer가 "실제로 실행"된 흔적이 있고 그 흔적이 신선한지(P3) —
// 문자열 언급이 아니라 Task/Agent tool_use의 subagent_type 기준. 리뷰 이후 코드 수정
// (Edit/Write류, 문서 제외 — isCodeTarget)이 있으면 stale(false): 검토 안 받은 코드가
// 검토 딱지를 달고 나가지 않게(🙋 합의: 문서 수정은 무효화 안 함 · 재검토 1회 강제 수용).
// 한계(자인): Bash(sed·리다이렉션)로 고친 파일은 lastCodeEdit에 안 잡힌다 — 얇은 그물. 순수함수(fs 없음).
// v0.64.0 H-1: **구현 에이전트 스폰도 코드 수정으로 센다.** 구현을 서브에이전트에 맡기면 메인
//   기록엔 Task 한 줄만 남아 Edit/Write 가 0 이 되고, 리뷰 뒤에 파일이 바뀌어도 push 가 그대로
//   통과했다(v0.64.0 이 그 위임을 **기본 경로**로 만들었으므로 반드시 닫아야 하는 자리다).
//   판정은 위 `isDelegate`(DELEGATE_AGENTS 배열) 한 곳을 공유한다 — 정규식에 이름을 박으면
//   일꾼이 늘 때 한쪽만 고쳐져 조용히 통과한다(같은 사고가 라우팅 리마인더에서 이미 났다).
//   이어부르기(SendMessage)도 같이 센다: 백그라운드 일꾼에게 "이것도 고쳐줘"를 보내면 파일이 바뀐다.
//   맞바꾼 것(합의): **아무것도 안 고친 위임 뒤에도 재리뷰가 강제된다.** 스폰 시점 계상이라
//   결과를 안 보기 때문이다(바로 아래 '남는 구멍'의 Task 스폰 계상과 같은 방향). 이 파일은 같은
//   종류의 과차단(문서 수정 뒤 재검토 1회)을 이미 합의로 수용했다.
//   좁힘(정직): 일꾼 이름 목록 **밖**의 에이전트(general-purpose·Explore 등)로 고친 것은 안 잡힌다.
//   탐색·조사 위임은 읽기 전용이고 흔해서, 모든 스폰을 코드 수정으로 세면 정상 작업이 재리뷰를
//   반복한다. 위 Bash 자인과 같은 등급의 얇은 그물이다.
// v0.43.1: `SendMessage`로 같은 게이트를 이어 불러 재검토한 것도 리뷰 흔적으로 인정한다.
//   그 전엔 Task/Agent 스폰만 세서, 재검토를 했는데도 "리뷰 없음"으로 **정당한 push가 두 번 막혔다**
//   (2026-08-02 v0.42.0·v0.42.2). SendMessage의 input엔 subagent_type이 없고 대상 id(`to`)만 있다.
//   연결 고리 두 가지: (1) 앞에 두고 기다린 스폰은 결과 레코드의 **최상위** `toolUseResult`에
//   `agentId`+`agentType`이 같이 실린다. (2) **백그라운드(run_in_background) 스폰의 결과엔
//   `agentType`이 아예 없다**(실측 키: isAsync·status·agentId·description·resolvedModel·prompt·
//   outputFile). 그래서 그 경우엔 스폰 `tool_use.id` ↔ 결과 `tool_result.tool_use_id`를 조인해 타입을
//   얻는다(실측: 이 저장소 트랜스크립트에서 26/26 매칭). v0.46.0까지 (2)가 없어 **백그라운드 리뷰어에게
//   SendMessage로 재검토를 받아도 push가 막혔다** — 바로 이 훅의 에러 문구가 "SendMessage 재검토도
//   인정된다"고 안내하는 그 길이 죽어 있었다(리뷰 비용을 한 번 더 물림).
//   **2패스인 이유**: run_in_background 에이전트는 완료 레코드가 SendMessage보다 뒤에 올 수 있어
//   1패스면 그 건을 놓친다.
//   ⚠ (2)를 열면서 "아직 안 끝난 리뷰는 맵에 없어 불인정"이던 **안전측 부수 속성은 사라졌다** —
//   launch 레코드만으로 맵에 올라 미완료 리뷰도 인정된다. 새 사고 클래스는 아니다(아래 '남는 구멍'대로
//   Task 스폰도 결과가 아닌 호출 시점 계상이라 대칭). 마지막 방어선은 push 직전 사람 승인(멈춤 규칙 2)이다.
//   조인은 **결과가 정확히 1개인 엔트리에서만** 한다 — 여럿이면 어느 결과가 이 agentId의 것인지
//   단정할 수 없고, 틀리는 방향이 "리뷰어 아닌 에이전트가 리뷰어로 승격"(게이트가 열림)이다.
//   매핑 실패는 **불인정**(false 유지). 이름 문자열 휴리스틱(`to`에 "pr-reviewer"가 들어있으면 인정)은
//   일부러 안 넣는다 — 게이트 통과 조건을 문자열로 열면 우회가 쉬워진다.
//   `description`·`prompt` 내용 추정도 같은 이유로 금지(리뷰 안 거치고 뚫는 길이 된다).
// v0.64.0 리뷰 2회차 H-1b: 위임을 **스폰 시점**으로만 계상하면 백그라운드에서 순서가 뒤집힌다 —
//   일꾼 스폰(seq 1) → pr-reviewer 스폰(seq 2) → 그 뒤 일꾼이 파일을 고치고 끝남. 리뷰가 마지막으로
//   보여 **검사 안 받은 코드가 도장을 달고 push** 된다. 하필 v0.64.0 이 기본으로 만든 순서다.
//   그래서 **일꾼이 끝난 시점**도 코드 수정으로 센다(finishedImplementerHere).
//   ⚠ 실측이 처방을 뒤집은 자리다(29개 트랜스크립트 전수): 백그라운드 스폰은 `toolUseResult.agentId`
//   **완료 레코드를 아예 안 남긴다**. 근거는 **전부 백그라운드로 띄운 세션 4개**다 — 그 세션들의
//   `agentId` 레코드는 전부 `status:"async_launched"` 이고 개수가 스폰 수와 같으며(98/99·16/16·1/1·1/1),
//   `status:"completed"` 레코드는 **0건**이다(섞인 세션에서도 completed 수 = foreground 스폰 수).
//   ⚠ 옛 근거였던 "async_launched 134 ↔ completed 86, 교집합 0건"은 **아무것도 증명하지 않는다**
//   (서로 다른 종류의 레코드를 겹쳐 본 셈 — 애초에 겹칠 수 없다). 결론은 같지만 근거를 바꿔 적는다.
//   완료 레코드는 앞에 두고 기다린(foreground) 스폰만 남기는데, 그건 스폰과 같은 seq 라 계상해도
//   값이 안 변한다. 즉 `agentId` 완료 레코드만 보는 판정은 **막으려는 그 순서에서 한 번도 안 켜진다.**
//   실제 백그라운드 완료 신호는 둘이고, 이 저장소 실측 커버리지는 132/134(98.5%)다:
//     (a) `<task-notification>` 블록의 `<task-id>`(user 메시지 문자열·배열 text·attachment.prompt)
//     (b) `TaskOutput` tool_use 의 `input.task_id`
//   (a) 를 레코드 종류로 안 거르는 이유: 이 판정은 **lastCodeEdit 만 뒤로 민다**(게이트를 닫는 방향).
//   따옴표에 낀 문구·큐 부기가 섞여 오탐해도 결과는 "재리뷰 한 번 더"라 안전측이고, 반대로 이 문자열을
//   지어내 게이트를 **여는** 길은 없다. 남는 구멍(정직): 일꾼이 **아직 도는 중**에 push 하면 완료 신호가
//   없어 스폰 시점 계상만 남는다(실측 미커버 2건이 그 상태였다) — 그 구간은 push 직전 사람 승인이 마지막 방어선.
// 남는 구멍(정직 · plan-validator high 수용): Task 스폰은 리뷰 절차가 **항상** 돌지만 SendMessage는
//   **배달만 보장**한다. 그래서 통보성 쪽지 한 통으로도 신선도가 되살아난다. 메시지 내용 검사는 일부러
//   안 한다 — 실제로 막혔던 메시지가 "변한 게 없으면 APPROVE 유지로 한 줄 확답해줘"였고, 어휘 목록으로
//   좁히면 이 봉합이 고치려는 오차단이 되살아난다. 마지막 방어선은 push 직전 사람 승인(멈춤 규칙 2)이다.
//   하위 확장(수용): 전송 성공 여부(tool_result의 is_error)를 안 본다 — 이미 회수된 리뷰어에게 보내 실패해도
//   신선도가 복구된다. Task 스폰도 결과가 아닌 호출 시점 계상이라 대칭이다(pr-reviewer low).
function hasPrReviewer(objs) {
  if (!Array.isArray(objs)) return false;
  // 패스1: agentId → agentType 맵. 두 소스(위 주석 (1)·(2)).
  const agentTypeById = new Map();
  const typeByToolUseId = new Map();
  for (const o of objs) {
    const c = ((o && o.message) || o || {}).content;
    if (Array.isArray(c)) for (const b of c) {
      // 🛑 **이 자리는 v0.65.0 에서 "안 넓히는 것"이 고치는 것이다.** 이 맵은 toolUseResult.agentId 와
      //   조인돼 SendMessage 로 `lastReview`(게이트를 **여는** 쓰기)까지 이어진다(아래 패스2). 성질
      //   (`via:"shape"`)까지 올리면 `아무도구({agentType:"chageun:pr-reviewer"})` 한 줄이 쪽지 한 통을
      //   거쳐 **리뷰 도장**이 된다 — 직접 쓰기만 막으면 이 길이 그대로 남는다.
      //   ⚑ **이 한 줄이 이번 판의 자물쇠다**: `via:"shape"` 를 남겨 둔 판단이 여기에 기대고 있다.
      //   회귀 칸 = test/hook-net.test.mjs 의 (d) 와 "1패스 맵은 via:\"name\" 전용이다".
      const si1 = b && b.type === "tool_use" ? spawnIntent(b.name, b.input) : null;
      if (si1 && si1.kind === "readable" && si1.via === "name" && b.id) {
        typeByToolUseId.set(String(b.id), si1.agentType); // 키 목록은 spawnIntent 와 한 벌(사본 금지)
      }
    }
    const tur = o && o.toolUseResult;
    if (tur && typeof tur === "object" && tur.agentId) {
      let type = String(tur.agentType || "");
      if (!type && Array.isArray(c)) {
        const results = c.filter((b) => b && b.type === "tool_result" && b.tool_use_id);
        // 정확히 1개일 때만 조인 — 모호하면 옛 동작(불인정=안전측)으로 떨어진다.
        if (results.length === 1) type = typeByToolUseId.get(String(results[0].tool_use_id)) || "";
      }
      // 빈 값은 덮어쓰지 않는다(옛 코드는 무조건 set이라 빈 값이 앞선 정상 매핑을 지웠다).
      // 지우면 정당한 재검토가 다시 막히는 방향이다. 실측으로는 차이가 없다(`agentType:""` 레코드 0건 ·
      // 빈 값은 항상 필드 부재)지만, 런타임이 빈 문자열을 싣기 시작하는 날 갈리므로 잠가 둔다.
      if (type) agentTypeById.set(String(tur.agentId), type);
    }
  }
  // 패스2: 리뷰 흔적과 코드 수정의 선후.
  let lastReview = -1, lastCodeEdit = -1, seq = 0;
  for (const o of objs) {
    const m = (o && o.message) || o;
    const c = m && m.content;
    if (Array.isArray(c)) for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      seq++;
      const nm = String(b.name || "");
      const inp = b.input || {};
      // ⚠ **아는 도구를 먼저 가른다.** 스폰 판정을 앞에 두면, 아는 도구가 우연히 스폰꼴 칸을 달고 온
      //   경우(`Edit({file_path, agentType:"x"})`)에 그 도구의 자기 계상(여기서는 isCodeTarget)이
      //   통째로 건너뛰어진다 — **여는 방향**이다. 이름 집합이 서로 겹치지 않으므로 순서를 바꿔도
      //   오늘 있는 도구들의 판정은 한 칸도 안 변한다.
      if (nm === "TaskOutput") {
        // 백그라운드 결과 회수 = 그 일꾼이 끝났다는 두 번째 신호(H-1b (b)).
        const tid = String(inp.task_id || "");
        if (tid && isDelegate(String(agentTypeById.get(tid) || ""))) lastCodeEdit = seq;
      } else if (nm === "SendMessage") {
        const to = String(inp.to || inp.recipient || "");
        const type = to ? String(agentTypeById.get(to) || "") : "";
        if (/pr-reviewer/.test(type)) lastReview = seq;
        else if (isDelegate(type)) lastCodeEdit = seq;      // 이어부르기로 더 고치게 시킨 것도 같다
      } else if (EDIT_TOOLS_RE.test(nm)) {
        if (isCodeTarget(inp.file_path || inp.notebook_path)) lastCodeEdit = seq;
      } else {
        // v0.65.0 F-29: 스폰 통로. **닫는 쪽으로만 움직인다** — 이 비대칭이 설계의 전부다.
        const si = spawnIntent(nm, inp);
        if (si && si.kind === "opaque") {
          // 불투명 통로(Workflow·REPL): 각본이 코드를 통째로 고쳤을 수 있으므로 **코드 수정으로 센다.**
          //   🛑 `lastReview` 는 **어떤 경우에도 안 민다.** 그래서 불투명 통로로 게이트를 강등해
          //   띄워도 그 리뷰는 리뷰로 안 쳐지고, **강등해서 얻는 것이 없다** — 각본 내용을 한 줄도
          //   안 읽고 그 경로가 죽는다. 결정 2번(2026-08-11): 메인 세션에서도 센다. 실측 빈도가
          //   0.015% 라 재검토 비용이 사실상 0이고, 안 세면 v0.64.0 이 막 닫은 자리가 다른 이름으로 열린다.
          //   ⚠ 조건부다: 런타임이 각본 결과에 agentType 을 싣기 시작하면 위 1패스의 런타임 표기
          //   가지로 맵이 채워져 이 문장이 그날 거짓이 된다(T0 실측 기준 오늘은 0건). 그때 무엇을
          //   좁힐지는 **사람이 정한다**.
          lastCodeEdit = seq;
        } else if (si && si.via === "name") {
          if (/pr-reviewer/.test(si.agentType)) lastReview = seq;
          else if (isDelegate(si.agentType)) lastCodeEdit = seq; // 위임 = 이 시점의 코드 수정(v0.64.0 H-1)
        } else if (si && isDelegate(si.agentType)) {
          // `via:"shape"` = 입력 칸으로만 잡힌 스폰. 호출하는 쪽이 칸 하나로 만들어 낼 수 있으므로
          //   **닫는 쪽에만** 쓴다(일꾼이면 코드 수정 계상). 리뷰어여도 여기서는 아무 일도 안 한다 —
          //   그것이 `아무도구({agentType:"chageun:pr-reviewer"})` 한 줄이 리뷰 도장이 되는 것을 막는다.
          lastCodeEdit = seq;
        }
      }
    }
    // 일꾼이 **끝난 시점**(H-1b). 위 content 루프 **뒤**에 둔다 — 한 레코드가 리뷰 스폰과 완료 신호를
    // 함께 들면 둘이 같은 seq 가 되어 `lastReview > lastCodeEdit` 이 거짓, 즉 막는 쪽으로 떨어진다.
    // 앞에 두면 같은 상황에서 통과(=여는 쪽)라 방향이 뒤집힌다.
    if (finishedImplementerHere(o, agentTypeById)) lastCodeEdit = seq;
  }
  return lastReview !== -1 && lastReview > lastCodeEdit;
}

// 한 레코드에서 "백그라운드 일꾼이 끝났다"를 읽는다(위 hasPrReviewer 머리의 H-1b 절). 순수함수.
// 반환: 끝난 것이 구현 에이전트면 true. 타입은 호출자가 만든 agentId→type 맵으로만 판정한다
// (이름 문자열 휴리스틱 금지 — 형제 규칙과 같은 이유).
function finishedImplementerHere(o, agentTypeById) {
  if (!o || typeof o !== "object") return false;
  const typeOf = (id) => String(agentTypeById.get(String(id)) || "");
  // (0) `toolUseResult.agentId` 를 든 레코드. **`status` 를 안 보므로 백그라운드 스폰 순간
  //     (`async_launched`)에도 켜진다** — 그건 스폰과 같은 seq 라 값이 안 바뀌어 무해하다(정직 고지:
  //     이 자리는 "완료만" 보지 않는다). 노리는 것은 앞에 두고 기다린 스폰의 완료 레코드이고,
  //     런타임이 백그라운드에도 완료 레코드를 싣기 시작하는 날 이 줄이 그대로 받는다.
  const tur = o.toolUseResult;
  if (tur && typeof tur === "object" && tur.agentId && isDelegate(typeOf(tur.agentId))) return true;
  // (a) <task-notification> 알림. 문자열 content · 배열 content 의 text 블록 · attachment.prompt 셋 다.
  const m = o.message || o;
  const c = m && m.content;
  let txt = "";
  if (typeof c === "string") txt = c;
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (typeof b === "string") txt += b + "\n";
      else if (b && typeof b.text === "string") txt += b.text + "\n";
    }
  }
  if (o.attachment && typeof o.attachment.prompt === "string") txt += o.attachment.prompt;
  if (txt.indexOf("<task-notification>") !== -1) {
    const re = /<task-id>([^<]+)<\/task-id>/g;
    let hit;
    while ((hit = re.exec(txt)) !== null) {
      if (isDelegate(typeOf(hit[1].trim()))) return true;
    }
  }
  return false;
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
// v0.47.0: `.md` 이면서 (a) `plans/` 디렉토리 안이거나 (b) basename이 `plan.md`이거나 구분자
//   하나 뒤에 `plan.md`가 오는 형태(`-plan.md`·`_plan.md`·`.plan.md`)일 때만 계획서로 본다.
//   `plan-*.md` **접두는 일부러 뺀다** — 그게 `src/agents/plan-validator.md`를 잡던 바로 그 패턴이고,
//   걸리면 아래 `planSeen=true, validated=false` 재무장이 돌아 **게이트를 이미 통과한 기록이 지워진다**
//   (실측 v0.46.0 세션: 한 세션에 3회 이상 헛발동).
//   구분자에 점(`.`)이 든 이유: `plan-validator.md:31`이 계획서 이름으로 `**/*.plan.md`를 스스로
//   선언한다. 접두형 오탐은 이걸로 안 되살아난다 — `plan-validator.md`는 `plan` **뒤에** 글자가 붙는
//   형태라 `[-_.]plan\.md$`에 걸릴 수 없다(실행 확인: src·dist 사본 둘 다 false).
//   거부목록("source 디렉토리는 제외")이 아니라 화이트리스트인 이유 = 거부목록은 새 경로가 생길 때마다 뚫린다.
//   좁히는 방향의 잔여 위험(정직): (a) `docs/plan-for-x.md` 같은 **접두형**은 안 잡힌다(위 이유로 의도)
//   (b) `plans/` 판정이 슬래시만 봐서 네이티브 윈도우의 `docs\plans\x.md`는 디렉토리 규칙에 안 걸린다
//   (형제 함수 `isCodeTarget`의 `docs/`·`SCRATCH_ROOT_RE`가 같은 제약을 공유 — 구분자 정규화는 한 번에
//   묶어야 표류가 안 생겨 후속으로 미룸). 놓쳐도 소프트 리마인더 1회를 못 띄울 뿐이고(차단 아님)
//   게이트 요구 자체는 코어 규칙이 계속 한다.
// ⚠ v0.53.0부터 이 술어의 호출자는 하나가 아니다 — `planPathsInPrompt`(계획 규모 **하드 차단**)도
//   쓴다. 위 '놓쳐도 리마인더 1회를 못 띄울 뿐'은 그쪽엔 해당하지 않는다: 놓치면 차단이 안 걸린다
//   (조용한 미차단). 이 술어를 좁히는 방향으로 손대면 가드가 꺼지는 쪽으로 샌다.
function isPlanDocPath(p) {
  const s = String(p || "");
  if (!/\.md$/i.test(s)) return false;
  if (/(^|\/)plans\//i.test(s)) return true;
  return /(^|\/)(plan|[^/]*[-_.]plan)\.md$/i.test(s);
}

// v0.53.0 계획 규모 가드(기계 채널).
//
// 🛑 **이 가드는 예측기가 아니라 동의 관문이다.** "3,000줄이 넘으면 이 계획은 실패한다"고 말하지
//   말 것 — 그 주장은 **데이터가 반증한다**(3,000줄을 넘긴 계획 5건이 코드를 출하했다: 3,017 ·
//   3,080 · 3,456 · 3,523 · 3,651. 아래 "모집단 두 개를 섞지 말 것" 참조). 이 가드가
//   말하는 것은 하나뿐이다: **"이 크기부터는 검증 결과를 믿기 어려우니, 계속 갈지 사람이 정한다."**
//   틀려도 잃는 것이 **세션마다 승인 클릭 한 번**이라(천 단위 버킷이 바뀌면 다시 받는다 — 승인은
//   그 세션 트랜스크립트에서만 찾고 키에 `Math.floor(lines/1000)` 가 들어간다) 예측이 맞을 필요가
//   없고, 그래서 표본 1건으로도 설 수 있다.
//   프레임을 예측기로 되돌리면 그 성공 사례 5건이 즉시 반례가 되고, "표본이 한 자릿수라 문턱 근거가
//   없다"며 회차 축을 기각한 것(아래 `planScaleBlock` 주석)과 **이중 잣대가 된다.**
//
// **왜 하드 차단인가 — 보고로는 이미 세 번 실패했다(실측, 같은 사고 세션).** 08-07 14:10 · 15:04 ·
//   15:53 에 소프트 권고가 화면 질문까지 올라갔고 사용자가 매번 답했는데도 게이트가 계속 돌았다
//   (사흘간 23회 · 코드 커밋 0건). 08-08 15:03 하드 차단이 걸리자 6분 뒤 "계획서 전체 말고 Stage 1만"
//   으로 전환했고, 그날 밤 기능 커밋 7개가 나갔다. 끊긴 것은 "한 번만 더 검증"이라는 기본 행동이다.
//   ⚠ 정직 고지: **차단이 효과였는지 처방 문구가 효과였는지는 안 갈렸다.** 앞선 소프트 권고 3번은
//   전부 "문서를 쪼개라"는 **틀린** 처방이었고, "일을 쪼개라"는 옳은 처방을 실은 소프트 경보는
//   시험된 적이 없다. 그 실험의 대가가 또 한 번의 사흘짜리 정지라 유지 쪽을 골랐다(2026-08-09).
//
// **문턱 3,000 의 위치(실측 · 크기 × 회차 교차 분석 2026-08-09, 트랜스크립트 2,515개 전수)**
//   - 첫 검증 시점에 3,000을 넘긴 계획서는 **0 / 154**. 이 가드는 첫 검증을 거르지 못한다.
//   - 3,000을 넘긴 계획서 중 **5개(3,017 · 3,080 · 3,456 · 3,523 · 3,651)가 코드를 출하했다.**
//     즉 문턱은 알려진 성공 크기보다 아래에 있다. 그래도 되는 이유는 위 "동의 관문" 절이다.
//     ⚠ **모집단 두 개를 섞지 말 것**(3회차 medium): 위 5개는 **디스크에서 현재 크기를 확인하고
//     커밋으로 출하를 확인한** 목록이다. 교차 분석의 "3,000 초과 3 / 136"은 **게이트 호출이
//     트랜스크립트에 남고 경로까지 해석된** 계획서만 센 좁은 모집단이라(4~5월 다른 실무 프로젝트
//     3건은 그 밖) 숫자가 다르다. 차단문에 쓰는 것은 **5개** 쪽이다.
//   - 실제 차단 이력: **1회**(오차단 0). 표본이 1건이라 오차단률은 사실상 미측정이다.
//     ⛔ 여기 있던 "가드가 처음부터 있었다면 걸렸을 멀쩡한 작업은 한 세션뿐"은 **뺐다**(6회차 medium)
//     — 인용한 분석 문서에 그 수치가 없고 손으로 센 것이었다. 위 5건은 "지금 크다"일 뿐
//     "가드를 만났을 것"이 아니다(넘긴 뒤 게이트를 다시 받았는지는 안 셌다).
//     **재는 법**(다음 사람이 또 손으로 세지 않게): 판정은 제품 함수 `planPathsInPrompt` 로만 하고
//     (느슨한 정규식으로 재다 없는 결론을 만든 2026-08-09 오전 전례), 그 계획서가 3,000줄을 넘긴
//     **뒤에** 그 경로로 게이트를 다시 부른 호출만 센다. 눈으로 훑어 "두세 건쯤"이라고 적지 말 것.
//     ⚠ "언제 3,000을 넘었나"를 `Write` 기록만으로 복원하면 **하향 편향**이다(그 뒤 `Edit` 로 자란
//     것을 못 본다). heredoc 으로 만든 계획서는 **어느 방식으로도** 안 보인다 — 둘 다 분석 문서
//     한계 5번. 편향 방향을 답과 함께 적어라.
//   - 경보 피로는 반대편에서 관측됐다 — 계획 12개 중 10개에 울리던 400줄 소프트 경보가 무시됐다.
//     하드 차단은 게이트를 받은 계획서 164개 중 실제 발동 1회라 그 빈도가 아니다.
//   ⛔ 위 사고 한 건을 **통계적 근거로 승격하지 말 것**(표본 1건짜리 일화다). 문턱을 옮기려면
//     새 실측이 필요하고, 3,700 으로 올리는 안은 이 분석이 지지하지 않는다.
// **기준선 근거(실측)**: plan-validator 의 400줄은 계획서 12개 중 10개에 걸려 **항상 울리는 경보**라
//   무시됐다. 그래서 400은 보고 문턱으로 두고 진행을 막는 문턱만 여기 3,000으로 따로 둔다(다른 건 의도다).
// **v1은 파일 하나만 잰다.** 형제 합산은 접두 계산이 폴더 전체를 한 묶음으로 뭉개는 사고를 냈고
//   (1회차 게이트가 잡음), 실패 건은 합산 없이도 걸리므로 2차로 미뤘다.
//   ⚠ 남는 구멍: 계획을 각 3,000줄 아래 여러 권으로 쪼개면 통과한다.
//   ⚠ 이 값을 바꾸면 **사람용 차단문의 "3,700" 문장도 함께 손봐야 한다**(문턱이 3,700이 되면
//   "3,700줄 아래면 그 구간엔 잘 끝난 계획도 있으니"와 "그보다 크면 알려진 사례 밖이라 쪼개는 쪽을
//   먼저 권합니다"가 뜻을 잃는다 — 그 아래는 이제 안 막히므로).
//   `plan-scale-guard.test.mjs` 의 문턱 동기화 검사가 사람용 첫 문장을 정규식으로 정확히 보므로
//   숫자만 바꾸고 넘어가지는 못한다(3회차 medium: 느슨한 includes 였을 땐 사람용만 눈을 감았다).
const PLAN_MAX_LINES = 3000;

// 경로 문자 클래스를 **뒤집어** 쓴다 — `[\w./-]` 의 `\w` 는 한글을 포함하지 않아
//   `…-홈캘린더-보기개선-1차.md` 가 통째로 안 잡혔다(사용자 계획 폴더 10개 중 4개가 한글 이름).
// **왼쪽 앵커 필수** — 없으면 `[계획서](docs/plans/big.md)` 가 `(docs/plans/big.md` 로,
//   `계획서:docs/plans/big.md`(공백 없음)가 통째로 잡힌다. 둘 다 isPlanDocPath 를 통과한 뒤
//   파일을 못 읽어 **가드가 조용히 꺼진다**(3회차 게이트가 잡음).
// 지목 정규식(`계획서:` 뒤 첫 경로)은 쓰지 않는다 — 경로 안 `plans/` 의 `plan` 에도 붙어 앞이 잘린다.
//   후보를 하나 고르지도 않는다: 읽히는 것을 전부 재서 가장 큰 것으로 판정한다(planScaleBlock).
//   콜론도 경계다 — `계획서:docs/plans/big.md`(공백 없음)에서 한글 라벨이 경로에 붙는다.
//   경로 안의 콜론은 이 환경(WSL·POSIX)에서 안 쓰이므로 배제해도 안전하다.
const PLAN_PATH_RE = /(?:^|[\s"'`(\[<:])([^\s"'`)\]<>:]+\.md)\b/gi;
// 경계 문자 목록은 닫힌 열거라 목록 밖 장식(`@경로`·`**경로**`)이 붙으면 후보가 어긋나고,
//   파일을 못 읽어 **가드가 조용히 꺼진다**(v0.53.0 pr-reviewer 1회차 medium). 그래서 후보를
//   만든 뒤 앞쪽 비경로 문자를 한 번 벗긴다. `./`·`~/`·`/`는 경로 머리라 남긴다.
// ⚠ `\w` 는 한글을 포함하지 않는다. 그래서 "장식 벗기기"를 **한 형태만** 쓰면
//   `한글폴더/plans/x.md` 의 첫 폴더가 통째로 지워져 `/plans/x.md`(절대경로)가 되고,
//   파일을 못 읽어 가드가 조용히 꺼진다(v0.53.0 pr-reviewer 2회차 medium — 1회차에 고친
//   실패 모드가 그 수정 때문에 다른 입력에서 재발했다).
//   그래서 **원본과 벗긴 것을 둘 다 후보로 넣는다** — 읽히는 쪽이 쓰인다.
//   **잘못 벗겨진 후보를 걸러내려 하지 않는다.** 3회차에 "벗겨서 절대경로가 됐으면 버린다"는
//   규칙을 뒀다가 `**/home/.../plan.md`(굵게 쓴 절대경로)를 통째로 놓쳤다. 최종 심판은 파일 읽기라,
//   틀린 후보는 읽기 실패로 알아서 탈락한다 — 미리 거르면 이득 없이 구멍만 는다.
const PLAN_PATH_LEAD_JUNK = /^[^\w/.~]+/;
// 후보 상한. 장식이 붙은 경로는 한 매치가 후보를 2개(원본·벗긴 것) 만들므로 **최악의 경우** 경로 10개까지만
//   커버한다(장식 없는 평범한 경로는 둘이 같아 중복 제거로 1개만 들어간다).
const PLAN_PATH_MAX = 20;
function planPathsInPrompt(text) {
  const out = [];
  const s = String(text || "");
  const push = (p) => {
    if (out.length >= PLAN_PATH_MAX) return;   // 루프 조건만으로는 한 바퀴에 2개가 들어가 상한을 넘는다
    if (p && isPlanDocPath(p) && out.indexOf(p) === -1) out.push(p);
  };
  let m;
  PLAN_PATH_RE.lastIndex = 0;
  while ((m = PLAN_PATH_RE.exec(s)) && out.length < PLAN_PATH_MAX) {
    push(m[1]);
    push(m[1].replace(PLAN_PATH_LEAD_JUNK, ""));
  }
  return out;
}

// 승인 키. **훅이 만들어 사유문에 그대로 찍는다** — 모델이 짐작해 쓰면 안 맞는다.
// 측정값을 버킷으로 넣어 유효 범위를 준다: 4천줄 승인이 9천줄까지 열어주지 않는다.
// 경로가 아니라 **파일 이름**으로 만든다 — 같은 계획을 절대경로로도 상대경로로도 부르는데
//   경로 문자열을 키에 쓰면 표기만 바뀌어도 승인이 무효가 된다.
function bigPlanKey(rel, lines) {
  const base = String(rel).split("/").pop();
  return "[chageun-big-plan:" + base + ":" + Math.floor(lines / 1000) + "k]";
}

// 반환: { key, detail } 또는 null. detail = 승인 키(래퍼가 사유문 뒤에 붙인다).
// 코어 순수 계약(`:1`)을 지키려고 파일 읽기는 **주입받는다** — 없으면 판정하지 않는다.
// ⚑ 이 가드는 **크기 한 축만** 잰다. "같은 계획을 N회째 재검증" 축은 **만들지 않기로 확정됐다**
//   (2026-08-09 사용자 결정 · 되살릴 계획 없음). 기각 사유는 **두 가지이고, 아래 순서가 중요하다.**
//   (1) **이게 기각의 본체다** — 문턱 근거가 없다. 실측 218개 트랜스크립트·83세션 분포에서 늦은 회차
//       표본이 한 자릿수라 어디에 걸어도 표본 몇 개에 맞춘 값이 된다. 이건 고쳐서 없앨 수 있는 결함이
//       아니라 데이터가 없다는 뜻이라, 표본이 크게 늘기 전에는 축 자체가 못 선다.
//   (2) 보조 — 회차의 **주체를 정하는 규칙이 blocker 로 두 번 실패했다**(참고로 언급한 옛 계획서가
//       기준이 되어 처음 검증받는 계획을 막는 경로). 다만 이건 **난이도**이지 불가 근거가 아니다.
//       고치는 법도 이미 적혀 있으므로(파일 회차는 잰 파일에서만 읽기 등) 이 항목 하나로는
//       영구 기각이 안 선다 — 결론을 받치는 건 (1)이다.
//   ⚠ **정정(2026-08-09, Fable 독립 심판)**: 앞서 여기 적었던 "8회·11회차에서야 blocker 0 에 닿고
//   그 회차에 실제 결함을 잡았다"는 **순환 논증이었다** — 그 판정들은 사고 계획서 **자신의 것**이다.
//   "분포에 빈 구간이 없다"도 자기 표와 안 맞는다(7~9가 비어 있다). 두 문장 다 근거로 쓰지 말 것.
//   앞선 두 번의 문턱 설계가 측정 스크립트를 `planPathsInPrompt` 대신 느슨한 정규식으로 짜서 만든
//   **없는 빈 구간** 위에 있었다는 것은 사실이고, 그대로 유효하다.
function planScaleBlock(toolName, toolInput, opts) {
  // v0.65.0: `readable` 이면 판정한다(`via` 는 안 가린다 — 이 가드는 **닫는 쪽**이라 넓혀도
  //   게이트가 안 열리고, 오히려 성질 통로로 띄운 게이트에도 크기 가드가 돈다).
  //   불투명 통로는 무엇을 띄우는지 못 읽어 판정 재료가 없다.
  const si = spawnIntent(toolName, toolInput);
  if (!si || si.kind !== "readable") return null;
  if (gateOf(si.agentType) !== "plan-validator") return null;
  const readFile = opts && opts.readFile;
  if (typeof readFile !== "function") return null;

  const prompt = String((toolInput && toolInput.prompt) || "");
  const cands = planPathsInPrompt(prompt);
  if (!cands.length) return null;   // 경로 미기재 = fail-open(사유문이 우회를 못박는다)

  let big = null;
  for (const rel of cands) {
    let txt;
    try { txt = readFile(rel); } catch (_) { continue; }
    if (typeof txt !== "string") continue;
    // 개행으로 끝나는 파일(대부분의 편집기)은 split 이 끝의 빈 조각까지 세어 1 크게 나온다.
    //   그대로 두면 **정확히 3,000줄인 계획서가 "3,000줄 초과"로 막힌다**(4회차 low).
    const count = txt.split("\n").length - (txt.endsWith("\n") ? 1 : 0);
    if (!big || count > big.lines) big = { rel, lines: count };
  }
  if (!big) return null;            // 하나도 못 읽으면 막지 않는다
  if (big.lines <= PLAN_MAX_LINES) return null;
  // 배열로 돌려준다 — 축이 늘어도 래퍼의 승인 루프가 **축마다** 따로 확인하게(승인 하나가
  //   다른 축까지 함께 열리지 않게 · v0.53.0 pr-reviewer 1회차 medium).
  //   ⚠ 지금은 원소가 1개뿐이라 래퍼의 for/continue 가 비어 보인다. **정리 대상이 아니다** —
  //   축이 늘 때(형제 파일 합산 등) 그 루프가 방어선이다(펴서 hits[0] 로 쓰면 1회차 결함이 되살아난다).
  return [{ key: "plan-size", detail: bigPlanKey(big.rel, big.lines),
            // 라벨을 값에 붙인다 — 차단문이 "맨 끝 `잰 파일`을 보라"고 가리키는데
            //   실제 출력엔 그 라벨이 없어 가리킬 대상이 없었다(3회차 medium).
            measured: "잰 파일 " + big.rel + "(" + big.lines + "줄)" }];
}
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
// 주의(부수효과): `isCodeTarget`은 hasPrReviewer 말고 planReminderNeeded(P1 소프트 리마인더)도 쓴다.
//   (위 `isPlanDocPath`가 아니라 **아래** 함수 이야기다 — 붙어 있어 오독한 전례가 있다.
//     `isPlanDocPath`의 호출자는 planReminderNeeded 와 planPathsInPrompt(v0.53.0 하드 차단) 둘이고 push 게이트는 안 쓴다.)
const SCRATCH_ROOT_RE = /^\/(?:var\/)?tmp\//;
function isScratchPath(s) {
  return SCRATCH_ROOT_RE.test(s) || s.indexOf("/.cache/claude-tmp/") !== -1;
}
// 상황판 안내(v0.65.0 F-27)를 낼 자리인가. **순수 판정**이다(fs 없음).
// 두 번째 인자는 **`null` 일 수 있다** — 위임 도구(`Task`·`Agent`·불투명 통로)에는
//   `file_path` 칸이 아예 없다. null 이면 스크래치 판정을 건너뛰고 도구 이름만 본다.
// 🛑 경로는 **래퍼에서 절대화해** 넘긴다. `isScratchPath` 는 절대 경로 전제라
//   상대 경로(`./scratch/x.md`)로 들어오면 안 걸린다.
// 🛑 위임 갈래는 `spawnIntent` 로 판정한다 — **새 정규식을 만들지 않는다.** 같은 판에서
//   F-29 가 "위임 도구는 그 두 이름이 아니다"를 사실로 만들었고, 사본을 만들면 통로가
//   늘 때 한쪽만 고쳐져 **위임만 하는 세션에 안내가 영영 안 나간다**.
// 정직 고지(안 고치는 절반): macOS 의 `$TMPDIR`(`/var/folders/…`)은 절대 경로여도
//   `isScratchPath` 에 안 걸린다. 🛑 그 함수를 넓히지 않는다 — `isCodeTarget` 을 거쳐
//   push 게이트와 계획 리마인더도 쓰므로 넓히면 그 둘이 함께 헐거워진다. 대가는 안내가
//   한 번 더 뜨는 것뿐이고 **차단이 아니다**.
function statusboardTrigger(toolName, absTargetPath, toolInput) {
  const nm = String(toolName || "");
  if (EDIT_TOOLS_RE.test(nm)) return !(absTargetPath && isScratchPath(absTargetPath));
  return spawnIntent(nm, toolInput) !== null;
}
function isCodeTarget(p) {
  const s = String(p || "");
  if (!s) return false;
  if (/\.mdx?$/i.test(s)) return false;      // 문서는 구현 아님
  if (/(^|\/)docs\//i.test(s)) return false; // docs/ 밑도 문서
  if (isScratchPath(s)) return false;        // 임시·스크래치는 어느 diff에도 안 들어감
  return true;
}
// 계획서 편집이 **진행 표시 토글뿐**인가(2026-08-10 사용자 결정으로 연 예외 하나).
// 실측: 게이트를 통과한 뒤 체크박스 하나를 체크했더니 13초 만에 리마인더가 다시 떴고, 한 세션에서
//   그 모양이 8번 반복됐다. 계획이 안 바뀌었는데 재검증을 요구하는 자리라 예외를 뒀다.
// 범위는 딱 하나다 — Edit 의 old/new 가 `- [ ]` ↔ `- [x]` 차이뿐일 때(대소문자 무관, 그 외는 완전 동일).
//   Write(문서 통째 교체)는 무엇이 바뀌었는지 알 수 없어 적용 안 한다. MultiEdit·NotebookEdit 도 밖이다.
// 이 술어는 **재검증 요구만** 끈다(호출부 참조) — "계획서가 있다"는 사실까지 끄면 지난 세션
//   계획서를 이어받아 체크만 켜는 경우에 리마인더가 통째로 사라진다. 그 계획은 검증을 한 번도
//   안 받았을 수 있다(2026-08-10 pr-reviewer 가 잡은 자리 — 처음엔 둘을 한 자리에서 껐다).
// `g` 는 아래 `.replace()` 전용이다(호출마다 위치가 0으로 초기화된다). **`.test()` 로 바꾸지 말 것** —
// 모듈 전역이라 검사 위치가 호출 사이에 이어져 한 번 걸러 결과가 뒤집힌다.
const CHECKBOX_MARK_RE = /- \[[ xX]\]/g;
function isCheckboxToggleOnly(toolName, inp) {
  if (String(toolName || "") !== "Edit") return false;
  const o = inp && inp.old_string, n = inp && inp.new_string;
  if (typeof o !== "string" || typeof n !== "string") return false;
  // 표식은 표준형(빈 칸)으로 모은다 — 체크 상태만 지우고 나머지 글자는 손대지 않는다.
  const norm = (s) => s.replace(CHECKBOX_MARK_RE, "- [ ]");
  return norm(o) === norm(n);
}
function planReminderNeeded(objs, toolName, toolInput) {
  if (!EDIT_TOOLS_RE.test(String(toolName || ""))) return false;
  const ti = toolInput || {};
  if (!isCodeTarget(ti.file_path || ti.notebook_path)) return false;
  if (!Array.isArray(objs)) return false;
  // v0.53.0: 훅에 **차단된** plan-validator 호출도 tool_use 로는 남는다. 결과를 안 보면 그 호출이
  //   "게이트 거쳤음"으로 계상되어, 검증을 한 번도 못 받은 계획이 리마인더 없이 구현으로 들어간다
  //   (pr-reviewer 1회차 high). 그래서 is_error 결과가 붙은 호출 id 를 먼저 모아 제외한다.
  const erroredIds = new Set();
  for (const o of objs) {
    const mm = (o && o.message) || o; const cc = mm && mm.content;
    if (!Array.isArray(cc)) continue;
    for (const b of cc) {
      if (b && b.type === "tool_result" && b.is_error && b.tool_use_id) erroredIds.add(String(b.tool_use_id));
    }
  }
  let planSeen = false, validated = false, codeEdited = false;
  for (const o of objs) {
    const m = (o && o.message) || o; const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== "tool_use") continue;
      const nm = String(b.name || ""); const inp = b.input || {};
      if (EDIT_TOOLS_RE.test(nm)) {
        const p = inp.file_path || inp.notebook_path;
        // v0.62.0: 계획서 편집이라고 다 무장시키지 않는다. 두 가지를 먼저 뺀다.
        //   (1) 실패한 호출 — 무장만 문제가 아니라 **이미 받아 둔 게이트 통과 기록까지 지웠다.**
        //       `erroredIds` 는 바로 아래 plan-validator 판정이 이미 쓰던 잣대인데 여기만 안 댔다.
        //       ⚠ 두 실패는 사정이 다르다: **쓰기** 실패는 파일이 아예 없고, **편집** 실패는
        //       파일이 있는데 안 바뀐 것이다(대개 바꿀 문장을 못 찾아서). 지금은 둘 다 통째로
        //       건너뛰므로, 지난 세션 계획서를 이어받아 첫 편집이 실패하면 그 계획이 미검증인데도
        //       리마인더가 안 뜬다 — **알고 받아들인 손실**이다(발생 창이 좁다). 테스트로 못 박아
        //       뒀으니 고칠 땐 그 테스트가 빨개진다. 고친다면 (2)처럼 planSeen 만 켜면 된다.
        //   (2) 진행 표시 토글뿐인 Edit — 계획이 안 바뀌었는데 재검증을 요구하던 자리.
        //   (2)는 **재검증 요구만** 끈다. "계획서가 있다"(planSeen)는 사실은 그대로 켠다 —
        //       한 자리에 겹쳐 두면 지난 세션 계획서를 이어받아 체크만 켜는 경우에 리마인더가
        //       통째로 사라진다(그 계획은 검증을 한 번도 안 받았을 수 있다).
        if (isPlanDocPath(p)) {
          if (!erroredIds.has(String(b.id || ""))) {
            planSeen = true;
            if (!isCheckboxToggleOnly(nm, inp)) { validated = false; codeEdited = false; }
          }
        }
        else if (planSeen && isCodeTarget(p)) codeEdited = true;
      } else {
        // v0.65.0 F-29: **`via:"name"` 일 때만** "검증됨"으로 친다. 이 판정은 리마인더를 **끄는**
        //   쪽(= 여는 쪽)이라, 성질까지 넓히면 `아무도구({agentType:"plan-validator"})` 한 줄이
        //   계획 검증 리마인더를 끈다 — 검증을 한 번도 안 받은 계획이 조용히 구현으로 들어간다.
        //   키 목록은 손으로 다시 적지 않고 spawnIntent 와 한 벌로 쓴다(사본 금지).
        const si = spawnIntent(nm, inp);
        if (si && si.kind === "readable" && si.via === "name"
            && planSeen && /plan-validator/.test(si.agentType) && !erroredIds.has(String(b.id || ""))) validated = true;
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
// ── 감독 판정기(v0.65.0 F-28) — 한 곳 ─────────────────────────────────────────
// 🛑 **세 자리가 이 함수 하나를 공유한다**: (1) 문(subagentGateSpawn 이 감독에게만 게이트를 열어 준다)
//   (2) 감독 스폰 차단(감독이 감독을 못 낳는다) (3) 쓰기 차단(supervisorBlock 호출 가드).
//   정규식을 세 군데 박으면 한쪽만 고쳐져 조용히 갈라진다 — 이 저장소에서 같은 사고가 두 번 났다
//   (바로 위 REVIEW_AGENT_RE 의 리브랜드 교훈 · DELEGATE_AGENTS 주석의 일꾼 추가 교훈).
// 🛑 **세 자리가 다 '좁은 판정'이다.** 이 저장소의 평소 방향("막는 판정은 넓게")과 반대인데
//   여기서는 그게 맞다 — **문을 지나는 집합과 쓰기가 막히는 집합이 정확히 같아야 하기 때문**이다.
//   두 집합이 어긋나면 한쪽에 틈이 생긴다. 넓은 쓰기 차단 + 좁은 문이면 감독이 아닌 에이전트가
//   쓰기만 막혀 남의 에이전트를 망가뜨리고, 좁은 쓰기 차단 + 넓은 문이면 **문은 지났는데 쓰기는
//   안 막히는 자**가 생긴다 — 그게 이 설계에서 가장 나쁜 칸이다. 그래서 하나를 공유해 둘을 같게 만든다.
// 네임스페이스 무관 매칭인 이유는 REVIEW_AGENT_RE 와 같다(접두사 하드코딩은 리브랜드에 무음 해제).
const SUPERVISOR_RE = /(?:^|:)supervisor$/;
function isSupervisor(agentType) {
  return typeof agentType === "string" && SUPERVISOR_RE.test(agentType);
}
const AGENT_MEM = path.join(os.homedir(), ".claude", "agent-memory");
// symbolic-ref(HEAD 재기록)·reflog(expire/delete로 복구로그 파기)는 변경 명령이라 제외(pr-reviewer low).
// v0.42: `branch` 추가 — 실측 32건의 리뷰 차단 중 3건이 읽기 전용 branch 조회였다
// (`--show-current` 2 · `--contains` 1). 단 branch는 **읽기 형태만** 통과시킨다(아래 branchArgsAllowed).
// v0.52.0: `check-ignore` 추가 — 순수 읽기다. **기준: git 2.43 옵션 전수**
// (`-q/--quiet` · `-v/--verbose` · `--stdin` · `-z` · `-n/--non-matching` · `--no-index`)에
// 파일·저장소 쓰기가 없고 출력은 stdout 뿐이다. 이 판정기의 옵션 검사는 열거식 **거부**라
// git 이 나중에 쓰기 옵션을 추가하면 자동 통과하므로, 그 목록이 늘면 여기를 다시 본다.
// `hash-object` 는 **안 넣는다**: `-w` 가 객체 저장소에 쓴다(allowlist 원칙 = 모호하면 거부).
const GIT_READ_SUB = /^(?:diff|log|status|show|ls-files|ls-tree|blame|rev-parse|rev-list|shortlog|describe|cat-file|for-each-ref|name-rev|whatchanged|grep|branch|check-ignore)$/;
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
  if (/[<>]|\$\(|`/.test(stripped)) return false;              // 리다이렉션·명령치환 금지(단 인용 없는 `2>&1` 은 reviewAgentBlock 이 원문에서 먼저 지운다)
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
    // `2>&1` 만 지운다. **자리가 두 가지로 정해진다.**
    // (1) **분할 전**이어야 한다 — `&` 가 분할자라 이 토큰은 조각 함수까지 도달하지 못하고
    //     `… 2>` + `1` 로 잘린다(둘 다 거부). 조각 함수에 넣으면 조용히 무효다.
    // (2) **따옴표를 떼기 전**이어야 한다 — stripQuotes 는 따옴표 문자를 버리고 안 쪽 안전 글자를
    //     그대로 내보내므로, 그 뒤에서 지우면 인용된 가짜와 진짜를 구별할 수 없다. 실측(pr-reviewer high):
    //     `git branch '2'>&1` 이 통과했고 **실제로 브랜치 `2` 가 만들어졌다**(bash 는 인용된 숫자를 fd 로
    //     안 보므로 argv 가 `git branch 2` 다). `git log 2>''&1` 은 진짜 `&`(백그라운드 구분자)를 숨겼다.
    //     원문에서 지우면 둘 다 매치되지 않아 그대로 `>` 를 물고 거부된다.
    // 안전 근거: 인용 없는 `2>&1` 은 목적지가 fd 1 로 고정돼 **파일 이름을 못 적는다**.
    // 경계는 bash 의 단어 구분자와 같은 집합으로 좁힌다(자바스크립트 `\s` 는 NBSP 등 bash 가 구분자로
    // 안 보는 글자까지 포함해 스캐너 시야와 argv 가 갈라진다 — pr-reviewer low).
    // 지운 자리에 공백을 남기므로 토큰이 붙지 않고, 지운 뒤 남는 `>`(`2>&1 > out.txt`)는 그대로 거부된다.
    const raw = String((toolInput && toolInput.command) || "").replace(/(?<=^|[ \t\n])2>&1(?=[ \t\n]|$)/g, " ");
    const cmd = stripQuotes(raw);
    if (cmd === null) return "ra-bash";                          // 따옴표 미닫힘·큰따옴표 속 치환 → 거부
    for (const seg of cmd.split(/&&|\|\||[;|&\n]/)) if (!bashSegmentAllowed(seg)) return "ra-bash";
    return null;
  }
  return null;  // 그 외 도구(Read/Grep/Glob 등 — 매처에도 없음)는 관여 안 함
}

// ── 감독의 쓰기 금지(v0.65.0 F-28 · 둘째 겹) ─────────────────────────────────
// 🛑 **허용 목록(`tools:` 넷)이 본체이고 이것은 그 위에 얹는 둘째 겹이다. 순서를 뒤집으면 안 된다.**
//   이 차단은 다섯 이름짜리 **금지 목록**인데 이 하네스의 도구는 40개가 넘고 계속 는다 —
//   금지 목록은 새로 생긴 도구를 못 막는다. 전부 받은 감독은 임의 코드 실행 통로로 파일을 쓰고
//   각본으로 대신 쓸 일꾼을 띄워, "글을 못 쓰는 감독"이라는 이 설계의 전제가 그 갈래에서 깨진다.
//   (오늘 그 두 통로는 subagentGateSpawn 의 불투명 갈래가 따로 막지만, 그것도 이름 목록이다.)
// 그런데 이 겹이 필요한 이유는 도구 목록이 안 지켜져서가 아니다 — **에이전트 정의 파일은 사람이
//   한 줄 고치면 조용히 넓어지는 자리**이고, 그때 아무 검사도 안 울린다. 이 차단이 그 한 줄을 무력화한다.
// 🛑 게이트(reviewAgentBlock)와 달리 `~/.claude/agent-memory/` **예외를 두지 않는다.** 감독은
//   메모리를 안 쓰고, 예외가 없으면 경로 판정 자체가 없어져 우회할 표면도 없다(순수함수 · fs 없음).
function supervisorBlock(toolName) {
  return /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/.test(String(toolName || "")) ? "supervisor-write" : null;
}

// ── 게이트 모델 런타임 강등 가드(v0.42 · Claude 전용) ────────────────────────
// gate-model-tier.test.mjs 는 **frontmatter만** 본다. 그런데 Task/Agent 호출의 `model` 파라미터는
// frontmatter를 덮어쓴다 — 실측: 한 세션이 게이트를 frontmatter보다 낮은 티어로 띄웠고, "게이트
// 규칙대로다"라는 잘못된 믿음까지 적혀 있었다. 아무 층도 이걸 안 막았다.
// 등급표를 **여기(core)에 두고** 테스트가 "core == 각 agent frontmatter" 를 대조한다(사본 2개로 고정 —
// 세 번째 사본은 모델 마이그레이션 때 한 곳만 올려 가드가 조용히 죽는 길이다).
const GATE_MODEL_TIER = { haiku: 1, sonnet: 2, opus: 3, fable: 4 };
// 게이트별 기본(=frontmatter의 model:). 테스트가 lockstep으로 묶는다.
// v0.44.0: fable → opus. 사유는 **비용**이다 — Anthropic 공지 원문 "Fable 5 draws down usage
// faster than Opus 5"(+ 주간 한도의 50% 상한). v0.37.0이 Fable을 고른 근거는 **품질**이었고
// (통제 비교 3판: 같은 집안 심판은 맹점 공유 → 다른 집안이 더 잡는다), 이번 변경은 그 품질을
// 비용과 맞바꾼 것이다. **되돌리는 결정임을 명시한다** — 품질 저하가 관측되면 fable로 되돌린다.
// 상세·되돌림 조건: docs/plans/2026-08-05-gate-model-fable-to-opus.md
const GATE_DEFAULT_MODEL = { "plan-validator": "opus", "pr-reviewer": "opus" };
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
  // v0.65.0: `readable` 이면 본다(`via` 는 안 가린다 — **닫는 쪽**이라 넓혀도 게이트가 안 열린다).
  //   불투명 통로는 무엇을 어떤 모델로 띄우는지 못 읽어 여기서 판정이 성립하지 않는다.
  //   그 구멍은 이 함수가 아니라 신선도 불변식이 무해화한다(hasPrReviewer 의 opaque 가지:
  //   각본으로 게이트를 강등해 띄워도 그 리뷰가 리뷰로 안 쳐져 push 가 여전히 막힌다).
  const si = spawnIntent(toolName, toolInput);
  if (!si || si.kind !== "readable") return null;
  const inp = toolInput || {};
  const gate = gateOf(si.agentType);
  if (!gate) return null;
  const asked = String(inp.model || "").toLowerCase();
  if (!asked) return null;                                   // 미명시 = frontmatter 상속 → 정상
  const want = GATE_DEFAULT_MODEL[gate];
  const a = GATE_MODEL_TIER[asked], w = GATE_MODEL_TIER[want];
  if (!a || !w) return null;                                 // 모르는 값 → fail-open
  return a < w ? "gate-model-downgrade" : null;
}

// v0.64.0 H-2: **서브에이전트는 게이트를 못 띄운다.**
// 서브에이전트의 push 차단은 원래 "자기 기록에 pr-reviewer 흔적이 없어서" 성립했다. 그러면
// 서브에이전트가 스스로 pr-reviewer 를 띄우는 순간 흔적이 생겨 자기 자물쇠가 풀린다(래퍼의 push
// 차단을 조건 없이 만든 것이 반쪽이고, 흔적을 만들 길을 막는 이것이 나머지 반쪽이다).
// 독립성 근거는 그것과 별개로도 선다 — 만든 쪽이 자기 검사 범위를 고르면 검사가 아니다
// (routing '위임과 BLOCKED 계약' 5항 · 두 구현 에이전트 계약의 "게이트를 직접 부르지 않는다").
// 막는 범위는 **게이트 스폰만**이다. 중첩 스폰 전반(조사·탐색 위임)은 텍스트 계약이 막고 여기선 안 센다
//   — 기계 차단을 넓히면 무엇이 정상 작업인지 판정할 근거가 없다(과차단이 조용한 우회를 부른다).
// 판정 재료는 도구 이름과 `subagent_type` 뿐이라 fs·트랜스크립트가 필요 없다(순수함수).
// v0.65.0 F-29(결정 4번 · 2026-08-11): **불투명 통로도 서브에이전트에서 막는다.**
//   T0 프로브 실측이 이 결정을 추측에서 근거로 바꿨다: 각본에서 지정한 `agentType` 이 훅 입력에
//   **그대로** 실려 온다(`agentType:'general-purpose'` → `agent_type:"general-purpose"`). 즉 각본
//   한 줄로 게이트 이름을 띄우면 차근이 그것을 **게이트로 인정한다.** 게다가 각본 안의 `agent()`
//   스폰 자체는 PreToolUse 를 안 낸다(같은 프로브 · 그 창의 전수 로그 9줄에 Task·Agent 이름 0건).
//   훅이 스폰을 볼 기회는 `Workflow` 호출 **한 번**뿐이라, 안쪽을 하나씩 판정할 방법이 없다 —
//   문 앞에서 막는 것 말고 수가 없다.
// **오늘 오차단 0인 근거**: 이 두 도구는 서브에이전트 도구 목록에 없다(2026-08-11 확인 · REPL 은
//   전체 기록 2,235개 트랜스크립트에서 호출 0건). ⚑ **나중에 주어지는 날부터는 정상 위임도 막힌다** —
//   그때 다시 볼 자리다. 다시 볼 신호 = 서브에이전트 도구 목록에 Workflow·REPL 이 생기는 것.
// v0.65.0 F-28(감독 에이전트): 이 함수가 **문**이 된다. 갈래 둘을 더한다 —
//   (4) 대상이 감독이면 무조건 차단(감독은 본 세션만 띄운다 = '감독인 척' 자물쇠),
//   (5) 대상이 게이트인데 **부르는 쪽이 감독이면 통과**(이것이 문이다).
//   문이 걸린 값은 지시문 글자도 프롬프트 라벨도 아니고 하네스가 스폰 시점에 박는 `agent_type` 이라,
//   감독 지시문을 그대로 베껴 붙여도 `agent_type` 은 안 바뀐다.
// 🛑 **판정 순서가 곧 안전이다.** 불투명 갈래(3)가 감독 갈래(4·5)보다 **먼저**여야 한다 —
//   불투명 통로는 대상 이름이 빈 값이라, 뒤에 두면 이름 판정 세 줄을 전부 빠져나가 null 로 떨어진다.
//   그리고 "도구가 Task/Agent 가 아니면 null" 을 여기에 다시 쓰면 F-29 의 불투명 통로 차단이
//   한 줄로 통째로 사라진다(그때 test/hook-net.test.mjs 의 층4 칸이 빨개진다 — 고칠 것은 검사가 아니라 여기다).
function subagentGateSpawn(agentType, toolName, toolInput) {
  if (!agentType) return null;                               // 1. 메인 세션은 대상 아님
  const si = spawnIntent(toolName, toolInput);
  if (!si) return null;                                      // 2. 스폰 통로가 아님
  if (si.kind === "opaque") return "subagent-opaque-spawn";  // 3. F-29 갈래 — 감독에게도 그대로 산다
  if (isSupervisor(si.agentType)) return "subagent-supervisor-spawn";  // 4. 감독 재생산·'감독인 척' 금지
  if (isSupervisor(agentType)) return null;                  // 5. 문 — 감독만 게이트를 띄운다
  // `via` 는 안 가린다 — **닫는 쪽**이라 넓혀도 게이트가 안 열린다. 성질 통로로 게이트를 띄우는 것도 막힌다.
  return gateOf(si.agentType) ? "subagent-gate-spawn" : null;  // 6. 그 외 서브에이전트는 지금 그대로
}

// 컴포넌트 새 변형 승인은 metadata가 아니라 저장된 AskUserQuestion 도구 호출과 결과를 묶어 확인한다.
// 질문 문구는 사용자 언어가 달라도 되며, 보이는 키와 두 번째 선택이라는 구조만 고정한다.
// v0.53.0: 계획 규모 가드도 같은 승인 방식을 쓴다. 키만 다르므로 **본문을 공유 헬퍼로 뽑았다**
//   (사본을 늘리면 한쪽만 고쳐져 조용히 갈라진다 — `typeByToolUseId` 자리에 같은 경고가 이미 있다).
//   ⚠ 위치는 줄번호가 아니라 **이름·문구**로 가리킨다. 줄번호는 위에 몇 줄만 끼어도 거짓이 된다
//   (3회차 low: 새로 쓴 주석 3곳의 줄번호가 전부 다른 코드를 가리키고 있었다).
//   `approvedDesignVariant` 의 시그니처·동작은 그대로다.
function approvedByAskKey(transcript, key) {
  const blocks = [];
  for (const record of Array.isArray(transcript) ? transcript : []) {
    const content = (record && (record.message || record).content) || [];
    if (!Array.isArray(content)) continue;
    for (const block of content) blocks.push(block);
  }
  let ask = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || block.type !== "tool_use" || block.name !== "AskUserQuestion" || !block.id) continue;
    const questions = block.input && block.input.questions;
    if (!Array.isArray(questions) || questions.length !== 1) continue;
    const question = questions[0];
    if (!question || question.multiSelect !== false || !Array.isArray(question.options) || question.options.length !== 2
      || typeof question.question !== "string" || typeof question.options[1]?.label !== "string") continue;
    if (question.question.split(key).length - 1 !== 1) continue;
    // break 하지 않는다 = **마지막** 질문만 본다. 같은 키로 한 번 더 물어놓고 답을 안 받으면
    //   앞서 받아 둔 승인이 무효가 된다(기존 컴포넌트 승인에서 물려받은 동작 · 3회차 low로 수용).
    ask = { index, id: String(block.id), question: question.question, secondLabel: question.options[1].label };
  }
  // wellFormed: 형식이 맞는 질문을 찾았는가. 차단문이 "형식 오류"와 "사용자가 안 눌렀다(거절 포함)"를
  //   갈라 말하는 데 쓴다 — 거절을 형식 오류로 안내하면 모델이 같은 질문을 다시 띄운다(3회차 medium).
  if (!ask) return { approved: false, toolUseId: null, wellFormed: false };
  const answer = `${JSON.stringify(ask.question)}=${JSON.stringify(ask.secondLabel)}`;
  for (let index = ask.index + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block && block.type === "tool_result" && String(block.tool_use_id || "") === ask.id
      && !block.is_error && typeof block.content === "string" && block.content.includes(answer)) {
      return { approved: true, toolUseId: ask.id, wellFormed: true };
    }
  }
  return { approved: false, toolUseId: null, wellFormed: true };
}

function approvedDesignVariant(transcript, componentId, variantId) {
  return approvedByAskKey(transcript, `[chageun-design-variant:${componentId}:${variantId}]`);
}

// 큰 계획 진행 승인. 키는 `bigPlanKey()` 가 만들어 차단 사유문에 그대로 찍는다 —
//   모델이 짐작해 쓰면 안 맞는다. env 탈출구를 안 쓰는 이유는 그게 세션 도중 못 켜지기 때문이다
//   (REASONS["deploy"]·REASONS["gate-skip"] 문구가 같은 사실을 이미 못박아 뒀다).
function approvedBigPlan(transcript, key) {
  return approvedByAskKey(transcript, String(key || ""));
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
  "plan-size": "무인 차단(park): 계획서가 3,000줄을 넘습니다. 사람이 돌아오면 일을 쪼갤지 " +
    "이 크기로 갈지 정해야 합니다 — 무인 중에는 큰 계획을 통과시키지 않습니다.",
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

module.exports = { statusboardTrigger, planScaleBlock, approvedBigPlan, planPathsInPrompt, bigPlanKey, PLAN_MAX_LINES, block, reasonFor, isPrCreate, isPush, hasPrReviewer, planReminderNeeded, routingReminderNeeded, designRegistryReminderNeeded, isUiTarget, unattendedBlock, isEgress, isWriteSql, reasonForUnattended, budgetStep, isGitCommit, BUDGET, isReviewAgent, reviewAgentBlock, branchArgsAllowed, gateModelBlock, subagentGateSpawn, approvedDesignVariant, GATE_MODEL_TIER, GATE_DEFAULT_MODEL, spawnIntent, LEGACY_UNATTENDED_SCOPE, isSupervisor, supervisorBlock, spawnCountIn, spawnCapReached, SUPERVISOR_SPAWN_CAP };
