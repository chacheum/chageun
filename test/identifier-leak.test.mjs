// test/identifier-leak.test.mjs — 공개 저장소에 실명(회사·내부 프로젝트·계정)이 새는 것을 기계로 막는다.
//
// 왜 필요한가: 전역 규칙이 이미 "회사명·내부 URL·고객 데이터를 외부로 내보내지 말 것"을 정하고 있는데도
// 2026-07-31 v0.41.1에서 근거 주석에 내부 식별자가 9곳(미러 포함) 들어간 채 공개 push됐다. 산문 규칙이
// 있는데 지켜지지 않았으므로 기계로 내린다 — 차근 자신의 원칙("산문을 기계로 참되게")을 자기 저장소에 적용.
//
// 한계(정직): 이 가드는 **앞으로 들어오는 것**만 막는다. 이미 push된 과거 커밋 이력에는 남아 있고, 그걸
// 지우려면 저장소 이력을 다시 쓰는 큰 작업이라 하지 않기로 했다(2026-08-01 오너 결정). 커밋 메시지도
// 추적 파일이 아니라 이 가드 밖이다 — 메시지엔 중립 표현을 쓴다("주석 익명화").
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 금지 식별자는 **조각으로 나눠** 적는다. 리터럴로 두면 이 가드 파일 자신이 공개 저장소에서 grep·코드검색에
// 걸리는 누출원이 되기 때문이다(가드가 막으려는 바로 그 노출).
// 🛑 **어떤 조각도 완성된 금지어를 품으면 안 된다.** 품는 순간 이 파일이 자기 스캔에 걸리고, 그걸 피하려고
// 자기 면제를 넣으면 **목록을 늘리는 바로 그 순간 가드가 무력해진다**(리터럴로 새 이름을 추가해도 초록).
// 그래서 자기 면제를 두지 않는다 — 앞으로 누가 이름을 통째로 적으면 이 테스트가 스스로 빨개진다.
// (pr-reviewer medium 2026-08-01: 이메일이 다른 금지어를 내포해 자기 면제가 실작동 중이었다 → 3조각으로 분리)
// 이름을 붙여 두는 이유: 아래 면제 목록이 **리터럴 대신 이 값을 참조**해야 한다. 면제에 실명을 통째로
// 적으면 그 순간 이 파일이 자기 규칙을 어긴다(실제로 한 번 그렇게 써서 가드가 자기 자신을 잡았다).
const ID = {
  relay:   ["dow", "-relay"].join(""),
  relay2:  ["dow", "_relay"].join(""),
  erp:     ["dow", "-erp"].join(""),
  site:    ["valve", "park"].join(""),
  brandKo: ["다우", "밸브"].join(""),
  brandEn: ["dow", "valve"].join(""),
  account: ["mok", "gam"].join(""),
  account2:["kw", "jdd"].join(""),
  email:   ["info@", "dow", "valve.co.kr"].join(""),
};
const FORBIDDEN = Object.values(ID);

// 면제는 **파일이 아니라 식별자 단위**다(파일 통째로 뚫으면 그 안의 다른 실명까지 조용히 통과한다).
// design-template 테스트는 "브랜드 값이 승격물에 남았는지" 검사하는 같은 목적의 기존 가드라, 그 값 하나만
// 알아야 한다. 늘리려면 왜 그 파일이 그 식별자를 담아야 하는지 여기 주석으로 남긴다.
const ALLOW = new Map([
  ["test/design-template.test.mjs", [ID.brandKo]],
]);

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

test("공개 추적 파일에 회사·내부 프로젝트·계정 실명이 없다", () => {
  const hits = [];
  for (const rel of trackedFiles()) {
    if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|pdf)$/i.test(rel)) continue;
    let text;
    try { text = readFileSync(join(ROOT, rel), "utf8"); } catch (_) { continue; }
    const lower = text.toLowerCase();                       // 대소문자 섞인 표기 변형도 잡는다 — 금지어는 전부 소문자
    const allowed = ALLOW.get(rel) || [];
    for (const id of FORBIDDEN) {
      if (allowed.includes(id)) continue;
      if (lower.includes(id)) hits.push(`${rel}: ${id}`);
    }
  }
  assert.deepEqual(hits, [],
    "공개 저장소에 실명이 들어갔다. 근거를 남길 땐 '한 실무 프로젝트'·'/home/<user>/…'처럼 익명화하라.\n" +
    hits.join("\n"));
});

test("면제가 실재하고 최소로 유지된다(면제가 조용히 늘어나는 것 방지)", () => {
  const tracked = new Set(trackedFiles());
  for (const rel of ALLOW.keys()) assert.ok(tracked.has(rel), `면제 대상이 없는 파일: ${rel}`);
  assert.ok(ALLOW.size <= 1, "면제 파일은 1개까지 — 늘리려면 그 파일이 왜 실명을 담아야 하는지 주석으로 남겨라");
  // 이 파일 자신은 면제 목록에 없어야 한다 — 자기 면제가 곧 확장 시점의 사각이다.
  assert.equal(ALLOW.has("test/identifier-leak.test.mjs"), false, "자기 면제는 두지 않는다(조각 분리로 해결한다)");
});
