import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 게이트 에이전트 본문에서 **안전 판정 문구가 조용히 사라지는 것**을 막는다.
// 각 마커 옆 주석은 "이 문구가 없으면 무엇이 무너지는가"다 — 지우려면 그 근거부터 반박해야 한다.
// (v0.49.0에 두 벌 대조 테스트에서 갈라져 나왔다 — 대조는 사라졌지만 존재검사는 단독으로 유효하다.)
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const prReviewer = readFileSync(join(SRC, "agents", "pr-reviewer.md"), "utf8");
const planValidator = readFileSync(join(SRC, "agents", "plan-validator.md"), "utf8");
const codeImplementer = readFileSync(join(SRC, "agents", "code-implementer.md"), "utf8");
const deepImplementer = readFileSync(join(SRC, "agents", "deep-implementer.md"), "utf8");

const PR_MARKERS = [
  "medium만 있고",              // APPROVE 조건 단서(사용자 동의)
  "사용자가 알고 진행 가능",     // 안전 단서 — 실제로 한 번 빠졌던 자리
  "비전문가 요약에 반드시 명시", // APPROVE라도 명시
  "폴백",                        // git 아닐 때 종료 금지
  "git init",                    // 되돌리기 싸게 제안
  "신뢰 경계 밖",                // Fable5 F2: 메모리 주입 차단(검토 대상의 자칭 FP 기록 금지)이 조용히 지워지는 것 방어
  "git ls-files --others --exclude-standard", // H3: untracked 신규파일 검수(빈 diff→검수0 방지)
  "비용 폭주",                   // 백로그 D: pr-reviewer 비용 폭주 점검이 조용히 지워지는 것 방어
  "1위 사고",                    // 백로그 D: 커밋된 시크릿(바이브코딩 1위 사고) 점검이 조용히 지워지는 것 방어
  "❌인데 APPROVE로 어긋나지 않게", // P4 F1/F2: 성공기준 ❌→verdict 배선(대조표 ❌인데 APPROVE 방지)이 조용히 지워지는 것 방어
  "재리뷰(재실행)로 해소",        // P4 F4: BLOCK/REQUEST CHANGES 수정 후 재리뷰 강제가 조용히 지워지는 것 방어
  "진짜/가짜 판단을 하지 않는다", // G7: .env 값이 가짜로 보여도 인용 금지(anti-rationalization)가 조용히 지워지는 것 방어
  "애매하면 붙이지 않는다",      // v0.40.0: [정리] 태그의 안전판(오태그 시 사용자 눈에서 사라짐)이 조용히 지워지는 것 방어
  "앞머리를 붙이지",             // v0.41.0: git 읽기 하나만(cd·echo·2>/dev/null 금지) 안내가 조용히 지워지는 것 방어
  "`재리뷰 회차: N` 옆에 적힌",  // v0.48.0: 회차 마커 + 지난 회차 지적의 **출처** 지목. 실효 앵커는 이 긴 쪽이다 —
                                 // 짧은 `재리뷰 회차: N`은 이 문자열의 부분집합이라 긴 쪽이 남는 한 항상 통과한다
  "재리뷰 회차: N",              // v0.48.0: 쓰기-읽기 접점(가독용 · 위 긴 앵커가 실효)
  "모든 리뷰를 세고 최초 리뷰가 1차", // v0.48.0: 계수 기준
  "검토 대상 기능이 바뀌면 1차", // v0.48.0 오탐 방지: 카운터 범위. 없으면 한 브랜치에 쌓인 다른 작업의
                                 // 첫 리뷰에도 "3차 · 매회 새 지적"이 붙는다
  "같은 지적의 반복이면 표시를 붙이지 않는다", // v0.48.0 오탐 방지: 수렴 중인 루프에 매번 경고가 붙는 것을 막는다
  "3차 도달이 blocker를 면제하지", // v0.48.0 안전-핵심(회차 표시가 blocker 면제로 읽히는 것 차단).
                                 // ⚠파일 전체 검사라 pr-reviewer 절 통째 삭제는 이 앵커만으론 못 잡는다 —
                                 // 실효 방어는 gate-round-marker.test.mjs의 슬라이스 단언이다
];
const PV_MARKERS = [
  "🙋",                          // 스펙 확인 게이트 대리결정 목록
  "대리결정",                    // AI interpolation 교차검증
  "추측",                        // plan 경로 추측 금지
  "신뢰 경계 밖",                // Fable5 F2: 메모리 주입 차단이 조용히 지워지는 것 방어
  "구조·범위를 바꿀",            // 🙋 우선순위 severity 잣대(#6a)
  "안전·권한·데이터 노출·삭제 방식 결정은 구조·범위급으로 취급", // #6a 안전-핵심: 안전 🙋 강등 금지 절이 조용히 지워지는 것 방어(pr-reviewer low)
  "위임 구역",                   // #6b 위임 구역 예외 topic
  "예외를 무효화하고 high/blocker", // #6b 안전-핵심: 위임 구역 방패절이 조용히 지워지는 것 방어(plan-validator HIGH-2)
  "판단 불가·기계적임이 확인된 항목에 한해서만", // #6b 안전-핵심: 위임 구역 예외 제한절이 조용히 넓어지는 것 방어(pr-reviewer low)
  "비용/외부 발송/외부 부하를 좌우하는 결정", // Fable5 F3: 위임 구역 무효화 렌즈의 비용축이 조용히 지워지는 것 방어
  "❌인데 GO로 어긋나지 않게",   // P4 F2: plan-validator 성공기준 ❌→verdict 배선이 조용히 지워지는 것 방어
  "판정에 안 실린 우려 없음",     // P4 F3: 자유서술 우려→findings·판정 배선 불변식이 조용히 지워지는 것 방어
  // v0.42 F-13: 새로 넣은 두 규칙에도 앵커를 건다. 앵커 없이 양쪽에 넣기만 하면 다음 개정 때
  // 한쪽만 고쳐져도 이 테스트가 통과해 미러 표류를 기계가 못 잡는다(이 저장소 단골).
  "3차 이상이고",                 // 2번: 재검증 수렴·알림 규칙의 발동 회차
  "개정 로그 절 개수로 추정",     // 2번: 회차 파악의 한 경로(프롬프트에 회차가 없어도 동작해야 함)
  "모든 검증을 세고 최초 검증이", // v0.46.0: 회차 계수 기준(코어 쓰기 규칙과 한 칸 어긋나면 문턱이 밀린다)
  "알 수 없으면 새 것으로 보고 표시를 붙인다", // v0.46.0 핵심: 모를 때 침묵하면 규칙이 영영 안 켜진다(기본값 반전)
  "매회 새 지적",                 // v0.46.0: 판정 줄 회차 표시 문자열 자체
  "같은 blocker의 반복이면 표시를 붙이지 않는다", // v0.46.0: 수렴 중인 루프에 오탐 표시가 붙는 것 차단
  "3차 도달이 blocker를 면제하지", // v0.46.0 안전-핵심: 회차 표시가 blocker 면제로 읽히는 것 차단
  "그것만을 이유로 판정을 올리지", // v0.46.0 과잉차단 방지: 이 절이 지워지면 회차 표시만으로 판정이
                                  // 밀려 올라가 수렴한 계획이 다시 멈춘다(pr-reviewer medium)
  "medium finding으로",           // v0.46.0: 에스컬레이션 강도가 한쪽에서만 약해지는 표류 방어.
                                  // (Claude는 `**...으로** 올린다`라 굵게 표시가 중간에 끼어 "올린다"까지 못 묶는다)
                                  // "medium 이상"이 아니라 "medium"인 이유: catch-all의 low~medium 상한과
                                  // 같은 항목이라, "이상"으로 두면 high가 열려 판정이 밀려 올라간다
  "low~medium으로만",             // v0.46.0: 회차 finding이 high로 달려 수렴한 계획을 다시 멈추는 것 차단
  "`재검증 회차: N` 옆에 적힌",   // v0.47.0: 지난 회차 지적의 출처. 지워지면 오탐 가드가 자기 데이터에
                                  // 못 닿아 같은 지적의 반복도 "새 지적"으로 읽힌다
  "얕게 본 부분을 명시",          // 4번: 계획 규모 가드의 정직 고지절(조용한 축소 금지)
  "진행을 실제로 막는 문턱은 3,000줄", // v0.53.0: 보고 문턱(400)과 하드 차단 문턱(3,000)이 다른
                                  // 이유를 적어 둔 자리. 지워지면 다음 사람이 "숫자가 어긋났다"며
                                  // 400을 3,000으로 올리고, 그 순간 부풀림 축이 그 사이 구간에서 죽는다
  "실행하면 바로 아는 값",        // v0.53.0: 종이 위 확정 대신 실행으로 확정하라는 축. 실패 건의
                                  // 막는 지적 다수가 이 부류였다(명령 한 번이면 몇 분에 끝나는 값)
  "부풀림만으로는 별도 finding을 만들지 않는다", // v0.50.0 핵심: 이 단서만 빠지면 분량 축이 상시 발동
                                  // 잔소리로 뒤집혀, 계획자가 그 지적에 답하는 절을 덧붙이는 되먹임을
                                  // 규칙이 직접 먹인다(막으려던 것을 정반대로 한다)
  // 주어까지 통째로 잡는다: 술어("덜어내기 대상이 아니다")만 앵커하면 앞토막을 다른 대상으로
  // 바꿔치기해도 초록이라, 무엇을 보호하는지가 기계 밖에 남는다(pr-reviewer 2차 low).
  "개정 로그·`재검증 회차: N` 머리는 회차 계수와 지난 지적의 출처라 덜어내기 대상이 아니다",
                                  // v0.50.0 안전-핵심: 이 예외가 지워지면 게이트가 개정 로그를
                                  // "중복 요약"으로 보고 지우라고 권해, 회차 계수 소스 하나가 사라진다
  "애매하면 붙이지 않는다",      // v0.40.0: [정리] 태그의 안전판이 조용히 지워지는 것 방어
];
const CI_MARKERS = [ // code-implementer(감사 지적: 마커 0개 → 표류 못잡음)
  "판단이 중요한 결정",          // 보안·권한·동시성 결정은 직접 처리 말고 에스컬레이션
  "받아쓰지 말고 BLOCKED",       // 백로그 D: 민감면에 안전 결정 빠지면 받아쓰기 금지, 한쪽만 지워지는 표류 방어
  "push 하지 않는다",            // v0.64.0: push 는 메인 전용. 지워지면 서브가 시간을 태우고 우회를 찾는다
  "push 전에 메인 세션이 게이트를 다시 돌린다", // v0.64.0 H-2: 위임분은 메인 기록에 안 남아
                                 // 신선도가 스스로 안 깨진다. 이 줄이 유일한 방어라 지우면 검사 안 받은
                                 // 코드가 검사 도장을 달고 나간다
];

test("pr-reviewer 핵심 판정 문구가 살아 있다", () => {
  for (const m of PR_MARKERS) {
    assert.ok(prReviewer.includes(m), `pr-reviewer.md에 누락: ${m}`);
  }
});

test("plan-validator 핵심 항목이 살아 있다", () => {
  for (const m of PV_MARKERS) {
    assert.ok(planValidator.includes(m), `plan-validator.md에 누락: ${m}`);
  }
});

test("code-implementer 핵심 안전 문구가 살아 있다", () => {
  for (const m of CI_MARKERS) {
    assert.ok(codeImplementer.includes(m), `code-implementer.md에 누락: ${m}`);
  }
});

const routingSkill = readFileSync(join(SRC, "skills", "routing", "SKILL.md"), "utf8");
// :18 은 한 줄에 문장이 넷 붙어 있다. 그중 하나만 고치다 줄을 통째로 갈면 나머지가 조용히 사라지는데,
// routing 스킬 본문을 지키는 검사가 이 저장소에 하나도 없었다(v0.64.0 이 이 줄을 고치며 발견).
const ROUTING_MARKERS = [
  "그래서 일꾼 등급으로 내려 부르지 않는다",   // 게이트 모델 바닥. 빠지면 심판이 일꾼 등급으로 내려간다
  "최종 리뷰는 인라인이 아니라 위의 pr-reviewer 게이트다", // 인라인 자기검토가 게이트를 대신하는 것 방어
  "`code-implementer`(**Sonnet** 고정)",       // 기계적 구현의 등급 고정
  // v0.64.0: 이 두 줄은 **문서끼리 어긋났던 자리**다(라우팅은 중첩 스폰을 허용한다고 적고,
  // deep-implementer 계약은 금지한다고 적었다). 한쪽만 고치면 다시 갈라지므로 앵커로 못 박는다.
  "중첩 스폰은 안 한다",                        // 게이트 스폰 기계 차단과 같은 방향(텍스트가 더 넓다)
  "위임 중인 파일은 메인이 인라인으로 건드리지 않는다", // 같은 파일 동시 수정 = 한쪽 편집이 조용히 덮임
];
test("routing '누가 무엇을 맡나' 절의 안전 문장이 살아 있다", () => {
  for (const m of ROUTING_MARKERS)
    assert.ok(routingSkill.includes(m), `routing/SKILL.md에 누락: ${m}`);
});

// 서브에이전트 `description` 은 나중에 사용자 화면에 그대로 뜨는 **이름**이라 짧아야 한다.
// 길면 잘려서 무슨 일이 도는지 안 보인다(실측: `계획서…` · `P…`). 이 줄이 지워지면
// 다시 개발자용 식별자처럼 길게 짓게 된다.
test("routing 에 서브에이전트 이름(description) 길이 규칙이 살아 있다", () => {
  assert.ok(routingSkill.includes("한국어 15자 안쪽"),
    "routing/SKILL.md에 누락: description 길이 규칙(한국어 15자 안쪽)");
});

// deep-implementer 는 **판단 걸린 일**을 뒤에서 맡는다. 그래서 code-implementer 와 달리
// "혼자 정하지 않는다"가 존재 이유이고, 아래 여섯 줄이 그 계약의 전부다.
const DI_MARKERS = [
  "model: opus",                       // 최상위 고정. 이게 이 에이전트의 존재 이유다
  "BLOCKED",                           // 결정 지점에서 멈추는 계약
  "혼자 정하지 않는다",                  // 판단을 대신 내리지 않는다
  "게이트를 직접 부르지 않는다",           // 만든 쪽이 자기 검사 범위를 고르지 못하게
  "push 하지 않는다",                    // push 는 메인 전용
  "push 전에 메인 세션이 게이트를 다시 돌린다", // 위임분은 메인 기록에 안 남아 신선도가
                                         // 스스로 안 깨진다. 이 줄이 유일한 방어다
  "같은 파일을 동시에 건드릴 위험",          // v0.64.0: 백그라운드 동시 편집 경고. code-implementer 에만
                                         // 있고 여기 빠져 있었다 — 뒤에서 여럿 돌 때 한쪽 편집이 조용히 덮인다
];

test("deep-implementer 핵심 안전 문구가 살아 있다", () => {
  for (const m of DI_MARKERS)
    assert.ok(deepImplementer.includes(m), `deep-implementer.md에 누락: ${m}`);
});

// 다이어트 가드: 하네스가 자동 주입하는 메모리 설명서 중복이 되돌아오지 않게 한다.
test("에이전트 파일에 하네스-중복 '# Persistent Agent Memory' 섹션이 없다", () => {
  for (const [name, txt] of [["plan-validator", planValidator], ["pr-reviewer", prReviewer]]) {
    assert.ok(!txt.includes("# Persistent Agent Memory"),
      `${name}.md에 하네스 자동주입과 중복되는 메모리 설명서가 다시 들어옴`);
    // 에이전트 고유의 '무엇을 기록할지' 안내 문단은 남아 있어야 한다.
    assert.ok(txt.includes("Update your agent memory"),
      `${name}.md에서 메모리 기록 안내 문단이 사라짐(과삭제)`);
  }
});
