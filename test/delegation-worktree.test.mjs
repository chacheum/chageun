import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// 작업방 위임 규칙(v0.68.0)의 그물.
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
  // 작업방을 못 만드는 판의 갈래(성공 기준 3-2). 없으면 비-git 프로젝트에서 A줄이 위임을 막고
  //   B줄이 인라인을 막아 코드 작업이 통째로 선다.
  "Cannot create one (not a git repo · tool error)",
];
const B_LINE_PARTS = [
  "**Main never edits product code inline**",
  // 제품 코드의 범위. 넓게 읽으면 계획서·문서까지 위임 대상이 된다.
  "product code = app · library · test sources",
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
// 성공 기준 2: 에이전트 파일만이 아니라 **라우팅 절도 채점한다.** 이 칸이 없으면 라우팅 절
//   여덟 항목이 통째로 빠져도 나머지 기준이 전부 충족으로 채점된다.
const ROUTING_WORKTREE_PARTS = [
  "## 작업방에서 굴린다",
  // 견줄 기준(`...HEAD`). 이 판의 blocker 처방이 실제로 적힌 자리다.
  "git -C <작업방> diff <본가지>...HEAD",
  // 아직 커밋 안 한 것을 보는 짝. 하나만 있으면 반쪽만 본다.
  "git -C <작업방> status --porcelain",
  // 무인 예외(코어 A줄과 같은 말). 한쪽만 고치면 갈라진다.
  "무인 세션은 방을 만들지 않는다",
  // 작업방을 못 만드는 판의 갈래(성공 기준 3-2).
  "작업방을 못 만드는 판(git 저장소가 아님 · 도구 오류)",
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
  // 방 경로가 git 무시 대상인지 확인. 안 하면 본 폴더의 git status·Grep 에 방 사본이 섞인다.
  "git 무시 대상인지 한 번 확인한다",
];

test("라우팅 스킬에 작업방 절차의 핵심 구절이 살아 있다", () => {
  for (const s of ROUTING_WORKTREE_PARTS)
    assert.ok(ROUTING.includes(s), `routing/SKILL.md 에 누락: ${s}`);
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

test("짝 2: 라우팅 표에서 인라인 행이 사라지고 34행이 그 부류를 흡수했다(양방향)", () => {
  assert.ok(!ROUTING.includes("인라인 즉시"),
    "옛 표 행 `인라인 즉시` 가 라우팅 표에 남았다 - 코어 B줄과 부딪힌다");
  assert.ok(!ROUTING.includes("실행 방식(인라인/서브에이전트/병렬)"),
    "축 정의에 인라인이 남았다 - 표에서 인라인 행을 없앴으므로 정의만 남고 갈 곳이 없다");
  assert.ok(ROUTING.includes("코드 편집에는 인라인 칸이 없다"),
    "인라인이 어디에 남는지(계획서·문서·상황판·메모리·살림 파일) 적은 조각이 없다");
  // 🛑 GO 조건 1(F-1): 바꾸는 것은 **크기 조건 하나뿐**이다. 통짜 catch-all 로 갈면
  //    32행(보안·판단 → deep-implementer)·37행(애매 → fail-safe)과 정면으로 부딪히는데,
  //    안전 tie-break 는 산문 세 겹뿐이라 기계가 되돌려 주지 않는다. 그래서 `보안·판단 무관`
  //    조건이 **그 행 안에** 남아 있는지를 같은 줄에서 잰다(파일 어디엔가 있는 것으로는 부족하다).
  const row = ROUTING.split("\n").find((l) => l.includes("크기 하한 없음(한두 줄도 여기)"));
  assert.ok(row, "34행에 새 크기 조건 `크기 하한 없음(한두 줄도 여기)` 이 없다");
  assert.ok(row.includes("보안·판단 무관"),
    `34행에서 \`보안·판단 무관\` 조건이 사라졌다 - 그 행이 catch-all 이 되어 ` +
    `보안·판단 걸린 일이 Sonnet 으로 샌다: ${row}`);
  assert.ok(row.includes("code-implementer"),
    `34행이 \`code-implementer\` 를 안 가리킨다: ${row}`);
  // H-2: `스폰 비용보다 이득일 때` 단서가 남으면 한두 줄짜리 수정이 그 조건에 안 맞아서
  //   읽는 쪽이 "그럼 이건 이 행이 아니다"로 판단해 **없앤 인라인 경로를 스스로 되살린다.**
  assert.ok(!ROUTING.includes("스폰 비용보다 이득일 때"),
    "옛 단서 `스폰 비용보다 이득일 때` 가 남았다 - 한두 줄짜리는 그 조건에 대체로 안 맞아 " +
    "읽는 쪽이 없앤 인라인 경로를 스스로 되살린다");
  assert.ok(ROUTING.includes("인라인으로 되돌리지 않는다"),
    "되돌리지 말라는 단서가 없다 - 없는 절차는 읽는 쪽이 스스로 만들어 낸다");
});
