import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// 작업방 위임 규칙(v0.69.0)의 그물.
//
// 🛑 읽는 대상을 **`src/` 로 못박는다.** 같은 문자열이 `dist/` 와 `test/golden/` 에도 있어서,
//    범위를 안 좁히면 "빌드가 돌았나"를 재는 검사가 되어 버린다(원본이 비어도 옛 빌드 산출물이
//    초록을 만든다). 이 파일이 재는 것은 **원본**이다.
// 🛑 조각 분해는 **다시 짜지 않고** `activate-core.js` 의 `bodyOfPiece` 를 불러 쓴다.
//    검사가 자기 나름의 분해를 만들면 "내가 뽑은 중간 결과를 기준 삼은 검사"가 되어 조용한 유실을
//    못 잡는다(이 저장소가 이미 데인 자리 - test/rule-pieces.test.mjs 머리말 참조).
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const core = require("../src/hooks/activate-core.js");

const RULES = readFileSync(join(SRC, "rules", "operating-rules.md"), "utf8");
const ROUTING = readFileSync(join(SRC, "skills", "routing", "SKILL.md"), "utf8");

// 라우팅 표를 **행 단위로** 집는 자리. 조건 칸의 한 조각으로 그 줄을 찾아 온다.
// 한 번만 쪼개는 이유 = 같은 분해를 여러 벌 들고 있으면 나중에 한 벌만 고쳐져 칸마다 다른 것을
// 재게 된다(아래 4·5번이 같은 표를 본다).
const ROUTING_LINES = ROUTING.split("\n");
// 🛑 표 앞에 같은 낱말(`deep-implementer`·안전 바닥·fail-safe)을 쓰는 되짚기 주석이 있다
//    (표 바로 위, HTML 주석 `<!-- -->`). `startsWith("|")` 없이 파일 전체를 훑으면, 다음
//    개정이 그 주석에 조건 문구까지 적을 때 표 대신 주석 줄을 집어 온다 - 그러면 표의
//    담당 일꾼을 값싼 일꾼으로 내려도, 이 함수는 여전히 주석 속 `deep-implementer` 를
//    돌려줘 있음 단언도 없음 단언도 둘 다 통과한다(재검수 medium).
const routingRow = (condition) => ROUTING_LINES.find((l) => l.trim().startsWith("|") && l.includes(condition));

// 한 `##` 절 안의 번호 항목(`1. `·`2. `…)만 뽑는다. 개수를 주석에 손으로 적지 않으려고 두는
// 자리다 - 손으로 적은 수는 절이 자라도 아무도 안 고쳐서 조용히 낡는다(이 파일에서 실제로 두 번).
function numberedItems(heading) {
  const start = ROUTING_LINES.findIndex((l) => l.trim() === heading);
  assert.ok(start >= 0, `라우팅 스킬에서 절 제목을 못 찾았다: ${heading}`);
  const rest = ROUTING_LINES.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => /^[0-9]+\. /.test(l));
}

// 조건 칸으로 행을 찾고, 찾은 그 행 안에서 **이름표**까지 확인한다.
// 두 자리(안전 바닥 · fail-safe)가 같은 실패 문장을 두 벌로 갖고 있어 한 벌만 고쳐지는 길이
// 열려 있었다 - 한 곳으로 모은다.
function rowWithLabel(condition, label) {
  const row = routingRow(condition);
  assert.ok(row,
    `${label} 행의 조건 문구가 라우팅 표에서 사라졌다 - 위 주석의 \`${label} 행\`이 어느 행인지 ` +
    "더 이상 찾을 수 없다");
  assert.ok(row.includes(label),
    `이름이 바뀌어 위 주석이 가리키는 행을 못 찾게 됐다 - \`${label}\`: ${row}`);
  return row;
}

// ── 1. 규칙 두 줄이 코어에 글자 그대로 있다 ────────────────────────────────────
// A줄은 의무가 셋이라(작업방 · 견줄 기준 · 환경) 조각마다 따로 잰다. 한 조각만 앵커하면
// 나머지를 지우면서 앵커 조각만 남기는 길이 열린다.
const A_LINE_PARTS = [
  "**Delegated implementation always runs in its own worktree**",
  'Agent(isolation: "worktree")',
  // 🛑 blocker 처방(무인 예외). 이게 빠지면 무인 세션이 `.claude/` 아래에 방을 만들려다
  //    경로 가드에 막히고, B줄이 방 밖 편집도 막아 **양쪽이 다 막힌 교착**이 된다.
  "unattended sessions are exempt",
  // 견줄 기준. 일꾼이 커밋까지 하므로 맨 `diff` 는 빈 결과이고, 그때 게이트는 실패가 아니라
  //   통과로 끝난다. 이 조각이 빠지면 게이트가 조용히 합격 도장을 찍는다.
  "git -C <path> diff <base>...HEAD",
  // 커밋 안 한 것을 보는 짝. `bare diff is empty` 만 있으면 "맨 diff 는 볼 필요 없다"로 굳어,
  //   일꾼이 BLOCKED 로 멈춰 커밋을 못 한 판을 "아직 아무것도 안 했군요"로 읽는다.
  "uncommitted work still shows in `status`",
  // 🛑 이 판이 "왜 스킬이 아니라 코어인가"를 답하며 든 **유일한 근거**다. 그런데 앵커가 없어서,
  //   다음 개정이 A줄을 줄이면서 이 한 문장만 빼도 전 검사가 초록이었다(재리뷰 medium).
  "before that worktree has its env and deps",
  // 🛑 합쳐 넣기(재리뷰 high). 이 조각이 없으면 방 안에서 고치고 diff 까지 확인해 놓고
  //   "고쳤습니다"로 끝나는데 **사용자의 파일은 그대로다.** 라우팅 스킬이 안 열린 턴에도
  //   도착해야 막히므로 코어에 둔다.
  "Nothing counts as done until main merges that branch back into the main line",
  // 방을 못 만드는 두 원인은 처방이 다르다. 하나로 묶으면 도구 오류에도 `git init` 을 권한다.
  "not a git repo: propose `git init` first",
  "tool error: report that and delegate without a worktree",
];
const B_LINE_PARTS = [
  "**Main never edits product code inline**",
  // 제품 코드의 범위. 넓게 읽으면 계획서·문서까지 위임 대상이 된다.
  "product code = app · library · test sources",
  // 🛑 3회차 F-8: 앞 조각만 두면 **이 저장소 자신이 예외로 샌다.** 여기 제품은 마크다운
  //   규칙·스킬·에이전트 파일이라, 곧이곧대로 읽으면 `src/rules/*.md` 는 메인이 인라인으로
  //   고쳐도 되는 것이 된다. 이 판의 목적 자체가 새는 자리라 뒤 조각을 따로 앵커한다.
  "where the product ships as documents, those shipped files too",
  // 저장소 살림 파일 예외. 없으면 상황판 첫 설치 절차(메인이 `info/exclude` 에 한 줄 넣는 것)가
  //   B줄과 정면으로 부딪힌다.
  "repo housekeeping files (ignore lists, settings)",
];

test("코어에 위임 A줄·B줄이 글자 그대로 있다", () => {
  for (const s of [...A_LINE_PARTS, ...B_LINE_PARTS])
    assert.ok(RULES.includes(s), `operating-rules.md 에 누락: ${s}`);
});

// ── 2. 두 줄이 **같은 조각**으로 도착한다 ──────────────────────────────────────
// 🛑 이 판의 핵심 단언이다. 코어는 최상위 제목마다 잘려 조각으로 주입되고 조각은 도착 순서가
//    섞이며 서로를 대체하지 않는다. 두 줄이 갈라지면 "작업방에서 굴려라"만 도착하고
//    "메인이 직접 고치지 마라"는 안 도착하는 턴이 생기는데, 그 조합이 정확히 규칙이
//    무력화되는 조합이다(작업방도 안 쓰고 메인이 그냥 고치는 것과 결과가 같다).
test("위임 A줄·B줄이 같은 조각(3번)에 함께 실린다", () => {
  const piece3 = core.bodyOfPiece(RULES, 3);
  assert.ok(piece3.length > 0, "조각 3이 비어 있다 - 조각 표가 깨졌다");
  for (const s of [...A_LINE_PARTS, ...B_LINE_PARTS]) {
    assert.ok(piece3.includes(s),
      `조각 3 밖으로 나갔다: ${s}\n` +
      "두 줄은 반드시 같은 `#` 절 안에 있어야 한다. 갈라지면 한 줄만 도착하는 턴이 생기고, " +
      "그 조합이 규칙이 무력화되는 조합이다.");
  }
  // 조각 상한(activate-core.PIECE_MAX_CHARS)에 붙지 않는지도 함께 본다. 넘으면 CLI 가
  // 조각을 파일로 밀어내 앞부분만 모델에 닿는다(이 저장소의 v0.64.1 사고).
  assert.ok(piece3.length <= core.PIECE_MAX_CHARS,
    `조각 3 이 ${piece3.length}자로 상한 ${core.PIECE_MAX_CHARS}자를 넘었다`);
});

// ── 3. 라우팅 절차의 핵심 구절 ────────────────────────────────────────────────
// 성공 기준 2: 에이전트 파일만이 아니라 **라우팅 절도 채점한다.** 이 칸이 없으면 라우팅 절이
//   통째로 빠져도 나머지 기준이 전부 충족으로 채점된다.
// 🛑 항목 수를 여기 손으로 적지 않는다. 적으면 절이 자라는 동안 **조용히 낡는다** - 이 줄은
//    실제로 `여덟 항목`이라 적힌 채 열 항목이 됐고, 아래 합치기 주석도 `아홉 단계`에서 멈춰
//    있었다. 개수를 세는 일은 이 파일 맨 아래 "작업방 절의 항목 수" 칸(기계)이 맡는다.
const ROUTING_WORKTREE_PARTS = [
  "## 작업방에서 굴린다",
  // 견줄 기준(`...HEAD`). 이 판의 blocker 처방이 실제로 적힌 자리다.
  "git -C <작업방> diff <본가지>...HEAD",
  // 아직 커밋 안 한 것을 보는 짝. 하나만 있으면 반쪽만 본다.
  "git -C <작업방> status --porcelain",
  // 무인 예외(코어 A줄과 같은 말). 한쪽만 고치면 갈라진다.
  "무인 세션은 방을 만들지 않는다",
  // 작업방을 못 만드는 판의 갈래(성공 기준 3-2). 원인 둘은 **처방이 다르다**(재리뷰 low):
  //   도구 오류에 `git init` 은 답이 아니고, 모노레포 하위 폴더의 `git init` 은 중첩 `.git` 을
  //   만들어 그 하위 트리를 부모 추적에서 조용히 떼어낸다. 그래서 갈래마다 따로 앵커한다.
  "작업방을 못 만드는 판은 원인이 둘이고 처방이 다르다",
  "모노레포 하위 폴더에서는 제안하지 않는다",
  "도구 오류면 `git init` 은 답이 아니다",
  // `.env` 는 cp 로만. Read/Write 로 옮기면 가려진 글자가 그대로 적혀 파일이 조용히 망가지고,
  //   그 파일로 띄운 서버의 "구동 검증 통과"가 거짓 초록이 된다.
  "`cp` 로만 옮긴다",
  // 링크 건 작업방에서 설치 금지. 링크는 본 폴더 설치물과 같은 하나라 여기서 설치하면
  //   본 폴더와 다른 모든 작업방이 동시에 바뀐다.
  "`npm install`·`npm ci` 를 돌리지 않는다",
  // 계획서는 본 폴더 절대경로. 작업방에 `docs/` 가 없을 수 있다.
  "계획서는 본 폴더 절대경로로 넘긴다",
  // 방 세기의 문턱. 없으면 "세기만 한다"가 아무것도 안 하는 것과 같아진다.
  "**8개** 또는 대략 **2GB**",
  // 옛 방도 같은 목록에. 없으면 지난 판이 남긴 방이 어느 절차에도 안 잡혀 영원히 남는다.
  "이번 판과 무관한 옛 방도 같은 목록에 넣는다",
  // 지우기는 remove 로만, --force 금지.
  "`git worktree remove`",
  "**`--force` 는 쓰지 않는다.**",
  // 방 경로가 git 무시 대상인지 확인. 안 하면 본 폴더의 git status·Grep 에 방 사본이 섞이고
  //   `git add -A` 가 빈 칸 하나를 커밋에 넣는다. **순서**가 핵심이라 그 조각까지 잰다:
  //   방부터 만들면 오염이 이미 일어난 뒤다.
  "확인 전에는 방을 만들지 않는다",
  // 🛑 합쳐 넣기(재리뷰 high). 라우팅 층의 짝이다. 이 항이 없으면 앞 단계가 전부 방 안에서
  //   끝나고 사용자의 파일에는 아무것도 안 닿는다. 정리 절차 10항 (가)·(나)가 "합치기가 이미
  //   일어났다"를 전제하는데, 그 합치기를 누가 언제 하라는 문장이 어디에도 없었다.
  "메인이 작업방 가지를 본 가지로 합친다",
  "git -C <본 폴더> merge <작업방 가지>",
  // 🛑 3회차 F-5: **가장 파괴적인 두 줄**인데 그물 밖이었다(1회차 medium 과 같은 모양이 한 칸
  //   옆에서 반복됐다). 앞엣것이 빠지면 **커밋이 든 방을 먼저 지우는** 순서가 열리고,
  //   뒤엣것이 빠지면 **안 합쳐진 방을 지우는** 길이 열린다. 둘 다 되돌릴 수 없는 자리다.
  "먼저 합치고, 그다음 10번에서 지운다",
  "합치기가 성공한 것을 눈으로 확인한 방이 대상이다",
  // 3회차 F-1: 합친 뒤 아무도 다시 안 돌리면, 완료 근거가 **옛 코드의 초록**으로 남는다.
  "합친 뒤 본 폴더에서 검사·빌드를 한 번 돌리고 그 결과를 완료 근거로 쓴다",
  // 3회차 F-2: 충돌 푸는 일은 제품 코드를 손으로 고치는 일이라 B줄과 부딪힌다. 갈래가 없으면
  //   일꾼(방 안에만 산다)도 감독(`git` 이 없다)도 못 해서 판이 그 자리에서 선다.
  "충돌이 나면 메인이 푼다",
  "푼 뒤에는 게이트를 다시 돌린다",
  // 3회차 F-4: 방은 그때그때 본 가지에서 갈라지는데 합치기는 판 끝에 한 번이라, 뒤 태스크에
  //   새 방을 만들면 앞 결과가 그 방에 없다(앞이 규칙을 고치고 뒤가 빌드하면 옛 규칙으로 빌드).
  "앞 위임의 결과 위에 쌓는 태스크는 같은 방·같은 가지에 이어서 위임한다",
  // 3회차 F-3: 검증 실패를 그 방으로 돌려보낼 길. 없으면 메인이 고쳐 B줄을 어기거나
  //   새 방이 생겨 원래 가지와 갈라진다.
  "검증에서 고칠 것이 나오면 같은 작업방·같은 가지로 다시 위임한다",
  // 3회차 F-12: 8항 순서의 **진짜** 근거. 약한 근거("흐려진다")만 남으면 다음 개정이 순서를
  //   뒤집는다(1회차가 실제로 그 방향을 권고했다).
  "검증 전에 합치면 안 본 코드가 이미 사용자 파일에 들어가 있어",
  '합치기 전에는 "고쳤습니다"로 끝내지 않는다',
  // 합치는 주체. 일꾼·게이트가 합치면 검토 없이 본 가지가 바뀐다.
  "합치는 것은 메인이다",
  // 🛑 이 판이 코어에 둔 근거의 라우팅 짝(재리뷰 medium). 앵커가 없어 어떤 검사도 안 쟀다.
  "구동 검증도 작업방에서 한다",
  // 6번(재검수 medium). 앵커가 없으면 개수 칸(아래 WORKTREE_SECTION_ITEMS)은 문구가 통째로
  //   바뀌거나 물러져도 개수만 그대로면 초록이다 - "완료 보고에 경로·브랜치를 함께 받는다"가
  //   "가능하면 받는다"로 물러져도 잡아내지 못한다.
  "완료 보고에 **작업방 경로와 브랜치**를 함께 받는다",
];

test("라우팅 스킬에 작업방 절차의 핵심 구절이 살아 있다", () => {
  for (const s of ROUTING_WORKTREE_PARTS)
    assert.ok(ROUTING.includes(s), `routing/SKILL.md 에 누락: ${s}`);
});

// 🛑 위 목록은 **문구**를 하나씩 앵커한다. 그래서 문구가 하나도 안 걸린 항목이 생기면 그 항목은
//    통째로 사라져도 위 칸이 초록이다(이 판 전까지는 6번 `완료 보고에 작업방 경로와 브랜치를
//    함께 받는다` 가 그런 자리였다). 개수를 세는 칸을 따로 두어 **항목 수가 줄어드는 것**을 잡는다.
// ⚠ 항목을 늘리거나 줄이면 이 칸이 빨개진다. 그때 먼저 고칠 것은 이 숫자가 아니라 **위 앵커
//    목록**이다: 새 항목의 핵심 문구를 거기 넣고, 그다음 이 숫자를 옮긴다. 숫자만 고치면
//    앵커 없는 항목이 한 칸 더 늘 뿐이다.
// 🛑 이 칸은 **순 개수 변화**만 잡는다(사라짐 자체를 잡는 것이 아니다). 항목이 다른 문장으로
//    갈아 끼워지거나 조건이 물러져도 개수가 그대로면 이 칸은 초록이다 - 내용이 바뀌는 것은
//    위 앵커 목록의 몫이다(재검수 medium).
const WORKTREE_SECTION_ITEMS = 10;

test("라우팅 '작업방에서 굴린다' 절의 항목 수가 그대로다", () => {
  const items = numberedItems("## 작업방에서 굴린다");
  assert.equal(items.length, WORKTREE_SECTION_ITEMS,
    `'작업방에서 굴린다' 절의 번호 항목이 ${WORKTREE_SECTION_ITEMS}개에서 ${items.length}개로 바뀌었다 - ` +
    "줄었으면 절차 한 칸이 사라진 것이고(위 앵커 목록이 안 잡는 항목이 있다), " +
    `늘었으면 새 항목이 앵커 없이 들어온 것이다:\n${items.map((l) => l.slice(0, 40)).join("\n")}`);
});

// 🛑 라우팅은 **위임 직전**에 열리고 구동 검증은 여러 턴 뒤다. 그 시점에 실제로 열리는 것은
//    run-verify 인데 거기엔 폴더 이야기가 한 글자도 없었다(재리뷰 low). 경고가 라우팅에만 있으면
//    정작 띄우는 순간에는 아무도 안 읽는다 - 그러면 본 폴더에서 **아직 안 고친 코드**를 검증하고
//    초록을 받는다. 합치기 전이라 본 폴더에는 옛 코드가 있다는 것이 이 사고의 전부다.
test("run-verify 가 '위임으로 고친 것이면 그 작업방에서 띄운다'를 갖고 있다", () => {
  const runVerify = readFileSync(join(SRC, "skills", "run-verify", "SKILL.md"), "utf8");
  for (const s of ["위임으로 고친 것이면 그 작업방에서 띄운다", "아직 안 고친 코드",
                   // 3회차 F-3 의 포인터. 이 스킬 4번이 "고쳐서 다시 돌린다"를 전제하는데,
                   //   누가 어디서 고치는지가 없으면 메인이 그 자리에서 고쳐 B줄을 어긴다.
                   "같은 작업방·같은 가지로 다시 위임한다"])
    assert.ok(runVerify.includes(s), `run-verify/SKILL.md 에 누락: ${s}`);
});

// ── 4. 짝 두 자리를 **양방향으로** 잰다 ───────────────────────────────────────
// 🛑 부재만 재면 한쪽을 아무 말로나 고쳐도 초록이고, 존재만 재면 옛 문장이 나란히 남아
//    읽는 쪽이 둘 중 편한 쪽을 고른다. 그래서 옛 문자열의 **부재**와 새 문구의 **존재**를
//    한 검사 안에서 함께 잰다.
test("짝 1: 코어 '자잘한 수정' 줄이 인라인에서 위임으로 바뀌었다(양방향)", () => {
  assert.ok(!/Simple targeted fixes:\*\* proceed directly/.test(RULES),
    "옛 문구 `Simple targeted fixes:** proceed directly` 가 코어에 남았다 - " +
    "B줄과 정면으로 부딪혀 읽는 쪽이 편한 쪽을 고른다");
  assert.ok(RULES.includes("the edit itself is still delegated"),
    "새 문구가 코어에 없다 - '짧은 수정에 스펙·계획을 안 붙인다'는 남기고 " +
    "'메인이 직접 고친다'만 빼는 것이 이 줄의 목적이다");
});

test("짝 2: 라우팅 표에서 인라인 행이 사라지고 크기 하한 없음 행이 그 부류를 흡수했다(양방향)", () => {
  assert.ok(!ROUTING.includes("인라인 즉시"),
    "옛 표 행 `인라인 즉시` 가 라우팅 표에 남았다 - 코어 B줄과 부딪힌다");
  assert.ok(!ROUTING.includes("실행 방식(인라인/서브에이전트/병렬)"),
    "축 정의에 인라인이 남았다 - 표에서 인라인 행을 없앴으므로 정의만 남고 갈 곳이 없다");
  assert.ok(ROUTING.includes("코드 편집에는 인라인 칸이 없다"),
    "인라인이 어디에 남는지(계획서·문서·상황판·메모리·살림 파일) 적은 조각이 없다");
  // 🛑 GO 조건 1(F-1): 바꾸는 것은 **크기 조건 하나뿐**이다. 통짜 catch-all 로 갈면
  //    안전 바닥 행(보안·판단 → deep-implementer)·fail-safe 행(애매 → fail-safe)과 정면으로 부딪히는데,
  //    안전 tie-break 는 산문 세 겹뿐이라 기계가 되돌려 주지 않는다. 그래서 `보안·판단 무관`
  //    조건이 **그 행 안에** 남아 있는지를 같은 줄에서 잰다(파일 어디엔가 있는 것으로는 부족하다).
  // 위 두 문단이 쓰는 행 이름(안전 바닥 행 · fail-safe 행)이 실제로 표에 있는지를 기계로 잰다.
  // 조건 칸으로 그 줄을 먼저 찾고, 찾은 그 줄 안에서 이름까지 확인한다(부재 확인만으로는
  // 부족하다 - 이름은 오른쪽 칸에 있어서, 조건 칸만 재면 이름이 조용히 바뀌어도 초록이 된다).
  rowWithLabel("보안·판단·권한·동시성·아키텍처·애매·복잡", "안전 바닥");
  rowWithLabel("독립성·명확성·안전성이 애매", "fail-safe");
  const row = routingRow("크기 하한 없음(한두 줄도 여기)");
  assert.ok(row, "라우팅 표('GO 후 자동 결정')의 code-implementer 단일 행에 새 크기 조건 " +
    "`크기 하한 없음(한두 줄도 여기)` 이 없다");
  assert.ok(row.includes("보안·판단 무관"),
    `크기 하한 없음 행에서 \`보안·판단 무관\` 조건이 사라졌다 - 그 행이 catch-all 이 되어 ` +
    `보안·판단 걸린 일이 Sonnet 으로 샌다: ${row}`);
  assert.ok(row.includes("code-implementer"),
    `크기 하한 없음 행이 \`code-implementer\` 를 안 가리킨다: ${row}`);
  // H-2: `스폰 비용보다 이득일 때` 단서가 남으면 한두 줄짜리 수정이 그 조건에 안 맞아서
  //   읽는 쪽이 "그럼 이건 이 행이 아니다"로 판단해 **없앤 인라인 경로를 스스로 되살린다.**
  assert.ok(!ROUTING.includes("스폰 비용보다 이득일 때"),
    "옛 단서 `스폰 비용보다 이득일 때` 가 남았다 - 한두 줄짜리는 그 조건에 대체로 안 맞아 " +
    "읽는 쪽이 없앤 인라인 경로를 스스로 되살린다");
  // 🛑 이 칸만 파일 전체를 훑고 있었다. 그러면 이 단서가 **다른 절로 새어 나가도** 초록이라,
  //    정작 읽는 쪽이 이 행에 서 있을 때는 되돌리지 말라는 말이 안 보인다. 위 칸들과 잣대를
  //    맞춰 이미 잡아 둔 `row` 안에서 잰다.
  assert.ok(row.includes("인라인으로 되돌리지 않는다"),
    `되돌리지 말라는 단서가 이 행에 없다 - 없는 절차는 읽는 쪽이 스스로 만들어 낸다: ${row}`);
});

// ── 5. 안전이 걸린 두 행과 값싼 두 행이 **담당 일꾼**을 그대로 가리킨다 ─────────
// 나머지 두 행(여러 파일 통합·디버깅 · 여러 바퀴 supervisor)은 안 잰다 - 앞 행 괄호는 `독립성·명확성·안전성이 애매` 행과 `코어의 안전 tie-break가 이 표보다 항상 우선한다` 산문이 이미 덮는다.
// 🛑 이 파일에서 가장 값나가는 칸이다. 위 4번은 행의 **이름표**(`안전 바닥`·`fail-safe`)까지만
//    쟀는데, 이름표는 괄호 안 설명에 있어서 **담당 일꾼 이름을 갈아 끼워도 그대로 남는다.**
//    다음 판이 비용을 아끼려 안전 바닥 행의 `deep-implementer` 를 `code-implementer` 로 바꿔도
//    `안전 바닥: 절대 Sonnet 아님` 이라는 이름표가 남아 검사가 **전부 초록**이었다.
//    그러면 **보안·권한·동시성 걸린 일이 값싼 일꾼으로 샌다.** 산문 세 겹(코어 안전 tie-break ·
//    표 아래 문단 · 에이전트 설명)이 전부 이 표를 근거로 삼는데, 기계는 아무도 이 칸을 안 봤다.
// 🛑 값싼 두 행도 함께 못박는 이유 = **맞바꾸기**를 잡으려는 것이다. 안전 행만 재면 두 행의
//    일꾼을 서로 바꿔치기했을 때 한 칸만 빨개지는데, 양쪽을 다 재면 두 칸이 함께 빨개져
//    무슨 일이 일어났는지가 실패 보고에 그대로 드러난다.
const ROW_WORKERS = [
  ["보안·판단·권한·동시성·아키텍처·애매·복잡", "deep-implementer", "안전 바닥"],
  ["독립성·명확성·안전성이 애매", "deep-implementer", "fail-safe"],
  ["2개+ 독립·파일 분리", "Sonnet", "기계적·병렬"],
  ["크기 하한 없음(한두 줄도 여기)", "code-implementer", "기계적·단일"],
];

test("라우팅 표의 안전이 걸린 두 행과 값싼 두 행이 담당 일꾼을 그대로 가리킨다", () => {
  for (const [condition, worker, name] of ROW_WORKERS) {
    const row = routingRow(condition);
    assert.ok(row,
      `${name} 행을 조건 문구로 못 찾았다 - 표에서 사라졌거나 조건 칸이 바뀌었다: ${condition}`);
    assert.ok(row.includes(worker),
      `${name} 행이 담당 일꾼 \`${worker}\` 를 안 가리킨다. 이름표(괄호 안 설명)는 그대로 남으니 ` +
      `그것만 보고 지나가면 안 된다 - 이 칸이 바뀌면 그 부류의 일이 통째로 다른 등급으로 간다: ${row}`);
  }
  // 🛑 갈아 끼우기만 잡으면 **덧붙이기**가 남는다: `deep-implementer 또는 code-implementer` 로
  //    적으면 위 단언은 통과하는데 읽는 쪽에는 값싼 길이 그대로 열린다. 그래서 안전이 걸린
  //    행에서는 값싼 일꾼 이름의 **부재**까지 함께 잰다(이 파일 4번의 양방향 규율과 같은 축).
  //    ⚠ 안전 행을 "`code-implementer` 로 내려 부르지 않는다" 같은 부정 문장으로 고쳐 쓰면 이
  //    칸이 빨개진다. 그때는 문장을 바꾸지 말고 이 단언을 먼저 다시 설계해라.
  for (const [condition, worker, name] of ROW_WORKERS) {
    if (worker !== "deep-implementer") continue;
    assert.ok(!routingRow(condition).includes("code-implementer"),
      `${name} 행에 값싼 일꾼 \`code-implementer\` 가 함께 적혔다 - 안전이 걸린 행에 값싼 길을 ` +
      `나란히 두면 읽는 쪽이 편한 쪽을 고른다: ${routingRow(condition)}`);
  }
});
