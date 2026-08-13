import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// batch7 영어화 회귀 가드 — 규칙이 영어여도 "정본 한국어 라벨"은 남아야 한다.
// (a) Stop 훅 정규식 seed: finish-work.js가 한국어 출력(끝 점검·자가점검·비전문가 요약·실구동·
//     요약 5필드)으로 갭을 감지한다. 규칙 골격이 이 라벨을 잃으면, 스킬 미로드 세션(=가드의 표적)
//     에서 Claude가 임의 라벨로 렌더해 가드가 조용히 무력화된다(plan-validator HIGH).
// (b) 한국어 스킬 5종이 "코어 '○○' 절"을 한국어 제목으로 참조한다 — 병기 제목 유지(plan-validator medium).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULES = readFileSync(join(ROOT, "src", "rules", "operating-rules.md"), "utf8");

const HOOK_SEEDS = [
  "끝 점검", "자가점검", "비전문가 요약", "실구동 검증", "구동 검증", "LIGHT",
  // 비전문가 요약 5필드 (finish-work SUMMARY_FIELD_RE 어휘)
  "무엇을 했는가", "왜 이렇게 결정했는가", "잘되면", "잘못되면", "다음에 확인할 것",
];

const SECTION_LABELS = [
  "작업 규모 스위치", "작업 시작 카드 · 비전문가 요약", "검증 게이트", "게이트 판정 ↔ 멈춤",
  "스펙 확인 게이트", "최소 구현 우선", "모델·실행 라우팅", "작업 유형별 진행", "제품 지도",
  "멈춤 규칙", "실제 구동 검증", "안전 캡슐", "보안·승인 위생",
  // v0.51.0: 출력 스타일 절. 앵커가 없으면 절 하나가 통째로 사라져도 전 테스트가 초록이다
  // (골든은 복사 재생성이고, 상한 밴드는 재핀하면 누적이 리셋된다).
  "출력 스타일",
];

const MISC_LABELS = ["위험 없음", "달라진 것 N건", "진행 보고", "🙋 확인 필요", "별도 심판 게이트 없음", "동작 검증 안 됨"];

// 안전 tie-break 의 두 축을 각각 앵커한다. 제목 앵커(SECTION_LABELS)는 절이 통째로 사라져야만
// 반응해서, 문장 안의 안전 조각이 조용히 빠지는 것을 못 잡는다(v0.64.0 이 이 문장을 고치며 발견).
const TIEBREAK_ANCHORS = [
  "Safety tie-break",   // 절 안의 그 문장 자체
  "Never Sonnet",       // 모델 축 바닥. 이게 빠지면 판단 걸린 일이 Sonnet 으로 샌다
  "report BLOCKED",     // 위임 축 안전판. 이게 빠지면 뒤에서 도는 일이 혼자 정한다
  "delegated fixes: re-run manually", // 5차 HIGH-1: 위임분 예외. 이게 빠지면 코어가 다시
                        // "훅이 다 강제한다"로 읽혀, 메인이 검사 안 받은 코드를 그냥 push 한다
];
test("안전 tie-break 의 모델 축과 위임 축이 둘 다 살아 있다", () => {
  for (const s of TIEBREAK_ANCHORS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("훅 seed 한국어 라벨이 규칙에 존재(영어화 후 소실 금지)", () => {
  for (const s of HOOK_SEEDS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("스킬이 참조하는 코어 절 제목 + 소실 방지 앵커가 존재", () => {
  for (const s of SECTION_LABELS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("기타 정본 라벨 존재", () => {
  for (const s of MISC_LABELS) assert.ok(RULES.includes(s), `누락: ${s}`);
});

test("스킬 로드 강제 포인터 6문장 유지(Skill tool + 스킬 ID)", () => {
  for (const id of ["chageun:formats", "chageun:spec-gate", "chageun:routing", "chageun:run-verify", "chageun:finish-check",
                    // v0.66.0: 기획 대화가 차근 것이 됐다. 새 기능 입구는 **강제 포인터**를 쓴다
                    // (스킬 저발동 실측 때문에 가장 중요한 입구의 발동률을 우선).
                    "chageun:planning"]) {
    const re = new RegExp(`load(ing)? \\\`${id}\\\` via the Skill tool`);
    assert.ok(re.test(RULES), `포인터 누락: ${id}`);
  }
});

// M2(v0.66.0): 디버깅은 **포인터 문투를 안 쓴다**(위 검사가 안 덮는다) — 새 기능 입구에만 강제
//   포인터를 두기로 한 의도된 비대칭이다. 그래서 79행에서 `chageun:debugging` 이 통째로 빠져도
//   잡는 칸이 하나도 없었다. 크기 밴드는 재핀하면 초록이 되므로(core-size.test.mjs:252) 그쪽은
//   방어가 아니다. 이 한 줄이 그 축의 전부다.
test("코어 '작업 유형별 진행'이 `chageun:debugging` 을 가리킨다(포인터 문투 없는 축)", () => {
  assert.ok(RULES.includes("chageun:debugging"),
    "누락: chageun:debugging — 버그 경로가 가리킬 스킬 이름이 코어에서 사라졌다");
});

// v0.67.0: 테스트 설계도 같은 비대칭이다(강제 포인터를 안 붙였다 — 매번 본문을 대화에 실으면
//   컨텍스트를 줄이려는 이 판의 목적과 반대다). 그래서 위 검사가 이 이름을 안 덮고,
//   79행에서 통째로 빠져도 잡는 칸이 없었다. 크기 밴드는 재핀하면 초록이라 방어가 아니다.
test("코어 '작업 유형별 진행'이 `chageun:test-design` 을 가리킨다(포인터 문투 없는 축)", () => {
  assert.ok(RULES.includes("chageun:test-design"),
    "누락: chageun:test-design — 새 검사를 짜는 경로가 가리킬 스킬 이름이 코어에서 사라졌다");
  assert.ok(!RULES.includes("test-driven-development"),
    "옛 이름 test-driven-development 가 코어에 남았다 — 그 스킬이 없는 사용자에게 막다른 길이 배포된다");
});

// pr-reviewer 재리뷰 2회차 medium: 이 판에서 걷어낸 남의 스킬 이름은 넷인데(test-driven-development ·
//   executing-plans · using-git-worktrees · writing-skills), 되살아남을 막는 검사는 위 하나뿐이었다.
//   나머지 셋은 코어(RULES)에 그물이 없어, 되살아나면 `:82`(=위 두 검사 옆)가 "차근을 재설치하라"고
//   안내하는데 그 이름은 차근에 없으니 몇 번 재설치해도 안 고쳐지는 막다른 길이 조용히 배포된다.
const RETIRED_SUPERPOWERS_NAMES_REST = ["executing-plans", "using-git-worktrees", "writing-skills"];

test("코어에 걷어낸 옛 이름 셋(executing-plans·using-git-worktrees·writing-skills)이 안 남았다", () => {
  for (const name of RETIRED_SUPERPOWERS_NAMES_REST)
    assert.ok(!RULES.includes(name),
      `옛 이름 ${name} 이 코어에 남았다 — 그 스킬이 없는 사용자에게 막다른 길이 배포된다`);
});

// 위 두 검사는 RULES(코어 한 파일)만 훑는다. 그런데 `using-git-worktrees` 는 코어가 아니라
//   src/skills/routing/SKILL.md:61 에 있던 이름이라 코어만 훑으면 안 걸린다 — 스킬 본문까지
//   훑어야 한다. 훑는 범위 = src/rules/*.md + src/skills/*/SKILL.md + src/agents/*.md.
//   NOTICE 파일은 **일부러 안 읽는다**: src/skills/test-design/NOTICE:12 가
//   `test-driven-development` 를 MIT 저작권 표시로 정당하게 들고 있다(라이선스 고지) — 그것까지
//   잡으면 저작권 표기를 지우라는 잘못된 압력이 생긴다. 이 함수는 SKILL.md 파일명만 지목해서
//   읽으므로 같은 폴더의 NOTICE 는 애초에 대상이 아니다.
function readCoreAndSkillFiles() {
  const files = [];
  const rulesDir = join(ROOT, "src", "rules");
  for (const f of readdirSync(rulesDir)) if (f.endsWith(".md")) files.push(join(rulesDir, f));
  const skillsDir = join(ROOT, "src", "skills");
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(skillsDir, entry.name, "SKILL.md");
    if (existsSync(skillMd)) files.push(skillMd); // NOTICE 는 여기서 지목 안 됨 — 위 사유
  }
  const agentsDir = join(ROOT, "src", "agents");
  for (const f of readdirSync(agentsDir)) if (f.endsWith(".md")) files.push(join(agentsDir, f));
  return files;
}

const RETIRED_SUPERPOWERS_NAMES_ALL = ["test-driven-development", ...RETIRED_SUPERPOWERS_NAMES_REST];

test("src/rules · src/skills/*/SKILL.md · src/agents (NOTICE 제외) 전체에 걷어낸 옛 이름 넷이 안 남았다", () => {
  for (const filePath of readCoreAndSkillFiles()) {
    const content = readFileSync(filePath, "utf8");
    for (const name of RETIRED_SUPERPOWERS_NAMES_ALL)
      assert.ok(!content.includes(name),
        `${filePath} 에 걷어낸 옛 이름 ${name} 이 남았다 — 그 스킬이 없는 사용자에게 막다른 길이 배포된다`);
  }
});

// 🛑 v0.67.0: "우리 스킬이 있으면 남의 스킬을 부르지 않는다"는 **기계 강제가 없는 규칙**이다
//    (새 하드 차단은 실기록 오차단 0 증거를 요구하고 그 재료가 없다 · 사용자가 일부러 남의 스킬을
//    쓰고 싶을 수도 있다). 강제가 없는데 문장이 조용히 사라지는 것을 잡는 칸까지 없으면 그 규칙은
//    있었다는 기록만 남는다. 이미 깔린 사용자의 `superpowers:brainstorming` 은 자기 설명에
//    "You MUST use this before any creative work" 를 갖고 있고 197세션 중 53세션에서 실제로 떴다 —
//    그것이 먼저 뜨면 우리 스펙 확인 게이트(🙋)가 조용히 안 돈다. 그 자리를 지키는 한 줄이다.
test("코어에 '우리 스킬 먼저' 한 줄이 살아 있다(기계 강제 없는 규칙의 유일한 그물)", () => {
  assert.ok(RULES.includes("don't call another source's skill"),
    "누락: '우리 스킬 먼저' 규칙 — 같은 취지의 남의 스킬이 우리 절차 자리를 대신 차지하는 것을 막는 문장이 사라졌다");
});

// 🛑 v0.67.0: 이 승인 문장을 잡는 앵커가 하나도 없었다(전수 확인 — 그 줄을 지워도 744개가 전부 초록).
//    앞으로의 행동을 바꾸는 것(스킬·규칙·훅·메모리)을 사용자 승인 없이 저장하는 길이 조용히 열리는
//    자리라, 이 판에서 앵커를 만든다. `(writing-skills)` 예시를 걷어내면서 대상 부류를 넷으로
//    적었으므로, 넷이 다 남아 있는지 함께 잰다(하나가 빠지면 그 부류가 승인 규칙 밖이 된다).
test("보안·승인 위생: 행동을 바꾸는 저장은 승인이 필요하다(부류 4개 포함)", () => {
  assert.ok(RULES.includes("need user approval before saving"),
    "누락: 승인 문장 — 앞으로의 행동을 바꾸는 저장에 사용자 승인을 요구하는 규칙이 사라졌다");
  for (const kind of ["skills", "rules", "hooks", "memory"])
    assert.ok(new RegExp(`Approval hygiene:[^\\n]*\\b${kind}\\b`).test(RULES),
      `승인 대상 부류 누락: ${kind} — 그 부류를 몰래 고치는 길이 승인 규칙 밖으로 빠진다`);
});

// v0.54.0 pr-reviewer 2차 medium: 요약 라벨을 줄였다가 finish-work 훅의 요약 감지를 꺼뜨린 사고가
//   났는데, 그때 434개가 전부 초록이었다. 훅 fixture 는 테스트 안 하드코딩 문자열이라 **문서를
//   안 읽는다** — 문서 라벨을 다시 줄여도 그 테스트는 통과한다. 그래서 문서 자체를 앵커한다.
test("formats 스킬의 요약 양식이 정본 라벨 다섯 개를 쓴다", () => {
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "formats", "SKILL.md");
  const md = readFileSync(p, "utf8");
  for (const label of ["무엇을 했는가", "왜 이렇게 결정했는가", "잘되면", "잘못되면", "다음에 확인할 것"]) {
    assert.ok(md.includes(label),
      `formats 양식에 정본 라벨 "${label}" 이 없다 — 라벨을 줄이면 finish-work 훅이 요약을 못 알아본다`);
  }
});
