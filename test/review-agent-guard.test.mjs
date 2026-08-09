import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const core = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
const { isReviewAgent, reviewAgentBlock, reasonFor } = core;
const MEM = join(os.homedir(), ".claude", "agent-memory");

test("isReviewAgent: 네임스페이스 무관 매칭(리브랜드 안전)", () => {
  for (const y of ["chageun:pr-reviewer", "honclwd:pr-reviewer", "pr-reviewer", "chageun:plan-validator", "plan-validator"])
    assert.equal(isReviewAgent(y), true, y);
  for (const n of ["chageun:code-implementer", "code-implementer", "general-purpose", undefined, null, "", "pr-reviewer-x", "x-plan-validator-y"])
    assert.equal(isReviewAgent(n), false, String(n));
});

test("Write: agent-memory 밖 차단, 안 허용", () => {
  const W = (fp) => reviewAgentBlock("chageun:pr-reviewer", "Write", { file_path: fp });
  assert.equal(W(join(MEM, "chageun-pr-reviewer", "notes.md")), null);           // 안 → 허용
  assert.equal(W("/home/x/proj/src/a.js"), "ra-write");                          // 프로젝트 파일
  assert.equal(W(join(os.homedir(), ".claude", "settings.json")), "ra-write");   // 설정
  assert.equal(W(join(os.homedir(), ".claude", "agent-memory-evil", "x")), "ra-write"); // 형제 폴더
  assert.equal(W(join(MEM, "..", "escape.md")), "ra-write");                     // .. 이탈
  assert.equal(W("~/.claude/agent-memory/chageun-pr-reviewer/n.md"), null);      // ~ 확장
  assert.equal(W(""), "ra-write");                                               // 빈 경로
  assert.equal(W("relative/notes.md"), "ra-write");                              // 상대경로
  assert.equal(reviewAgentBlock("chageun:plan-validator", "Edit", { file_path: "/proj/plan.md" }), "ra-write");
});

test("Bash: git 읽기만 허용, 나머지·리다이렉션·치환 차단", () => {
  const B = (c) => reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: c });
  for (const ok of ["git diff", "git status", "git log --oneline", "git show HEAD",
                    "git ls-files --others --exclude-standard", "git diff --stat",
                    "git diff HEAD | head -50", "git -C /r diff", "git --no-pager log",
                    "git grep -n 'a|b'", "git log --grep='fix|feat'"])   // 따옴표 속 | 과차단 안 됨(pr-reviewer low)
    assert.equal(B(ok), null, "허용이어야: " + ok);
  for (const bad of ["git checkout main", "git reset --hard", "git stash", "git apply p.diff",
                     "git cherry-pick x", "git merge b", "git commit -m x", "git push",
                     "git -c core.pager=!sh log", "npm test", "node -e 'x'", "npx prettier --write .",
                     "echo x > f", "git diff > out.txt", "rm f", "mv a b", "sed -i s/a/b/ f",
                     "cat $(rm x)", "PAGER=cat git log",
                     "git diff & npm test", "sort -o out.txt in", "uniq in out", "git worktree add w",
                     "git diff --output=/tmp/x", "git grep -O pager", "git symbolic-ref HEAD x", "git reflog expire --all"]) // 쓰기/변경 옵션·서브명령(pr-reviewer low)
    assert.equal(B(bad), "ra-bash", "차단이어야: " + bad);
});

// 실측 재현된 침투 경로 3개(2026-07-30). 옛 stripQuotes(정규식 짝짓기)가 따옴표 안을 먼저 지운 뒤
// 위험 검사를 해서, 큰따옴표 안 치환·아포스트로피 어긋남·pager 등호형이 전부 빠져나갔다. H1·H3은
// 실제 셸에서 명령 실행까지 확인했다(파일 생성). 이 테스트가 세 경로와 구현 함정 하나를 못박는다.
test("Bash: 따옴표 우회 침투 경로 차단(명령치환·따옴표 어긋남·pager 등호형)", () => {
  const B = (c) => reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: c });
  const bt = String.fromCharCode(96);
  for (const bad of [
    `git log --grep="$(id > /tmp/x)"`,                        // H1 큰따옴표 안 명령치환(셸은 실행한다)
    `git log --grep="${bt}id${bt}"`,                          // H1 백틱 치환
    `git log --grep="\${ id; }"`,                             // H1 bash 5.3 함수치환(분할 부작용에 의존하지 않게 명시 거부)
    `git log --grep="don't" && rm -rf /tmp/x && git log --grep="won't"`, // H2 아포스트로피 짝짓기로 가운데가 사라졌다
    `git grep --open-files-in-pager='touch /tmp/x ;true' TODO`, // H3 등호형(끝앵커 $가 빠뜨렸다)
    `git grep --open-files-in-pager 'touch /tmp/x' TODO`,       // H3 두 토큰형
    `git log --grep='\\' ; id #'`,                             // 구현 함정: 작은따옴표 안엔 이스케이프가 없다 —
                                                               // 여기에 백슬래시 처리를 넣으면 bash에선 id가 실행되는데 통과한다
    `git log --grep="unclosed`,                                // 미닫힘 따옴표 → fail-closed
    // git은 모호하지 않은 **긴 옵션 축약**과 **짧은 옵션 묶음**을 받아준다 — 이름 문자열 대조만 하면 뚫린다.
    // 실측(2026-07-30 빈 저장소): `--op`부터 실행됨(`--o`만 모호로 거부) · `-nO<cmd>` 묶음형도 실행됨.
    `git grep --op=touch M TODO`,                              // 축약 최소단위
    `git grep --ope=touch M TODO`,
    `git grep --open='touch M' TODO`,
    `git grep --open-f='touch M' TODO`,
    `git grep -nO'touch M' TODO`,                              // 묶음형(두 번째 글자부터 O)
    // 인용으로 옵션을 가리는 4형(pr-reviewer high 2차). 셸은 따옴표를 벗겨 원문 그대로를 git argv로
    // 넘기므로 인용 여부는 git에게 보이지 않는다 — 실측: 4형 전부 실제로 실행됐다(파일 생성/쓰기 확인).
    `git grep '--open-files-in-pager=touch M' TODO`,           // 통짜 작은따옴표
    `git grep "-Otouch M" TODO`,                               // 큰따옴표 묶음형
    `git log \\--output=M`,                                    // 백슬래시로 첫 대시 가리기
    `git grep '--open'-files-in-pager='touch M' TODO`,         // 부분 인용 접합
    // 셸 **확장**으로 첫 글자를 가리는 3형(pr-reviewer high 3차). 스캐너가 본 토큰과 git이 받는 argv가
    // 갈라지는 마지막 통로 — 수법이 아니라 "다시 쓰기 자체"를 막는 불변식으로 닫았다.
    `git grep -\${x}Oid TODO`,                                 // 미설정 변수는 지워져 argv가 `-Oid`(실측 실행됨)
    `git grep -\${x}O"touch M" TODO`,
    `git grep {-Oid,x} TODO`,                                  // 중괄호 확장 → `-Oid x`(실측 확인)
    `git grep *Oid TODO`,                                      // 선두 글롭 — 그 이름의 파일이 있으면 토큰이 통째로 바뀐다
    `git grep $'-Oid' TODO`,                                   // ANSI-C 인용으로 대시 가리기(인용으로 인식하되 안전 글자는 드러난다)
    // ANSI-C **수치 이스케이프**는 bash가 디코드해 대시를 만든다 — 스캐너도 디코드해야 argv와 안 갈라진다.
    // 실측: `git grep $'\\x2dOtouch X' TODO`가 실제로 파일을 만들었다(8진형도 동일).
    `git grep $'\\x2dOid' TODO`,
    `git grep $'\\055Oid' TODO`,
    `git grep $'\\u002dOid' TODO`,
    // 옵션 **이름부** 글롭 — 트리에 `-nO…` 파일이 있으면 그 이름으로 대체돼 실행된다(미끼 파일로 실측 재현).
    `git grep -n* TODO`,
    `git grep --op* TODO`,
  ]) assert.equal(B(bad), "ra-bash", "차단이어야: " + bad);

  // 과차단 방지(plan-validator high): 셸이 리터럴로 두는 것은 계속 통과해야 한다.
  for (const ok of [
    `git grep -n "TODO$"`,                                    // 정규식 끝 앵커 — 코드 검색의 관용구
    `git log --grep="^fix.*$"`,
    `git log --grep="$HOME"`,                                 // 변수 확장은 인자일 뿐(구분자 주입 불가)
    `git log --grep="a && b"`,                                // 큰따옴표 안 &&는 리터럴 — 세그먼트가 아니다
    `git diff --output-indicator-new=X main...HEAD`,           // 파일을 쓰지 않는데 프리픽스 매칭에 걸렸던 것(low)
    `git log --oneline -5`,                                    // `^--op` 확대가 `--oneline`을 안 건드리는지
    `git grep -e a --or -e b`,                                 // git grep `--or`도 무관
    `git -C "/mnt/g/내 드라이브/proj" diff main...HEAD`,        // 공백 있는 경로 — 따옴표 구간을 공백으로 지우면
                                                               // `-C`가 서브명령을 먹어 정상 명령이 막혔다(자리표시 토큰으로 해결)
    `git diff "my file.txt"`,                                  // 인용된 경로 — 안전 글자 보존이 이걸 깨지 않아야 한다
    `git grep -c $'\\r$' HEAD -- docs/design-system.md`,        // ANSI-C 인용(CR 검색) — 실무에서 실제로 쓰인다
    `git grep -c $'\\xe2\\x9c\\x89' HEAD -- web/x.tsx`,          // 이모지를 바이트로 검색(실측 코퍼스에 있던 실제 명령) —
                                                               // 수치 이스케이프를 거부하면 이게 막힌다. 디코드해서 안전 글자만 드러내면 둘 다 만족
    `git grep -n x -- --include=*.ts`,                         // 글롭이 선두가 아니면 확장돼도 `-`가 유지된다
    `git diff HEAD@{1} HEAD --stat`,                           // reflog 표기 — 콤마·범위가 없어 셸이 리터럴로 둔다
    `git rev-parse HEAD HEAD^{tree}`,                          // tree 표기도 마찬가지
    `git log -- '*.ts'`,                                       // 글로빙이 필요하면 인용 — git이 직접 글롭하는 권장형
  ]) assert.equal(B(ok), null, "허용이어야: " + ok);
});

test("비리뷰 에이전트는 판정 안 함(호출부 가드) — reviewAgentBlock은 리뷰 전제", () => {
  // 함수 자체는 agentType을 안 보지만, 배선이 isReviewAgent로 가드하므로 여기선 매칭만 확인.
  assert.equal(isReviewAgent("chageun:code-implementer"), false);
});

test("REASONS 3키가 행동 지시형으로 존재", () => {
  for (const k of ["ra-write", "ra-bash", "ra-error"]) {
    const msg = reasonFor(k);
    assert.ok(msg && msg !== "차단: 되돌리기 어려운 고위험 명령입니다.", k + " 문구 부재");
    assert.ok(/발견으로 보고|Read\/Grep|계속/.test(msg), k + " 행동지시 아님");
  }
});

// ── v0.42(7번): git branch 는 읽기 형태만 ────────────────────────────────────
// 실측 32건의 리뷰 차단 중 3건이 읽기 전용 branch 조회였다(`--show-current` 2 · `--contains` 1).
// 거부목록이 아니라 **allowlist**인 이유: `git branch 새이름`은 옵션이 하나도 없는 쓰기라
// 거부목록이 원천적으로 못 잡는다(plan-validator F-5). 근거 원본 = src/hooks/pretooluse-core.js의
// `branchArgsAllowed`와 그 위 주석(줄 번호 대신 심볼로 가리킨다 — 소스가 밀려도 안 어긋나게).
// (v0.49.0 Codex 삭제 때 함께 날아간 것을 되살렸다. 원문 3줄에 소스 실측 세부를 덧붙인 형태이지,
//  원문에서 Codex 서술만 뺀 것이 아니다 — 원문엔 Codex 서술이 없었다. pr-reviewer low.)
test("branch 읽기 형태는 통과 — 실측으로 막혔던 3건", () => {
  for (const cmd of [
    "git -C /repo branch --show-current",
    "git -C /repo branch --contains 8839c92 -a",
    "git branch",                       // bare = 목록 조회
    "git branch --list",
    "git branch -a", "git branch -r", "git branch -v", "git branch -av",
    "git branch --merged main", "git branch --format='%(refname)'", "git branch --sort=-committerdate",
  ]) assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), null, cmd);
});
test("branch 쓰기 형태는 전부 차단 — 거부목록이 놓치던 경로 포함", () => {
  for (const cmd of [
    "git branch 새이름",                 // (a) 옵션 0개 쓰기 — 거부목록이 못 잡던 것
    "git branch feature/x main",
    "git branch -d old", "git branch -D old",
    "git branch --delete old", "git branch --del old",   // (b)(d) 장형·접두 축약
    "git branch -m a b", "git branch --move a b",
    "git branch -c a b", "git branch --copy a b",
    "git branch -f x main",                               // (c) 단형 -f
    "git branch -rd origin/x",                            // (e) 묶음
    "git branch -u origin/x", "git branch --set-upstream-to=origin/x",
    "git branch --edit-description",
    "git branch -- x",
  ]) assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), "ra-bash", cmd);
});
test("branch 허용이 다른 서브명령 판정을 흔들지 않는다", () => {
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: "git log --oneline -5" }), null);
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: "git checkout main" }), "ra-bash");
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: "git branch --show-current && rm -rf /tmp/x" }), "ra-bash");
});
test("차단 안내문이 branch 조건부 허용과 대체 명령을 알린다(M-2 정합)", () => {
  const msg = reasonFor("ra-bash");
  assert.ok(msg.includes("branch는 읽기 형태만"), "허용 목록에 branch를 넣었으면 안내문도 알려야 함");
  assert.ok(msg.includes("rev-parse --abbrev-ref HEAD") && msg.includes("for-each-ref --contains"),
    "자주 막히던 것의 이미 허용된 대체를 안내");
});

// ── v0.52.0: check-ignore 는 순수 읽기 ─────────────────────────────────────────
// 2026-08-08 회고 실측: 리뷰 담당 Bash 차단 42건 중 **진짜 오차단은 check-ignore 2건뿐**이었다.
// (파이프는 원래 통과하고, `2>&1`은 `>`를 여는 것이라 의도된 차단이며, hash-object 는 `-w` 가 쓴다.)
// ⚠ 이 중 `2>&1` 판정은 **v0.57.0 에서 뒤집었다** — 근거는 이 파일 끝 v0.57.0 절. 셈이 틀려서가 아니라
// `>` 를 덩어리로 보던 것을 토큰 하나로 좁혔기 때문이다(그 토큰은 파일 이름을 못 적는다).
// git 2.43 옵션 전수 `-q/-v/--stdin/-z/-n/--no-index` 에 파일·저장소 쓰기가 없다.
test("check-ignore 는 읽기 전용이라 통과", () => {
  for (const cmd of [
    "git check-ignore -v docs/x.md",
    "git check-ignore -q src/x",
    // `--stdin` 은 입력 경로가 있다(READ_FILTER 에 cat 이 있어 `cat f | …` 가 통과한다).
    // 그래도 출력이 stdout 뿐이라 무해하다 — 1차 계획의 "입력 경로가 없다"는 근거는 틀렸다.
    "cat list.txt | git check-ignore --stdin",
    "git -C /repo check-ignore -z --no-index src/x",
  ]) assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), null, cmd);
});

test("check-ignore 를 열어도 쓰기형·탈출형은 그대로 막힌다", () => {
  for (const cmd of [
    "git hash-object -w src/x",           // 객체 저장소에 씀 → allowlist 밖(YAGNI 로 안 연다)
    "git check-ignore -v x > out.txt",    // 리다이렉션
    "git check-ignore -v $(cat x)",       // 명령치환
    "git branch newname",                 // 쓰기형 branch
    "git checkout main -- dist/",         // 체크아웃
  ]) assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), "ra-bash", cmd);
});

// 허용목록과 안내문이 **두 벌**이라 한쪽만 고치면 조용히 어긋난다(안내문이 거짓말을 하거나,
// 허용된 명령을 아무도 모른다). 부분문자열 대조는 못 쓴다 — `includes("log")` 는 `shortlog`
// 때문에 log 를 지워도 초록이다. 경계 정규식도 못 쓴다 — `branch` 가 안내문에선
// `**branch는` · `` `git branch`. `` 로만 나와 무조건 실패한다(plan-validator 3차 F-1).
// 그래서 **집합 대조**로 한다. 목록을 손으로 베끼지 않고 양쪽 원본에서 뽑는다.
test("허용 서브명령과 ra-bash 안내문이 양방향으로 일치", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"), "utf8");
  const m = src.match(/const GIT_READ_SUB = \/\^\(\?:([^)]+)\)\$\//);
  assert.ok(m, "GIT_READ_SUB 를 못 찾음 — 정규식 모양이 바뀌었으면 이 테스트도 같이 고칠 것");
  const subs = m[1].split("|");
  const msg = reasonFor("ra-bash");

  const runs = msg.match(/(?:[a-z][a-z-]*·){3,}[a-z][a-z-]*/g);
  assert.ok(runs, "안내문의 서브명령 나열부를 못 찾음 — 문장 모양이 바뀌었으면 이 테스트도 같이 고칠 것");
  const listed = new Set(runs.join("·").split("·"));

  // 나열부가 아니라 **산문으로** 설명하는 것. 늘리려면 안내문 원문을 보고 늘린다.
  const PROSE_ONLY = new Set(["branch"]);
  for (const s of PROSE_ONLY) assert.ok(msg.includes(s), `산문 설명이 사라진 서브명령: ${s}`);

  for (const s of subs)                                    // 허용목록 → 안내문
    assert.ok(listed.has(s) || PROSE_ONLY.has(s), `안내문에 빠진 허용 서브명령: ${s}`);
  for (const s of listed)                                  // 안내문 → 허용목록
    assert.ok(subs.includes(s), `안내문에만 있고 허용목록엔 없는 서브명령: ${s}`);
});

// ── v0.57.0: `2>&1` 은 파일을 못 만들고 오류를 감추지도 않는다 ─────────────────
// 30일 실측: ra-bash 로 막힌 고유 명령 125개 중 **40개가 이 토큰 하나 때문**이었다.
// (docs/2026-08-09-ra-bash-reconciliation.md — 완화안을 제품 소스에 실제로 넣은 사본으로 같은 기록을
//  다시 흘려 잰 값. 잰 규칙은 아래 구현과 글자까지 같고, 앵커 없는 느슨한 판으로도 40개로 동일했다.)
// 근거 둘: (1) 목적지가 파일 이름이 아니라 fd 1 로 고정돼 **이름을 못 적는다**.
// (2) stderr 를 화면에 끌어오므로 `2>/dev/null`(오류 감추기)의 **정반대**다 — 그래서 그쪽은 계속 막는다.
// ⚠ 이 토큰은 `&` 가 분할자라 `bashSegmentAllowed()` 까지 도달하지 못한다(`… 2>` + `1` 로 잘린다).
// 그래서 처리 자리가 **분할 전**이다. 조각 함수에 넣으면 조용히 아무 일도 안 한다(plan-validator 1차 blocker).
test("`2>&1` 은 통과한다", () => {
  for (const cmd of [
    "git log --oneline -3 2>&1",
    "git -C /repo grep -n TODO -- src 2>&1 | head -30",
    "git status --short 2>&1",
    "git -C /repo diff --stat main...HEAD 2>&1 | head -50",
  ]) assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), null, cmd);
});

test("`2>&1` 을 열어도 나머지 리다이렉션은 그대로 막힌다", () => {
  for (const cmd of [
    "git log > out.txt",              // 파일 쓰기
    "git log 2>/tmp/pwn",             // stderr 를 파일로
    "git log 2>/dev/null",            // 오류 감추기 — 이번에 안 연다
    "git log 2>>/dev/null",           // 덧붙이기
    "git log 12>&1",                  // fd 12 (앞이 공백이 아니라 앵커에 안 걸린다)
    "git log 2>&1x",                  // 토큰 뒤에 붙음
    "git log {fd}>&1",                // 이름 있는 fd
    "git log 1>&2",                   // 방향 반대
    "git log 2>&1 > out.txt",         // 지운 뒤에도 남는 `>`
    "git log 2>&1; rm -rf /tmp/x",    // `;` 가 붙으면 뒤 앵커에 안 걸려 **치환 자체가 안 일어난다**
    "git push origin main 2>&1",      // 허용목록 밖 서브명령
    "echo hi 2>&1",                   // 허용목록 밖 머리
  ]) assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), "ra-bash", cmd);
});

// 따옴표 속 리터럴을 지우면 `&&` 가 드러나 뒤쪽 명령이 통째로 사라진다(v0.41.0 H2 와 같은 모양의 함정).
// **정확히는 따옴표가 `>` 나 `&` 를 덮을 때만** 자리표시가 되어 대상에서 빠진다 — stripQuotes 는 따옴표
// 문자 자체를 버리고 인용 안 안전 글자(SAFE_IN_QUOTE, 숫자 포함)는 그대로 내보내기 때문이다.
test("따옴표가 `>`·`&` 를 덮으면 치환 대상이 아니다", () => {
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash",
    { command: "git log --grep='2>&1' && rm -rf /tmp/x" }), "ra-bash");
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash",
    { command: 'git log --grep="2>&1" && rm -rf /tmp/x' }), "ra-bash");
});

// 반대로 따옴표가 숫자만 덮으면 토큰이 복원되어 지워진다. **무해함까지 확인했다**(plan-validator 2차 medium):
// 셋 다 bash 에서도 fd 복제이거나 인자가 하나 늘 뿐이고 파일을 만들지 않는다. 현재 동작을 못박아 둔다.
test("따옴표가 숫자만 덮으면 복원되어 지워진다(무해)", () => {
  for (const cmd of ["git log ''2>&1", "git log '2'>&1", "git log 2>&'1'"])
    assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: cmd }), null, cmd);
});

// `g` 플래그가 빠지면 두 번째부터 안 지워진다 — 그 변이를 잡는다.
// 명령어 없이 토큰만 있는 입력은 빈 조각이 되어 통과한다(bash 에서도 아무 일이 없다). 의도임을 적어 둔다.
test("`2>&1` 이 두 번 나와도 통과하고, 토큰만 있는 입력도 통과한다", () => {
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash",
    { command: "git log --oneline -3 2>&1 && git status --short 2>&1" }), null);
  assert.equal(reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: "2>&1" }), null);
});

// 안내문이 조용히 되돌아가면 리뷰 담당이 허용된 형태를 영영 모른다. 두 방향을 함께 못박는다.
test("안내문이 `2>&1` 허용과 `2>/dev/null` 금지를 함께 알린다", () => {
  const msg = reasonFor("ra-bash");
  assert.match(msg, /`2>&1`은 됩니다/, "허용을 알려야 리뷰 담당이 쓴다");
  assert.match(msg, /2>\/dev\/null.{0,20}오류 감추기/, "감추는 쪽은 계속 막힌다는 것도 남겨야 한다");
});
