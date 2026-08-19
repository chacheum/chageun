import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// `chageun:planning` 은 걷어낸 `brainstorming` 자리를 대신 받는다. 그 스킬이 강제하던 금지문·상한이
// 이제 이 파일 안에만 있어, 여기서 한 문장이 조용히 빠지면 대체하는 그물이 저장소에 하나도 없다.
// 각 앵커 옆 주석은 "이 문구가 없으면 무엇이 무너지는가"다 — 지우려면 그 근거부터 반박해야 한다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(ROOT, "src", "skills", "planning", "SKILL.md"), "utf8");

const ANCHORS = [
  "`EnterPlanMode`",                    // 0번: 합의 전 파일 변경을 **기계로** 막는 자리.
                                        // 빠지면 이 스킬은 말로 하는 다짐만 남는다
  "너무 크면 먼저 쪼갠다",               // 2번: 큰 요청의 세부부터 다듬어 통째로 버리는 것 방어
  "🙋 판정은 `chageun:spec-gate`",       // 🙋 정의를 여기서 다시 쓰지 않는다(단일 원본 유지).
                                        // 빠지면 상한 4개가 두 곳에서 갈라진다
  "계획서도 스펙과 같이 낸다",            // 계획서에는 3층 규칙이 안 걸려 있다. 이 줄이 없으면
                                        // 비개발자가 못 읽는 문서를 승인한다
  "기획 대화가 끝나기 전에 코드로 넘어가지 않는다", // M7: 걷어낸 스킬의 금지문 중 비개발자에게
                                        // 가장 중요한 것의 대체물
  "`Plan` 에이전트가 없는 판이면 메인이 최상위 모델로 계획서를 직접 쓴다", // F2: 내장 에이전트는
                                        // "설치/활성"이 불가능하다. 폴백이 없으면 흐름이 그 자리에서 멈춘다
                                        // (형제 자리 = routing/SKILL.md, test/agent-anchors.test.mjs 가 지킨다)
  "작업 단위(Task N + Files + 단계)",     // F7: plan-validator 가 "구현 단위로 분해되지 않았음"을
                                        // 그 자체로 blocker 라 선언한다
  "`- [ ]`",                            // F7: 체크박스가 없으면 pretooluse 의 체크박스 완충이 안 걸린다
  '"확인 방법"으로도 가른다',            // 2번 두 번째 축: 쪼개는 잣대가 **크기**만 남으면
                                        // 400줄에 못 미치는 작은 계획서라도 확인 방법이 다른 축 둘을
                                        // 담은 채 그대로 통과한다(실측 2026-08-19: 그 판이 세 회차
                                        // 연속 NO-GO 였고 매회 지적이 직전에 고친 자리 옆에서 났다)
];

test("planning 스킬에 절차·안전 앵커가 존재(삭제 회귀 바닥)", () => {
  for (const a of ANCHORS) assert.ok(skill.includes(a), `src planning SKILL.md에 누락: ${a}`);
});

// 🛑 0번과 6번은 **서로 어긋났던 자리**다: 0번이 모드 안에서 하는 일을 "읽기·검색·질문·선택지"로만
//    적어 두고, 바로 다음 줄이 그 안에서 스펙 파일을 쓰라고 했다. 고친 모양의 핵심은 둘이다.
//    (가) 회복로: 쓰기가 막힐 때 갈 길을 미리 정해 둔다. 빠지면 막힌 자리에서 즉흥 대응이 나온다.
//    (나) 순서: 어느 갈래로 가든 확인 게이트(🙋)가 마지막이다. 빠지면 사용자가 스펙 없이 승인한다.
//    모드 안 쓰기가 되는 것은 봤지만 표본이 1대 1회(권한 확인을 끈 컴퓨터)라, 회복로를 지운 근거로
//    "되니까 필요 없다"를 쓸 수 없다. **그 표본 이야기는 스킬 본문에 두지 않고 이 주석에 둔다** -
//    본문은 기획 대화마다 로드되는 자리라, 거기에는 행동을 바꾸는 조건("권한 확인을 켠 환경에서는
//    막힐 수 있다")만 남긴다.
const RECOVERY = "모드가 스펙 파일 쓰기를 막으면 그 자리에서 `ExitPlanMode` 승인을 먼저 받고 쓴다";
const GATE_LAST = "어느 갈래로 가든 확인 게이트(🙋)는 스펙 파일이 있는 상태에서 마지막에 돈다";
// 🛑 (나) 는 스펙 파일이 **없는 상태**에서 `ExitPlanMode` 승인을 받는다. 그 요청에 무엇을 담는지가
//    없으면 사용자는 정리된 내용을 못 본 채 도장을 찍고, 그 순간 편집 잠금이 풀린다. 그래서 담을 것
//    (합의한 절 요약)과 승인의 범위(스펙 파일 쓰기까지 · 구현 승인이 아니다)를 둘 다 못 박는다.
const APPROVAL_SHOWS = "합의한 절 요약(한눈에 초안)";
const APPROVAL_SCOPE = "이 승인이 스펙 파일 쓰기까지";
// 🛑 `ExitPlanMode` 는 사용자가 **거절할 수 있는** 요청이다. 거절 뒤 갈 곳이 문서에 없으면 같은 승인을
//    다시 내밀어 사용자를 압박하거나, 0번이 금지한 즉흥 대응으로 간다(6번은 "갈래는 둘뿐"이라 닫혀 있다).
const REJECTED = "5번(절 단위 합의)으로 돌아간다";

test("planning 0번·6번에 스펙 쓰기 회복로와 '확인 게이트가 마지막'이 둘 다 있다", () => {
  const section = (head) => {
    const i = skill.indexOf(head);
    assert.notEqual(i, -1, `절 제목이 사라졌다: ${head}`);
    const j = skill.indexOf("\n## ", i + 1);
    return skill.slice(i, j === -1 ? undefined : j);
  };
  const zero = section("## 0. 계획 모드로 들어간다");
  const six = section("## 6. 스펙 파일로 적는다");
  assert.ok(zero.includes(RECOVERY), `0번에 회복로 문장이 없다: ${RECOVERY}`);
  assert.ok(six.includes(RECOVERY), `6번에 회복로 문장이 없다(두 갈래가 한쪽만 남았다): ${RECOVERY}`);
  assert.ok(six.includes(GATE_LAST), `6번에 게이트 순서 문장이 없다: ${GATE_LAST}`);
  assert.ok(zero.includes("읽기·검색·질문·선택지 제시, 그리고 6번의 스펙 파일 쓰기"),
    "0번의 '모드 안에서 하는 것' 목록에서 스펙 파일 쓰기가 빠졌다(6번과 다시 어긋난다)");
  assert.ok(six.includes(APPROVAL_SHOWS),
    `6번 (나)에 승인 요청에 담을 것이 없다(사용자가 못 보고 도장을 찍는다): ${APPROVAL_SHOWS}`);
  assert.ok(six.includes(APPROVAL_SCOPE),
    `6번 (나)에 승인 범위(스펙 파일 쓰기까지)가 없다: ${APPROVAL_SCOPE}`);
  assert.ok(six.includes(REJECTED),
    `6번에 승인이 거절됐을 때 갈 곳이 없다(같은 승인을 다시 내밀게 된다): ${REJECTED}`);
  // 위 REJECTED 는 절 번호로 가리킨다. 5번 제목이 바뀌거나 절이 옮겨지면 없는 자리를 가리키게 된다.
  assert.ok(skill.includes("## 5. 절 단위로 합의"),
    "5번 절 제목이 바뀌었다 - 6번의 '5번(절 단위 합의)으로 돌아간다'가 없는 자리를 가리킨다");
});

// 과발동 방지 조건이 프론트매터에 있어야 한다. 없으면 오타 한 글자 수정에도 기획 대화가 열린다.
test("planning 프론트매터에 과발동 방지 조건이 있다", () => {
  const fm = skill.slice(0, skill.indexOf("\n---", 4));
  assert.ok(fm.includes("발동하지 않는다"),
    "planning 프론트매터에 '발동하지 않는다'(과발동 방지) 조건이 없다");
});

// 사용자 전역 표기 규칙: 긴 줄표 금지(— – ― ㅡ). 스킬 본문은 사용자가 읽는 글이 아니지만,
// 이 문투가 그대로 답변에 복제된다.
test("planning 본문에 긴 줄표가 0개", () => {
  const hits = skill.match(/[—–―ㅡ]/g) || [];
  assert.equal(hits.length, 0, `긴 줄표 ${hits.length}개 발견: ${hits.join(" ")}`);
});
