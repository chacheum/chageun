// 상황판 스킬 본문이 실제로 든 것을 앵커로 잡는다(정확 워딩이 아니라 조각).
// 왜 앵커인가: 문장은 다듬어도 되지만 **절차 한 단계가 통째로 사라지는 것**은 잡아야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(ROOT, "src", "skills", "statusboard", "SKILL.md"), "utf8");
const TEMPLATE = readFileSync(join(ROOT, "src", "skills", "statusboard", "board.template.md"), "utf8");

const ANCHORS = [
  "지금 하실 것",             // 칸 이름(1)
  "지금 뒤에서 도는 것",       // 칸 이름(2)
  "§1에서 지운다",             // 이게 빠지면 끝난 일이 영원히 남는다
  "x-chageun-board",          // 사다리 2단 판정(남의 서버 오인 방지)
  "board.json",               // 사다리가 포트를 파일에서 읽는다(8095 하드코딩 방지)
  "깔라고 요구하지",           // 남에게 설치를 요구하지 않는다
  "비밀번호·열쇠 값·고객 정보",   // 쓰는 쪽 방어선(.env 밖 값은 기계가 못 잡는다)
  "check-ignore -q status.md",  // 중복 방지 + 재확인 (앞에 `git -C <상황판 폴더>` 가 붙는다)
  "git rm --cached",          // 이미 추적 중일 때의 유일한 처방
  "--path-format=absolute",   // 하위 폴더에서 무시 줄이 엉뚱한 자리에 들어가는 것 방지
  "check-ignore -q status.md` 를 한 번 더",  // 재확인 뒤에만 통보한다
  "이미 있을 때",              // 두 번째 입구(이 절이 통째로 빠지는 것을 잡는다)
  "`Write` 도구로",            // Bash 리다이렉션으로 만들면 하드 차단 둘이 통째로 비켜 간다
  "chageun:auto",             // §2 경계 표시
  "기계가 쓰는 칸",             // 그 절이 통째로 빠지는 것을 잡는다
  "표시 두 벌",                // `## 이미 있을 때` 의 마이그레이션 단계
  "지나간 판은 접는다",         // 길이 관리 절이 통째로 빠지는 것을 잡는다
  "지우지 말고 옮긴다",         // 접기가 '삭제'로 굳으면 왜 그렇게 했는지가 사라진다
];

test("SKILL.md 에 절차 앵커가 전부 있다", () => {
  for (const a of ANCHORS) assert.ok(SKILL.includes(a), "앵커 누락: " + a);
});

// ⚠ 위 두 앵커에서 `git ` 접두사를 뺀 이유: 명령이 `git -C <상황판 폴더> check-ignore …` 로
//   바뀌었다(상황판이 켠 폴더가 아니라 몇 단 위일 수 있다). 붙여 두면 그 정당한 변경에
//   빨개지고, 고치는 사람이 앵커를 지워 버리기 쉽다.
// ⚠ `"한 번 더"` 만으로는 아무것도 안 잡는다 — 본문 어디에나 나올 수 있는 세 글자다.
//   위 앵커는 `check-ignore` 와 붙은 조각이라 재확인 단계를 지우면 빨개진다.

test("무시 목록을 어디에 넣는지가 두 앵커로 굳어 있다", () => {
  assert.ok(SKILL.includes("info/exclude"), "info/exclude 가 없다");
  assert.ok(SKILL.includes("`.gitignore` 가 아니다"), "고른 쪽을 못 박는 문장이 없다");
});

// 공개 배포물이라 옛 이름과 이 사용자 호칭이 새면 안 된다.
const OLD_NAME = ["상황판", ".md"].join("");   // 옛 파일 이름(리터럴을 검사 안에서만 조립)
const HONORIFIC = "사장님";

test("옛 이름이 어디에도 없다", () => {
  const targets = [
    ["skills/statusboard/SKILL.md", SKILL],
    ["skills/statusboard/board.template.md", TEMPLATE],
  ];
  for (const [label, text] of targets) assert.ok(!text.includes(OLD_NAME), "옛 이름이 남음: " + label);
});

test("사용자 호칭이 어디에도 없다", () => {
  assert.ok(!SKILL.includes(HONORIFIC), "SKILL.md 에 호칭이 남음");
  assert.ok(!TEMPLATE.includes(HONORIFIC), "board.template.md 에 호칭이 남음");
});

test("본보기에 경계 표시 두 벌이 있고 손으로 적는 시각 줄이 없다", () => {
  for (const m of ["<!-- chageun:auto -->", "<!-- /chageun:auto -->",
    "<!-- chageun:auto:head -->", "<!-- /chageun:auto:head -->"])
    assert.ok(TEMPLATE.includes(m), "본보기에 표시 누락: " + m);
  // 부제 줄(제목 다음 인용 줄)에 시각이 있으면 새로 만드는 상황판마다 낡을 줄을 심는 것이다.
  const subtitle = TEMPLATE.split("\n").find((l) => l.startsWith("> ")) || "";
  assert.ok(!/20\d\d-\d\d-\d\d/.test(subtitle), "부제 줄에 손으로 적는 시각이 있다: " + subtitle);
});
