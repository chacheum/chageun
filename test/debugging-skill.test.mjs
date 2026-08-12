import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// `chageun:debugging` 은 걷어낸 `systematic-debugging` 자리를 대신 받는다. 코어 79행은 포인터 문투
// (`load ... via the Skill tool`)를 **안 쓰기로** 했으므로, 이 스킬 본문을 지키는 그물은 이 파일뿐이다.
// 각 앵커 옆 주석은 "이 문구가 없으면 무엇이 무너지는가"다 — 지우려면 그 근거부터 반박해야 한다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(ROOT, "src", "skills", "debugging", "SKILL.md"), "utf8");
const notice = readFileSync(join(ROOT, "src", "skills", "debugging", "NOTICE"), "utf8");

const ANCHORS = [
  "철칙: 원인을 찾기 전에 고치지 않는다", // 이 스킬의 존재 이유. 빠지면 "아마 이거겠지" 수정이 절차 안이 된다
  "두 번 빗나가면 멈춘다",               // 코어 '멈춤 규칙' 2회와 같은 숫자. 아래 역방향 검사와 한 벌이다
  "값은 찍지 않는다",                    // 조사용 로그가 비밀·개인정보를 대화창·파일에 흘리는 것 차단
  "웹 검색에 붙여넣지 않는다",            // 오류 원문·회사 이름·내부 주소가 외부로 나가는 것 차단
  "`#region DEBUG`",                    // 조사용 코드 심는 표시
  "`#endregion DEBUG`",                 // 짝. 한쪽만 남으면 걷어낼 범위가 안 잡힌다
  "남은 표시가 0인지",                    // 커밋 전 전량 제거 확인. 남은 조사용 코드는 비개발자가 못 본다
];

test("debugging 스킬에 절차·안전 앵커가 존재(삭제 회귀 바닥)", () => {
  for (const a of ANCHORS) assert.ok(skill.includes(a), `src debugging SKILL.md에 누락: ${a}`);
});

// 🛑 양방향이다. 존재 검사만 두면 "두 번"을 **덧붙인 채** 다른 문장에서 3회를 허용하는 개정이
//    통과한다. 코어 '멈춤 규칙'은 2회이고, 3회 문투가 들어오는 순간 두 문서가 한 칸 어긋난다
//    (수퍼파워스 `systematic-debugging` 이 실제로 3회였다 — 그 문투가 되돌아오는 것을 막는 칸이다).
test("debugging 의 멈춤 문턱이 2회다(3회 문투 회귀 차단)", () => {
  const three = skill.match(/(세 번|3번|3회|삼 번)\s*빗나가/g) || [];
  assert.equal(three.length, 0,
    `멈춤 문턱이 3회로 늘어났다: ${three.join(" / ")} — 코어 '멈춤 규칙'은 2회다`);
  assert.ok(skill.includes("코어 '멈춤 규칙' 2회"),
    "멈춤 문턱이 코어 2회를 가리키는 근거 표시가 사라졌다");
});

test("debugging 프론트매터에 과발동 방지 조건이 있다", () => {
  const fm = skill.slice(0, skill.indexOf("\n---", 4));
  assert.ok(fm.includes("발동하지 않는다"),
    "debugging 프론트매터에 '발동하지 않는다'(과발동 방지) 조건이 없다");
});

test("debugging 본문에 긴 줄표가 0개", () => {
  const hits = skill.match(/[—–―ㅡ]/g) || [];
  assert.equal(hits.length, 0, `긴 줄표 ${hits.length}개 발견: ${hits.join(" ")}`);
});

// 🛑 귀속 표시(NOTICE)는 라이선스 의무다. 파일이 없거나 저작권자 한 명이 빠지면 배포물이 MIT
//    동봉 의무를 조용히 깬다. 스킬 폴더에 두는 이유 = 빌드가 `skills` 를 통째로 복사한다
//    (루트는 README·LICENSE 둘만 복사되므로 루트에 두면 배포물에 안 실린다).
test("debugging NOTICE 에 MIT 출처 4종의 저작권자가 다 있다", () => {
  for (const holder of ["Jesse Vincent", "Addy Osmani", "Jeffallan", "doraemonkeys"])
    assert.ok(notice.includes(holder), `NOTICE 에 저작권자 누락: ${holder}`);
  assert.ok(notice.includes("Permission is hereby granted"),
    "NOTICE 에 MIT 허가 문구가 없다 — 저작권 표시만으론 MIT 동봉 의무를 못 채운다");
});
