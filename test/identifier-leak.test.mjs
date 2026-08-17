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

// ── 긴 무작위 식별자(관리형 프로젝트 ID·컨테이너 이름 등)가 JSON 견본으로 새는 것 ─────────
// 왜 별도 규칙인가: 위 목록은 **아는 이름**을 막는다. 이건 **모르는 이름**을 막는다 - 견본
// 설정 파일에 실환경 값을 그대로 적어 두고 그게 `dist/` 로 배포까지 나간 일이 있었다.
// 이름표라서 새로 발급해 무력화할 수도 없다(비밀번호가 아니다).
//
// 🛑 문턱은 **20자**다. 실제로 샌 값이 밑줄로 끊었을 때 **정확히 20자**였다 - 21로 잡거나
//   "숫자가 하나는 섞여야"로 좁히면 **바로 그 값을 못 잡는다**(측정으로 확인).
// 🛑 `looksLikeToken`(secret-scan-core.js)은 못 쓴다. 끝에 `(숫자 && 글자) || (소문자 && 대문자)`
//   를 요구하는데 그 값은 **순수 소문자라 반드시 false** 다.
const OPAQUE_RUN = /[a-z0-9]{20,}/;
const SCAN_ROOTS = /^(?:src|dist|test\/golden)\//;

// JSON 의 **문자열 값**만 본다(키 이름·구조는 안 본다). 걸린 자리의 경로만 돌려준다 -
// 🛑 **값 자체는 절대 돌려주지 않는다**: 실패 메시지가 곧 그 값을 다시 퍼뜨리는 자리가 된다.
export function opaqueIdPaths(parsed) {
  const hits = [];
  (function walk(node, path) {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, path.concat(String(i))));
    else if (node && typeof node === "object") for (const k of Object.keys(node)) walk(node[k], path.concat(k));
    else if (typeof node === "string" && OPAQUE_RUN.test(node)) hits.push(path.join(".") || "(root)");
  })(parsed, []);
  return hits;
}

// 제외는 위 `ALLOW` 와 별도다. 둘 다 아래 칸에서 크기가 잠겨 있어 조용히 늘릴 수 없다.
// 늘리려면 왜 그 파일이 긴 불투명 식별자를 담아야 하는지 여기 적고, 아래 크기 단언도 함께 고친다.
// (실측: 이 범위 안 JSON 에서 이 무늬가 잡던 것은 배포되던 견본 사본 3개뿐이었고, 그 셋을 지웠다.)
const OPAQUE_ALLOW = new Map();

// 검사 범위가 실제로 무엇을 읽어야 하는지는 **여기 따로 적는다** - SCAN_ROOTS 정규식에서
// 뽑아내지 않는다. 검사 대상 자체에서 기대값을 뽑으면 둘이 함께 틀려도 초록이 된다.
const EXPECTED_ROOTS = ["src", "dist", "test/golden"];

test("배포되는 JSON 에 긴 무작위 식별자가 없다(견본에 실환경 값을 적어 두는 것 방지)", () => {
  assert.ok(EXPECTED_ROOTS.length >= 3, "EXPECTED_ROOTS 가 비면 아래 뿌리별 루프가 0회 돌아 초록이 된다");
  const hits = [];
  const parsedByRoot = Object.fromEntries(EXPECTED_ROOTS.map((r) => [r, 0]));
  for (const rel of trackedFiles()) {
    if (!rel.endsWith(".json") || !SCAN_ROOTS.test(rel)) continue;
    if (OPAQUE_ALLOW.has(rel)) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(ROOT, rel), "utf8")); } catch (_) { continue; }
    const root = EXPECTED_ROOTS.find((r) => rel.startsWith(r + "/"));
    assert.ok(root, `${rel} 은 SCAN_ROOTS 에 걸렸는데 EXPECTED_ROOTS 어디에도 안 든다 - 두 목록이 어긋났다`);
    parsedByRoot[root]++;
    for (const where of opaqueIdPaths(parsed)) hits.push(`${rel}: ${where}`);
  }
  // 🛑 이 칸은 항상 0건이라, 검사 범위(SCAN_ROOTS)가 폴더 이름을 박고 있다 — 뿌리 하나가 통째로
  //   빠지거나 이름이 바뀌면 그 뿌리만 0개를 읽고도 계속 초록이 될 수 있다. 그래서 **뿌리별로**
  //   최소 1개는 읽었는지 잰다. hits 단언보다 먼저 둬야 둘 다 실패할 때 "아무것도 안 읽었다"는
  //   근본 원인이 먼저 보인다.
  for (const root of EXPECTED_ROOTS) {
    assert.ok(parsedByRoot[root] >= 1,
      `이 검사가 '${root}' 뿌리에서 실제로 읽은(JSON.parse 성공한) 파일이 0개다 - SCAN_ROOTS 범위가 ` +
      "좁아졌거나 죽었을 수 있다, 그 뿌리의 .json 이 전부 지워졌거나 옮겨졌을 수 있다, " +
      "또는 JSON 문법이 깨져 파싱에서 조용히 빠졌을 수 있다.");
  }
  // 🛑 뿌리별 최소 1개와 이 총합 바닥은 **서로 다른 사고를 잡는 별개 그물**이다 - 대체가 아니라
  //   둘 다 있어야 한다. 실측 12개가 4·4·4 라, 한 뿌리가 통째로 빠지면(보충 없이도) 총합이 딱
  //   8이 되어 옛 바닥(8)을 그대로 넘겼다 - 뿌리별 검사가 없던 판에서 실제로 이렇게 뚫렸다.
  //   그래서 여기서 다시 잰다: 파일 필터가 좁아져 12개가 그대로 4개로(뿌리마다 1개씩) 줄어도
  //   위 뿌리별 검사만으로는 안 잡힌다.
  const total = Object.values(parsedByRoot).reduce((a, b) => a + b, 0);
  assert.ok(total >= 8,
    `이 검사가 실제로 읽은 파일 총합이 ${total}개뿐이다(뿌리별로는 1개씩 있어도 통과였을 자리) - ` +
    "읽는 파일이 통째로 줄었을 수 있다.");
  assert.deepEqual(hits, [],
    "배포되는 JSON 에 20자 이상 연속된 소문자·숫자 식별자가 있다. 견본이면 값을 지우고 자리표시로 바꿔라.\n" +
    "(위반한 값은 여기 안 적는다 — 아래는 파일과 그 값이 있는 칸 이름뿐이다.)\n" + hits.join("\n"));
});

// 🛑 위 칸은 지금 **걸릴 것이 0건**이라, 정규식이 깨져도 계속 초록이다. 살아 있는 양성 표본을 둔다.
//   런타임에 조립하는 이유는 둘이다: (1) 이 파일 맨 위(19~23행)가 정한 규칙과 같은 모양을 지킨다
//   (금지 식별자를 리터럴로 안 적는다). (2) 지금 안 걸리는 것은 지금의 검사 범위 때문이고, 범위는
//   바뀔 수 있다.
test("긴 식별자 판정이 살아 있다(런타임 조립 표본으로 확인)", () => {
  const twenty = "abcde".repeat(4);                 // 20자 순수 소문자 — 실제로 샌 값과 같은 모양
  assert.equal(twenty.length, 20, "표본이 문턱과 같은 길이여야 이 칸이 문턱을 잰다");
  assert.deepEqual(opaqueIdPaths({ sandbox: { name: twenty } }), ["sandbox.name"], "20자를 잡아야 한다");
  assert.deepEqual(opaqueIdPaths({ a: [{ b: "x" + twenty }] }), ["a.0.b"], "배열·중첩 안도 봐야 한다");
  assert.deepEqual(opaqueIdPaths({ ok: twenty.slice(0, 19) }), [], "19자는 안 잡는다(문턱이 20)");
  assert.deepEqual(opaqueIdPaths({ ok: "abcde_abcde_abcde_abcde" }), [], "밑줄로 끊기면 연속이 아니다");
  // 🛑 순수 소문자가 반드시 잡혀야 한다 — `looksLikeToken` 을 재사용했다면 여기서 빨개진다.
  assert.deepEqual(opaqueIdPaths({ v: "qwertyuiopasdfghjklz" }), ["v"], "숫자·대문자를 요구하면 안 된다");
});

test("면제가 실재하고 최소로 유지된다(면제가 조용히 늘어나는 것 방지)", () => {
  const tracked = new Set(trackedFiles());
  for (const rel of ALLOW.keys()) assert.ok(tracked.has(rel), `면제 대상이 없는 파일: ${rel}`);
  assert.ok(ALLOW.size <= 1, "면제 파일은 1개까지 — 늘리려면 그 파일이 왜 실명을 담아야 하는지 주석으로 남겨라");
  // 이 파일 자신은 면제 목록에 없어야 한다 — 자기 면제가 곧 확장 시점의 사각이다.
  assert.equal(ALLOW.has("test/identifier-leak.test.mjs"), false, "자기 면제는 두지 않는다(조각 분리로 해결한다)");
  assert.equal(OPAQUE_ALLOW.size, 0,
    "OPAQUE_ALLOW 는 지금 면제가 없다 — 늘리려면 이 단언을 함께 고치면서 왜 그 파일이 긴 식별자를 담아야 하는지 주석으로 남겨라");
});
