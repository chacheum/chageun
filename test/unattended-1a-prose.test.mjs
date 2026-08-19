import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 🛑 이 검사를 느슨하게 고치려면 계획서에 적고 사람 승인을 받는다.
//
// 무엇을 재나: 무인 모드 문서 여섯 자리 사이에 있던 **모순 수리**가 그대로 남아 있는지.
// 1a 판(2026-08-19)은 규칙을 푸는 문장을 한 줄도 안 넣고 조이는 방향만 했다. 그 방향이
// 다음 판에서 조용히 뒤집히지 않게 붙든다.
// 무는 방식: **핵심 낱말로 좁혀서** 문다. 문장 전체를 물면 2판이 문구를 다듬는 순간
// 빨개지고, 그때 제일 싼 처방이 "검사를 고치는 것"이 된다.
// 이 검사가 못 재는 것(정직 고지): 밤이 이 문장을 **실제로 따르는지**는 못 문다. 산문끼리의
// 충돌을 없앤 것까지가 이 판의 범위이고, 기계 그물은 1b·2판 몫이다.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (...p) => readFileSync(join(ROOT, ...p), "utf8");

const SKILL = rd("src", "skills", "unattended-loop", "SKILL.md");
const APX = rd("src", "rules", "unattended-appendix.md");
const CI = rd("src", "agents", "code-implementer.md");
const DI = rd("src", "agents", "deep-implementer.md");
const PV = rd("src", "agents", "plan-validator.md");
const PR = rd("src", "agents", "pr-reviewer.md");

// 한 줄만 떼어 보는 자(문단 안에 낱말이 있나를 문서 전체가 아니라 **그 줄에서** 판정한다).
function lineWith(text, needle) {
  const hits = text.split("\n").filter((l) => l.includes(needle));
  assert.equal(hits.length, 1, `"${needle}" 를 담은 줄이 ${hits.length}개 (1개여야 함)`);
  return hits[0];
}
const count = (text, needle) => text.split(needle).length - 1;

// ── A-1 · B-1 · C: 설치를 두 갈래로 가른다 (부품 복원 = 허용 · 새 설치 = park) ──────
test("1a A-1: 절차서가 설치를 두 갈래로 가른다", () => {
  assert.ok(SKILL.includes("부품 복원"), "절차서에 '부품 복원' 갈래 부재");
  assert.ok(SKILL.includes("npm ci"), "부품 복원의 범위를 좁히는 예(`npm ci`) 부재 - 되돌리기형 삭제까지 덮인다");
  assert.ok(SKILL.includes("새로 들어오는 설치는 스스로 멈춘다(park)"), "새 설치 park 부재");
  assert.ok(SKILL.includes("훅은 이것을 안 막는다"), "훅이 안 막는다는 정직 고지 부재(기계는 반대 방향을 지킨다)");
  assert.ok(!SKILL.includes("설치·localhost 검증은 자유롭게"), "옛 통짜 허용 문구가 남아 있다");
});

test("1a B-1: 부록도 설치를 두 갈래로 가른다", () => {
  assert.ok(APX.includes("부품 복원·localhost DB쓰기는 격리 덕에 허용"), "부록 부품 복원 갈래 부재");
  assert.ok(APX.includes("새로 들어오는 설치는 스스로 멈춘다(park)"), "부록 새 설치 park 부재");
  assert.ok(!APX.includes("설치·localhost DB쓰기는 격리 덕에 허용"), "부록에 옛 통짜 허용 문구가 남아 있다");
});

test("1a C-1·C-2: 구현자 둘이 같은 두 갈래를 적는다", () => {
  for (const [name, txt] of [["code-implementer", CI], ["deep-implementer", DI]]) {
    assert.ok(txt.includes("새로 들어오는 설치"), `${name}: 설치가 통짜로 남아 있다`);
    assert.ok(txt.includes("부품 복원은 여기 해당하지 않는다(허용)"), `${name}: 부품 복원 허용 조각 부재`);
  }
  // 거짓 조각만 지우고 뒤 조각은 남긴다(과삭제 방지).
  assert.ok(!CI.includes("안전 훅이 이미 기계로 막지만"), "code-implementer: 거짓 조각이 남아 있다(설치는 차단 사유가 아예 없다)");
  assert.ok(CI.includes("헛발질로 시간을 태우지 않도록"), "code-implementer: 뒤 조각까지 지워졌다(과삭제)");
  assert.ok(!DI.includes("안전 훅이 이미 기계로 막지만"), "deep-implementer: 거짓 조각이 옮겨 왔다");
});

// ── 검수 후속(2026-08-19): 열거를 다시 열고, 표식을 구현자에게도 준다 ──────────────
test("검수 1: 구현자 둘의 무인 금지 열거가 '삭제' 를 갖고 목록이 다시 열려 있다", () => {
  // 🛑 이 판이 유일하게 규칙을 푼 자리였다. 끝이 열린 금지가 닫힌 여섯 개가 되면서 '삭제' 가
  //    빠졌는데, 절차서 `:51` 은 '삭제' 를 갖고 있어 두 문서가 다른 것을 금지하게 됐다.
  for (const [name, txt] of [["code-implementer", CI], ["deep-implementer", DI]]) {
    const l = lineWith(txt, "무인 모드(사람 자리 비움) 특칙");
    assert.ok(l.includes("**삭제**"), `${name}: 금지 열거에서 '삭제' 가 빠졌다(절차서 :51 과 어긋난다)`);
    // 닫힌 목록은 "여기 없으니 해도 된다"로 읽힌다 - 그것이 이 판이 막으려던 병이다.
    assert.ok(l.includes("그 밖에도 되돌리기 비싼 것은 전부 마찬가지다"),
      `${name}: 열거가 닫힌 목록으로 남아 목록 밖이 허용으로 읽힌다`);
  }
  // 절차서 쪽 열거도 '삭제' 를 그대로 갖고 있어야 두 문서가 같은 것을 금지한다.
  assert.ok(SKILL.includes("되돌리기 비싼 것(push·배포·운영 DB 쓰기·삭제·외부 전송)"),
    "절차서 열거에서 '삭제' 가 빠졌다");
});

test("검수 4: 같은 관용구가 두 파일에서 반대 뜻으로 읽히지 않는다", () => {
  // 구현자 쪽 "부품 복원은 여기 해당하지 않는다(허용)" = 금지 목록 밖 = **해도 된다**.
  // 절차서 쪽 "... 생성물 지우기는 여기 해당하지 않는다" = 부품 복원이 아니다 = **하면 안 된다**.
  // 같은 낱말이 반대 뜻이라, 절차서 쪽 "여기" 의 **대상을 못박는다**. 뜻은 그대로이고
  // 오독 경로만 닫힌다(2026-08-19 검수 지적).
  assert.ok(SKILL.includes("생성물 지우기는 부품 복원에 해당하지 않는다"),
    "절차서: '여기' 가 무엇을 가리키는지 안 박혔다");
  assert.ok(!SKILL.includes("생성물 지우기는 여기 해당하지 않는다"),
    "절차서에 뜻이 갈리는 '여기' 가 되살아났다");
  // 구현자 쪽은 일부러 그대로 둔다(그쪽 "여기" 는 금지 열거를 가리켜 뜻이 갈리지 않는다).
  assert.ok(CI.includes("부품 복원은 여기 해당하지 않는다(허용)"), "구현자 쪽 허용 조각이 사라졌다");
});

test("검수 2: 표식을 넣는 쪽과 읽는 쪽의 조건이 같다", () => {
  // 넣는 쪽(절차서)은 "첫 줄**에** 넣는다"라 그 줄에 다른 글자가 더 있어도 된다.
  // 읽는 쪽이 "첫 줄이 **정확히** 그것뿐"이면, 밤에 재리뷰 회차를 같은 줄에 적는 순간
  // 표식이 안 먹어 헛멈춤이 난다(2026-08-19 검수 지적). 느슨하게 푸는 것이 아니라
  // 넣는 쪽 문장과 맞추는 것이다.
  assert.ok(SKILL.includes("호출 프롬프트 첫 줄에 `무인 세션: 예` 를 넣는다"),
    "넣는 쪽 문장이 바뀌었다 - 읽는 쪽 네 파일도 함께 고쳐야 한다");
  const readers = [["plan-validator", PV, 2], ["pr-reviewer", PR, 2],
                   ["code-implementer", CI, 1], ["deep-implementer", DI, 1]];
  for (const [name, txt, n] of readers) {
    assert.equal(count(txt, "첫 줄이 `무인 세션: 예` 로 시작하면"), n,
      `${name}: 읽는 쪽 조건이 넣는 쪽과 같은 문장이어야 한다(${n}자리)`);
    assert.ok(!txt.includes("첫 줄이 정확히"),
      `${name}: '정확히' 라는 좁은 조건이 남아 헛멈춤이 난다`);
  }
});

test("검수 3: 구현자 둘이 무인 표식 글자를 직접 갖는다", () => {
  // 절차서는 "이 표식이 구현자의 무인 특칙을 켠다"고 선언하는데, 정작 구현자 파일에 그 글자가
  // 없으면 구현자는 자기가 무인인지 알 길이 없다. 산문으로만 적은 조건은 이 저장소에서 세 번 다
  // 발동하지 않았다.
  for (const [name, txt] of [["code-implementer", CI], ["deep-implementer", DI]]) {
    assert.ok(txt.includes("무인 세션: 예"), `${name}: 표식 글자가 한 번도 안 나온다`);
    assert.ok(lineWith(txt, "무인 모드(사람 자리 비움) 특칙").includes("로 시작하면 무인이다"),
      `${name}: 표식이 특칙 줄에 붙어 있지 않아 발동 조건이 안 걸린다`);
  }
});

// ── A-2~A-8 · B-2: 큐와 '이어서 재개' 약속을 문서에서 전수로 걷어냈다 ──────────────
test("1a A-2~A-8: 절차서에 큐가 한 글자도 없다", () => {
  assert.ok(!SKILL.includes("queue.md"), "절차서에 queue.md 가 남아 있다(런처가 큐를 방으로 안 옮긴다)");
  assert.ok(!SKILL.includes("큐"), "절차서에 '큐' 낱말이 남아 있다");
  assert.ok(SKILL.includes("한 번에 한 가지 일만"), "'한 번에 한 가지' 로 좁힌 문장 부재");
  // 🛑 앵커를 "안 하는 것" 으로 두면 아무것도 안 문다 - 그 낱말은 **원래부터 있던**
  //    할일 카드 설명("할일 카드: 왜·무엇·범위·안 하는 것")에도 있어서, 새로 넣은 문장을
  //    통째로 지워도 초록이었다. 새 문장에만 있는 낱말로 바꿨다(2026-08-19 검수 지적).
  assert.ok(SKILL.includes("다음 밤으로 넘긴다"), "여러 일을 말했을 때 나머지를 넘길 자리(카드의 '안 하는 것' → 다음 밤) 부재");
});

test("1a A-5 · B-2: '재개' 약속이 절차서·부록 어디에도 없다", () => {
  assert.ok(!SKILL.includes("재개"), "절차서에 '재개' 약속이 남아 있다(어떤 경로로도 발동하지 않는다)");
  assert.ok(!APX.includes("재개"), "부록에 '재개' 약속이 남아 있다");
  assert.ok(SKILL.includes("자동으로 이어지지 않는다"), "절차서: 이어지지 않는다는 대체 문장 부재");
  assert.ok(APX.includes("자동으로 이어지지 않고"), "부록: 이어지지 않는다는 대체 문장 부재");
});

test("1a A-5 · B-2: 안전 한도·예산 시계 문장은 글자 그대로 남는다", () => {
  assert.ok(SKILL.includes("시간(8시간)·작업량(2000번)·헛돎(30분 무진전)"), "절차서 한도 셋이 바뀌었다");
  assert.ok(SKILL.includes("예산(시간·작업량)으로 park되면 Write 도구도 막히므로"), "절차서 예산 문장이 바뀌었다");
  assert.ok(APX.includes("**8시간·2000번·30분 무진전**"), "부록 한도 셋이 바뀌었다");
  assert.ok(APX.includes("예산 시계는 껐다 켜도 리셋되지 않으며(재시작 우회 불가), 새 무인 시작(`chageun-unattended`) 때만 0에서 시작한다."),
    "부록 예산 시계 문장이 바뀌었다");
  assert.ok(!APX.includes("queue.md"), "부록에 queue.md 가 남아 있다");
  assert.ok(!APX.includes("큐"), "부록에 '큐' 낱말이 남아 있다");
});

test("1a A-7: 사람 의도 갈래는 FINISH 인수인계에 남긴다(새 낱말을 늘리지 않는다)", () => {
  const l = lineWith(SKILL, "국소=진행, 구조·성공기준·안전=멈춤(코어와 동일)");
  assert.ok(l.includes("FINISH 인수인계"), "가정 규칙 줄이 FINISH 인수인계를 안 가리킨다");
  assert.ok(!l.includes("큐"), "가정 규칙 줄에 큐가 남아 있다");
  assert.ok(!l.includes("대기표"), "가정 규칙 줄에 '대기표' 라는 겹말이 새로 들어왔다");
});

// ── A-9 · B-3: 민감면이 무엇보다 먼저 (뒷가지로 조용히 풀지 않는다) ────────────────
test("1a A-9: 절차서에 민감면 우선이 있고, 그 줄에 '일꾼' 이 없다", () => {
  const l = lineWith(SKILL, "민감면이 무엇보다 먼저다");
  assert.ok(l.includes("park 이 먼저다"), "park 이 먼저라는 판정 부재");
  assert.ok(l.includes("헷갈리면 민감면으로 보고 park"), "애매할 때의 타이브레이커 부재");
  // 🛑 "그 밖에서만 다른 일꾼을 고른다" 같은 뒷가지는 이 판이 조이려는 것을 조용히 푼다.
  assert.ok(!l.includes("일꾼"), "민감면 줄에 '일꾼' 뒷가지가 붙어 park 우선이 풀렸다");
});

test("1a B-3: 부록에도 민감면이 먼저", () => {
  const l = lineWith(APX, "민감면이 먼저");
  assert.ok(l.includes("park 이 먼저다"), "부록: park 이 먼저라는 판정 부재");
  assert.ok(l.includes("헷갈리면 민감면으로 본다"), "부록: 타이브레이커 부재");
});

// ── A-10: park 하면 사유를 커밋 하나로 ────────────────────────────────────────────
test("1a A-10: park 사유 커밋 - 담는 것 셋이 정해져 있다", () => {
  const l = lineWith(SKILL, "park 하면 그 사유를 커밋 하나로 남긴다");
  assert.ok(l.includes("빈 커밋"), "변경이 없을 때 무엇을 담나가 안 정해졌다");
  assert.ok(l.includes("미완"), "완료 커밋과 눈으로 구별할 제목 표식 부재");
  assert.ok(l.includes("적지 않는다"), "커밋 메시지에 안 적을 것(주소·절대경로·접속 정보) 부재");
  assert.ok(l.includes("이 커밋도 못 찍는다"), "예산으로 죽은 밤은 못 남긴다는 한계 고지 부재");
});

// ── A-11 · D-1~D-4: 무인 표식이 일곱 자리에 글자까지 같다 ──────────────────────────
test("1a 표식 `무인 세션: 예` 가 일곱 자리에 있다(절차서 3 · 심판 2+2)", () => {
  assert.equal(count(SKILL, "무인 세션: 예"), 3, "절차서 세 자리(계획심판·구현·코드심판)에 표식이 있어야 한다");
  assert.equal(count(PV, "무인 세션: 예"), 2, "plan-validator 두 자리(도구 제한 절 · 메모리 절)");
  assert.equal(count(PR, "무인 세션: 예"), 2, "pr-reviewer 두 자리(도구 제한 절 · 메모리 절)");
});

test("1a D-1~D-4: 심판 무인 예외에 '표식 없으면 평소대로' 가 함께 있다", () => {
  for (const [name, txt] of [["plan-validator", PV], ["pr-reviewer", PR]]) {
    assert.equal(count(txt, "무인 세션 예외"), 2, `${name}: 한 자리만 고치면 뒤쪽의 조건 없는 지시가 살아 있다`);
    // 🛑 이것이 없으면 표식 없는 **낮 세션의 기억장까지** 꺼진다(앞 초안의 실패).
    assert.equal(count(txt, "그 줄이 없으면 평소대로 쓴다"), 2, `${name}: '표식 없으면 평소대로' 가 빠졌다`);
  }
});
