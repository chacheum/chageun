import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// `chageun:test-design` 은 걷어낸 `test-driven-development` 자리를 대신 받는다. 코어 '작업 유형별
// 진행'은 포인터 문투(`load ... via the Skill tool`)를 **안 쓰기로** 했으므로(강제 호출은 그 본문을
// 매번 대화에 실어 이 판의 목적과 반대다), 이 스킬 본문을 지키는 그물은 이 파일뿐이다.
// 각 앵커 옆 주석은 "이 문구가 없으면 무엇이 무너지는가"다 - 지우려면 그 근거부터 반박해야 한다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(ROOT, "src", "skills", "test-design", "SKILL.md"), "utf8");
const notice = readFileSync(join(ROOT, "src", "skills", "test-design", "NOTICE"), "utf8");

const ANCHORS = [
  "이 테스트가 잡는 고장의 이름을 먼저 댄다", // 이 스킬의 입구(J1). 빠지면 "짜 두면 좋은 검사"가 절차 안이 된다
  "기대값을 코드로 계산하지 않는다",         // 거울 검사(J2). 이 저장소가 실제로 당한 사고의 처방이다
  "변경 감지기",                            // J3. 일부러 바꿀 때 울고 진짜 고장에는 자는 검사
  "먼저 돌려서 빨간 것을 본다",              // P3. 이 걸음이 빠지면 "잡을 수 있다"는 증거가 사라진다
  "빨간 이유가 맞는지",                      // P4. 오타로 빨간 것을 통과로 세는 것 차단
  "돌연변이 점검",                          // J11 이름. 아래 문장 앵커와 한 벌이다
  "제품 코드를 하나씩 망가뜨려 보고",         // J11 본문. 이름만 남고 절차가 사라지는 것 차단
  "일부러 부수기",                          // 계획서마다 손으로 다시 쓰던 그 스텝을 배포물에 둔 자리
];

test("test-design 스킬에 설계 판단 앵커가 존재(삭제 회귀 바닥)", () => {
  for (const a of ANCHORS) assert.ok(skill.includes(a), `src test-design SKILL.md에 누락: ${a}`);
});

// 🛑 이 스킬은 **뺀 것을 밝히는 절**을 갖는 것이 조건이다(사용자 결정). 원본 지침 22개 중 일부를
//    일부러 안 넣었는데, 그 사실이 안 적혀 있으면 다음 사람이 "얇아서 빠뜻한 것"과 "판단해서 뺀 것"을
//    못 가르고 조용히 다시 넣거나 다시 뺀다.
// 🛑 특히 J4("글자가 아니라 동작을 잰다") · J12("원본 글자를 찾는 검사는 경고 신호")는 **차근 자신의
//    앵커 방식을 나쁜 검사로 분류하는 문장**이다. 배포물에 지침으로 실리면 나중 세션이 그것을 근거로
//    앵커를 지우거나 약하게 고칠 수 있고, 그때 검사는 전부 초록인데 앵커가 지키던 칸이 함께 사라진다.
//    그래서 **"안 넣은 것" 절 안에만** 있어야 한다. 아래는 두 축으로 잰다.
//    (가) 그 절 안에 있다  (나) 문서 전체에서 딱 한 번만 나온다(= 다른 절에서 지침으로 되살아나면 빨강)
test("test-design 이 뺀 것을 밝히고, J4·J12 가 지침으로 되살아나지 않았다", () => {
  const i7 = skill.indexOf("## 7.");
  const i8 = skill.indexOf("## 8.");
  assert.ok(i7 > 0 && i8 > i7, "'안 넣은 것' 절(## 7.)이 사라졌다 - 뺀 판단의 기록이 없어졌다");
  const s7 = skill.slice(i7, i8);

  assert.ok(s7.includes("가짜 객체(mock) 다섯 갈래"),
    "모의 객체 다섯 갈래를 뺐다는 사실이 '안 넣은 것' 절에 없다");
  assert.ok(s7.includes("글자가 아니라 동작을 잰다"),
    "J4 를 뺐다는 사실이 '안 넣은 것' 절에 없다 - 뺀 것인지 잊은 것인지 다음 사람이 못 가른다");
  assert.ok(s7.includes("글자 앵커"),
    "J4·J12 를 뺀 이유(차근 방어가 글자 앵커라는 사실)가 없다 - 이유 없는 예외는 다음 판에서 되돌려진다");
  assert.ok(s7.includes("그래서 그 두 줄은 넣지 않았다"),
    "J4·J12 를 안 넣었다는 결론 문장이 없다");

  for (const phrase of ["글자가 아니라 동작을 잰다", "경고 신호"]) {
    const n = (skill.match(new RegExp(phrase, "g")) || []).length;
    assert.equal(n, 1,
      `"${phrase}" 가 ${n}번 나온다 - '안 넣은 것' 절 밖에서 지침으로 되살아나면 차근의 글자 앵커가 나쁜 검사로 분류된다`);
  }
});

test("test-design 본문에 긴 줄표가 0개", () => {
  const hits = skill.match(/[—–―]/g) || [];
  assert.equal(hits.length, 0, `긴 줄표 ${hits.length}개 발견: ${hits.join(" ")}`);
});

// 🛑 귀속 표시(NOTICE)는 라이선스 의무다. 파일이 없거나 저작권자가 빠지면 배포물이 MIT 동봉 의무를
//    조용히 깬다. 스킬 폴더에 두는 이유 = 빌드가 `skills` 를 통째로 복사한다(루트는 README·LICENSE
//    둘만 복사되므로 루트에 두면 배포물에 안 실린다). 배포물 도착은 build.test.mjs 가 잡는다.
test("test-design NOTICE 에 MIT 출처의 저작권자와 허가 문구가 있다", () => {
  assert.ok(notice.includes("Jesse Vincent"), "NOTICE 에 저작권자 누락: Jesse Vincent");
  assert.ok(notice.includes("Permission is hereby granted"),
    "NOTICE 에 MIT 허가 문구가 없다 - 저작권 표시만으론 MIT 동봉 의무를 못 채운다");
});
