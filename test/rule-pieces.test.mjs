import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// 조각 축 검사. 훅(activate.js)과 이 검사가 **같은 함수**(activate-core.js)를 부른다.
// 검사가 자기 나름의 분해를 다시 짜면 "내가 뽑은 중간 결과를 기준 삼은 검사"가 되어
// 조용한 유실을 못 잡는다(이 저장소가 이미 데인 자리).
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = require("../src/hooks/activate-core.js");
const RULES_PATH = join(ROOT, "src", "rules", "operating-rules.md");
const RULES = readFileSync(RULES_PATH, "utf8");

test("조각 표와 본문이 두 방향으로 맞는다 — 새 절이 어느 조각에도 안 들어가면 잡는다", () => {
  const secs = core.sectionsOf(RULES);
  const keys = core.PIECES.flatMap((p) => p.keys);
  // 방향 1: 모든 절이 정확히 하나의 key 에 잡힌다
  for (const s of secs) {
    const hit = keys.filter((k) => s.heading.includes(k));
    assert.equal(hit.length, 1, `절 "${s.heading}" 를 가리키는 key 가 ${hit.length}개 (1개여야 함)`);
  }
  // 방향 2: 모든 key 가 정확히 하나의 절을 잡는다
  for (const k of keys) {
    const hit = secs.filter((s) => s.heading.includes(k));
    assert.equal(hit.length, 1, `key "${k}" 가 잡는 절이 ${hit.length}개 (1개여야 함)`);
  }
});

test("조각 1~5 를 표 순서로 이어 붙이면 원본과 글자 하나까지 같다", () => {
  const joined = core.PIECES.map((p) => core.bodyOfPiece(RULES, p.n)).join("");
  assert.equal(joined, RULES,
    "조각으로 갈랐다 붙였더니 원본과 다르다. 원인은 둘 중 하나다 — " +
    "(1) 쪼개기가 글을 먹었다(어느 조각에도 안 들어간 절이 있다), " +
    "(2) 조각 표의 순서가 파일의 절 순서와 달라졌다(절을 건너뛰어 다른 조각으로 옮겼다). " +
    "🛑 (2)라면 operating-rules.md 안의 절 순서도 함께 바꿔라. " +
    "이 검사를 무르게 고쳐서 통과시키지 마라 — 조용한 유실을 막는 마지막 자물쇠다.");
});

// 🛑 사용자 결정을 기계로 잡아 둔다. 조각 4(멈춤·검증·마무리 5,884자)와 조각 5(안전 캡슐 1,388자)를
//    합쳐도 7,718자라 8,000 상한도, 물리 천장도, 재구성 대조도 **전부 초록이다.**
//    즉 이 단언이 없으면 "캡슐은 자기 조각" 이라는 결정을 지키는 것이 사람 기억뿐이다.
test("안전 캡슐은 자기 조각 하나를 통째로 쓴다", () => {
  const holder = core.PIECES.find((p) => p.keys.some((k) => k.includes("Safety capsule")));
  assert.ok(holder, "안전 캡슐을 담은 조각이 조각 표에 없다");
  assert.equal(holder.keys.length, 1,
    `안전 캡슐 조각(${holder.n}번)에 다른 절 ${holder.keys.length - 1}개가 섞였다. ` +
    "사용자 결정: 안전 캡슐은 어느 조각에도 안 섞는다. " +
    "크기가 남는다는 이유로 합치지 마라 — 합쳐도 다른 검사는 전부 초록이라 여기서만 잡힌다.");
});

// ── 조각별 문자 수 상한 + 조건 조합 매트릭스 ─────────────────────────────────
// 자는 **JS 문자 수**(str.length)다. `wc -m`·`[...str].length`(코드 포인트)로 재면 안 된다 —
// 코어에 이모지가 7자 있어 두 값이 19,428 대 19,421로 갈리고, 코드 포인트가 더 작아
// 여유가 실제보다 많아 보인다(안전하지 않은 방향).
const { PIECE_MAX_CHARS, CLI_TRUNCATION_CHARS, APPENDIX_PIECE } = core;  // 🛑 여기서 다시 정의하지 않는다
// 경로 가정값 둘. 경로는 **규칙 내용이 아니라 환경**이라 기계마다 다르므로 로컬 경로를 안 잰다.
// 하나로 재면 조각 4의 여유가 규칙과 무관한 이유로 쪼그라들어 헛빨간불이 뜬다.
const PATH_STANDIN_CHARS = 256;    // 정책 검사용(실제 설치 경로는 40~80자)
const PATH_PARANOID_CHARS = 1024;  // 물리 천장 검사용(편집증적)
const ALL_PIECES = [...core.PIECES.map((p) => p.n), APPENDIX_PIECE];
const APPENDIX_TEXT = Object.fromEntries(core.APPENDICES.map((a) =>
  [a.id, readFileSync(join(ROOT, "src", "rules", a.file), "utf8")]));

// 조건 조합을 **손으로 안 적는다.** APPENDICES 에서 축을 뽑아 곱집합을 돈다.
// 부록 하나가 만드는 상태 = 꺼짐 1 + 변형 수. 개수는 생성기가 정한다(단언하지 않는다).
function combos() {
  let acc = [{ id: "기본", on: [], variants: {} }];
  for (const a of core.APPENDICES) {
    const next = [];
    for (const c of acc) {
      next.push({ ...c, id: c.id + `·${a.id}:꺼짐` });
      for (const v of a.variants)
        next.push({ id: c.id + `·${a.id}:${v}`, on: [...c.on, a.id],
                    variants: { ...c.variants, [a.id]: v } });
    }
    acc = next;
  }
  return acc;
}

// 그 조합에서 실제로 붙는 부록 본문들(등록 순서 = activate.js 가 읽는 순서).
// 🛑 다듬기는 **등록부의 render** 를 부른다. 여기서 자리표시자 치환이나 조건부 줄 자르기를
//    다시 짜면, 훅이 실제로 내는 글이 아니라 내가 뽑은 중간 결과를 재는 검사가 된다
//    (이 저장소가 이미 데인 자리 — 대조 3종이 전부 초록인데 값이 틀렸다).
function textsFor(c, pathChars) {
  const ctx = { boardServer: "x".repeat(pathChars) };
  return core.APPENDICES.filter((a) => c.on.includes(a.id))
    .map((a) => a.render(APPENDIX_TEXT[a.id], c.variants[a.id], ctx));
}

// 2026-08-12 실측(손으로 세지 않았다 — 위 combos()·core.assemble() 로 뽑았다).
// 조합 **6가지** = 무인 2(꺼짐·only) × 상황판 3(꺼짐·표식온전·표식깨짐). 손으로 안 적었다 —
// 상황판 부록을 등록부에 올리자 곱집합이 2에서 6으로 저절로 늘었다.
// 가장 빡빡한 조각은 여전히 4번(여유 1,663자)이고, 조각 1~5 는 조합과 무관하게 값이 같다.
//   조각 | 본문  | 정책(경로256) | 8,000 여유 | 물리(경로1024)
//    1   | 5597  |  6046         | 1954       | 6814
//    2   | 3865  |  4312         | 3688       | 5080
//    3   | 2695  |  3144         | 4856       | 3912
//    4   | 5884  |  6337         | 1663       | 7105
//    5   | 1407  |  1856         | 6144       | 2624
//   조각 6은 조합마다 다르다(부록이 전부인 조각이라 조건이 곧 크기다):
//    6   |    0  |     0         | 8000       |    0     둘 다 꺼짐(평시)
//    6   |  291  |  1000         | 7000       | 2536     상황판:표식온전
//    6   |  360  |  1069         | 6931       | 2605     상황판:표식깨짐
//    6   | 3130  |  3583         | 4417       | 4351     무인만
//    6   |  ---  |  4137         | 3863       | 5673     무인 + 상황판:표식온전
//    6   |  ---  |  4206         | 3794       | 5742     무인 + 상황판:표식깨짐 ← 최악
// 최악(4,206자)도 8,000까지 3,794자가 남는다. 경로를 1,024자로 잡아도 5,742자다.
// 이 숫자가 지키는 것은 **둘이고, 성격이 다르다.** 갈라 적는다(pr-reviewer 2차 low) —
// 섞어 읽으면 필요 없는 조각 재분할을 하게 된다.
//
// (1) **안전 보장 = 아래 8,000 검사 그 자체.** 조용한 잘림을 막는 것은 오직 이것이고,
//     이것 하나로 충분하다. 8,000을 넘긴 조각은 머지 전에 잡히고, "8,000 이하인데 물리 천장
//     10,000을 넘는" 상태는 산술적으로 불가능하다. 이 보장은 아래 (2)와 **무관하게 항상** 성립한다.
//
// (2) **빨리 알아채기 = 가장 빡빡한 조각의 여유가 역대 최대 규칙 덩어리보다 작은 상태.**
//     이 저장소가 한 번에 넣은 규칙 덩어리의 역대 최대는 출력 스타일 절 1,674자다. 지금 조각 4의
//     여유는 1,663자라 그 덩어리가 통째로 들어오면 **같은 커밋에서** 빨간불이 뜬다
//     (1,663 + 1,674 = 8,011 > 8,000).
//     ⚠ **이건 편의이지 안전선이 아니다.** 여유가 1,674를 넘어도 조용히 잘리는 일은 안 생긴다 —
//       빨간불이 **한 커밋 늦게** 뜰 뿐이고, 그 커밋도 8,000을 넘는 순간 (1)이 잡는다.
//     ⚠ 지금 1,663인 것도 **우연이다**(머리말에 조각 명단을 넣다 32자 늘어 그렇게 됐다).
//       다음 손질에 조용히 사라질 수 있고, **사라져도 고칠 일이 아니다. 이 값을 지키려고
//       조각을 다시 가르지 마라.** 단언으로 안 박은 이유도 그것이다 — 박으면 멀쩡한 문장
//       다듬기마다 빨간불이 뜨는 검사가 된다.
test("조건 조합을 전부 돌아도 조각 하나가 8,000자를 안 넘는다", () => {
  for (const c of combos())
    for (const n of ALL_PIECES) {
      const out = core.assemble({ rulesText: RULES, n, rulesPath: "x".repeat(PATH_STANDIN_CHARS),
                                  appendixTexts: textsFor(c, PATH_STANDIN_CHARS) });
      assert.ok(out.length <= PIECE_MAX_CHARS,
        `조각 ${n} (조건 ${c.id}) = ${out.length}자 > ${PIECE_MAX_CHARS}. ` +
        `고치는 법: 인접한 조각으로 절을 넘기거나(파일 순서를 안 깬다), 건너뛰어 옮겨야 하면 ` +
        `operating-rules.md 안의 절 순서도 함께 바꿔라. ` +
        `⚠ PIECE_MAX_CHARS 를 올려서 통과시키지 마라 — 그러면 이 검사의 존재 이유가 사라진다. ` +
        `8,000 은 임의의 숫자가 아니다: 이 저장소가 한 번에 넣은 역대 최대 규칙 덩어리가 1,674자인데, ` +
        `8,000 을 넘긴 조각도 물리 천장 ${CLI_TRUNCATION_CHARS} 까지 2,000자가 남아 아직 안 잘린다. ` +
        `즉 "빨간불은 떴지만 규칙은 멀쩡히 닿는" 상태다. 선을 올리면 그 여백을 스스로 지우는 것이고, ` +
        `다음 한 덩어리에 천장을 뛰어넘어 그 조각만 조용히 사라진다.`);
    }
});

test("경로가 비정상적으로 길어도 CLI 문턱 10,000에 못 닿는다", () => {
  for (const c of combos())
    for (const n of ALL_PIECES) {
      const out = core.assemble({ rulesText: RULES, n, rulesPath: "x".repeat(PATH_PARANOID_CHARS),
                                  appendixTexts: textsFor(c, PATH_PARANOID_CHARS) });
      assert.ok(out.length < CLI_TRUNCATION_CHARS, `조각 ${n} 이 물리 천장에 닿는다: ${out.length}자`);
    }
});

test("자를 문자 수로 쓴다 — 코드 포인트로 재면 안 된다", () => {
  assert.notEqual(RULES.length, [...RULES].length,
    "코어에 서로게이트 쌍이 사라졌다 — 두 자가 같아졌다면 이 검사의 전제를 다시 확인해라");
  assert.ok(RULES.length > [...RULES].length, "문자 수가 코드 포인트보다 커야 한다(그래서 문자 수로 잰다)");
});

// 🛑 이 가드의 기준은 **등록부 바깥**이어야 한다. combos() 는 APPENDICES 에서 만들어지므로
//    combos() 를 APPENDICES 와 대조하면 재료와 결과를 비교하는 것이라 **절대 실패할 수 없다.**
//    실제 위험은 반대 방향이다 — "주입은 되는데 등록이 안 된 부록". 그 상황이 실제로 있었다:
//    feat/v0.65.0 의 activate.js 가 statusboard-appendix.md 를 하드코딩으로 이어 붙였다.
//    rebase 때 그 갈래를 지우고 등록부에 올렸다(하드코딩을 남긴 채 등록만 잊었으면 그 부록은
//    실제로 주입되면서 조합 매트릭스에도 바이트 예산에도 안 잡혔다).
//    그래서 파일 시스템을 기준으로 양방향 대조한다 — 다음 부록에도 같은 문이 열려 있다.
test("src/rules 의 부록 파일과 APPENDICES 등록이 양방향으로 같다", () => {
  const NOT_APPENDIX = new Set(["operating-rules.md"]);   // 규칙 본문. 늘릴 때는 사유를 옆에 적는다.
  const onDisk = readdirSync(join(ROOT, "src", "rules"))
    .filter((f) => f.endsWith(".md") && !NOT_APPENDIX.has(f)).sort();
  const registered = core.APPENDICES.map((a) => a.file).sort();
  assert.deepEqual(registered, onDisk,
    "src/rules 의 부록 파일과 activate-core 의 APPENDICES 가 어긋난다. " +
    "등록 안 된 파일이 있으면 그 부록은 조합 매트릭스도 바이트 예산도 안 지나간다 — " +
    "주입은 되면서 검사에는 안 보이는, 이번 사고와 같은 방향의 구멍이다.");
});

// 위 가드가 못 잡는 것 하나를 적어 둔다: activate.js 가 src/rules 밖의 글(코드 안 문자열 등)을
// 이어 붙이면 파일 목록에 안 나타난다. 그 경우는 test/activate.test.mjs 의 stdout 재구성 대조가 잡는다.
test("조합 생성기가 등록된 부록을 하나도 빠뜨리지 않는다 (생성기 자기검사 — 등록 누락은 위 테스트가 잡는다)", () => {
  const wired = core.APPENDICES.map((a) => a.id).sort();
  const covered = [...new Set(combos().flatMap((c) => c.on))].sort();
  assert.deepEqual(covered, wired, "combos() 가 등록된 부록 중 일부를 안 돈다");
});

// 🛑 변형 이름만 늘리고 render 가 그 이름으로 안 갈라지면, 매트릭스는 늘어나는데 두 칸이 **같은 글**을
//    잰다. 개수만 세는 검사는 그때도 초록이다 — 조합이 늘었다는 사실이 곧 더 재고 있다는 뜻은 아니다.
test("변형은 서로 다른 글을 낸다 — 이름만 늘리고 render 가 안 갈라지면 헛매트릭스다", () => {
  for (const a of core.APPENDICES) {
    const ctx = { boardServer: "x".repeat(PATH_STANDIN_CHARS) };
    const rendered = a.variants.map((v) => a.render(APPENDIX_TEXT[a.id], v, ctx));
    assert.equal(new Set(rendered).size, a.variants.length,
      `부록 "${a.id}" 의 변형 ${a.variants.length}개 중 같은 글을 내는 것이 있다. ` +
      "변형을 늘렸으면 render 가 그 이름으로 갈라져야 한다 — 안 그러면 조합만 늘고 재는 것은 그대로다.");
  }
});

// 훅이 고른 변형이 등록된 이름 안에 있어야 한다. variantOf 가 목록 밖 이름을 내면 render 가
// 기본 갈래로 떨어져 **매트릭스가 한 번도 안 재 본 글**이 실제로 주입된다.
// CTXS 는 등록부의 sampleCtx/sampleCtxOff 에서 뽑는다(손으로 사본을 안 늘린다). 단
// "표식깨짐" 변형(boardMarkersIntact:false)은 어느 등록부 예시에도 없다 — sampleCtx/sampleCtxOff 는
// applies() 참·거짓만 가르면 되고 boardMarkersIntact 값은 안 가르기 때문이다. 그래서 그 한 칸만 따로 둔다.
test("variantOf 는 등록된 변형 이름만 낸다", () => {
  const CTXS = [
    ...core.APPENDICES.flatMap((a) => [a.sampleCtx, a.sampleCtxOff]),
    { env: {}, board: true, boardMarkersIntact: false, boardServer: "x" }, // 표식깨짐 전용
  ];
  for (const a of core.APPENDICES)
    for (const ctx of CTXS)
      assert.ok(a.variants.includes(a.variantOf(ctx)),
        `부록 "${a.id}" 의 variantOf 가 등록 밖 이름 "${a.variantOf(ctx)}" 를 냈다`);
});

// 🛑 등록부의 `applies` 는 어떤 검사도 부르지 않았다 — 그래서 "등록은 됐는데 조건이 영원히
//    거짓이라 한 번도 안 붙는 부록"이 생겨도 볼 자리가 0곳이었다(D-2). sampleCtx/sampleCtxOff 는
//    등록부 자신이 들고 있는 값이라, 검사가 기대값을 스스로 지어내는 자기참조가 아니다 —
//    실제로 applies() 를 두 방향(참·거짓)으로 실행해 결과를 잰다.
// 🛑 정직 회계: 이 두 검사는 `sampleCtx`/`sampleCtxOff` 를 **손으로 쓴 값**으로 잰다. 그 필드를
//    activate.js 가 실제로 채우는지는 안 잰다 — 훅이 안 만드는 필드(예: 아무도 안 읽는 env 이름)를
//    조건이 읽어도 sampleCtx 를 그 조건에 맞춰 나란히 손으로 쓰면 여기서는 계속 초록이다.
//    그 구멍은 훅 stdout 을 직접 재는 test/activate.test.mjs · test/statusboard-activate.test.mjs 가
//    막는다. 아래 "칸 이름이 buildCtx 안에 들어간다" 검사도 칸 **이름**만 맞추지, 훅이 그 조건에
//    맞는 **값**을 실제로 채우는지는 못 잰다.
test("등록부의 모든 칸에 applies 를 참으로 만드는 예시가 있다 — 없으면 그 부록은 영원히 안 붙어도 못 잡는다", () => {
  for (const a of core.APPENDICES) {
    assert.ok(a.sampleCtx, `부록 "${a.id}" 에 sampleCtx 가 없다 — applies 조건을 참으로 만드는 예시 ctx 를 등록부에 추가해라.`);
    assert.equal(a.applies(a.sampleCtx), true,
      `부록 "${a.id}" 의 sampleCtx 로 applies() 를 불렀는데 참이 아니다 — ` +
      "이 조건은 실제로 한 번도 참이 될 수 없을 가능성이 있다(영원히 안 붙는 부록). " +
      "또는 applies 가 true/false 가 아닌 값을 냈다(이 검사는 엄격한 boolean 을 요구한다 — " +
      "훅(activate.js)은 `if (!applies(ctx))` 라 truthy 면 충분하지만, 이 검사는 그보다 엄격하다).");
  }
});

test("등록부의 모든 칸에 applies 를 거짓으로 만드는 예시도 있다 — 한쪽만 재면 조건을 아무 값으로나 바꿔도 초록이다", () => {
  for (const a of core.APPENDICES) {
    assert.ok(a.sampleCtxOff, `부록 "${a.id}" 에 sampleCtxOff 가 없다 — applies 조건을 거짓으로 만드는 예시 ctx 를 등록부에 추가해라.`);
    assert.equal(a.applies(a.sampleCtxOff), false,
      `부록 "${a.id}" 의 sampleCtxOff 로 applies() 를 불렀는데 거짓이 아니다 — ` +
      "조건이 거짓을 낼 수 없다면(늘 붙는 부록이라면) 등록부에서 그 사실을 밝히고 이 검사를 그에 맞게 고쳐야 한다. " +
      "또는 applies 가 true/false 가 아닌 값을 냈다(이 검사는 엄격한 boolean 을 요구한다 — " +
      "훅(activate.js)은 `if (!applies(ctx))` 라 falsy 면 충분하지만, 이 검사는 그보다 엄격하다).");
  }
});

// [medium] 처방: sampleCtx/sampleCtxOff 의 칸 **이름**이 진짜 ctx(buildCtx 결과) 칸 이름 안에
// 들어가는지 대조한다. 새 부록이 진짜 ctx 에 없는 필드(오타·상상 필드)를 예시에 적으면 여기서 잡는다.
// 🛑 이 검사가 못 잡는 것: 칸 **이름**만 맞추지, 훅이 그 조건에 맞는 **값**을 실제로 채우는지는
//    안 잰다(위 정직 회계 참고).
test("sampleCtx·sampleCtxOff 의 칸 이름이 진짜 ctx(buildCtx) 칸 안에 들어간다", () => {
  const realKeys = Object.keys(core.buildCtx({ env: {}, board: false, boardMarkersIntact: true, boardServer: "" }));
  for (const a of core.APPENDICES) {
    for (const key of Object.keys(a.sampleCtx))
      assert.ok(realKeys.includes(key),
        `부록 "${a.id}" 의 sampleCtx 에 진짜 ctx 에 없는 칸 "${key}" 이 있다. ` +
        `진짜 칸은 ${realKeys.join(", ")} 뿐이다.`);
    for (const key of Object.keys(a.sampleCtxOff))
      assert.ok(realKeys.includes(key),
        `부록 "${a.id}" 의 sampleCtxOff 에 진짜 ctx 에 없는 칸 "${key}" 이 있다. ` +
        `진짜 칸은 ${realKeys.join(", ")} 뿐이다.`);
  }
});

// ── 자리 참조 가드 ───────────────────────────────────────────────────────────
// 🛑 대상은 안전 캡슐 절이 아니라 **주입되는 글 전체**(코어 + 등록된 부록)다. 조각은 순서가
//    섞이므로 어느 절에서든 "위/아래/끝에" 는 거짓이 될 수 있다. 캡슐만 지키면 다음 자리 참조는
//    다른 절에서 들어오고, 코어만 지키면 부록에서 들어온다(실제로 부록에 하나 있었다 —
//    unattended-appendix.md:3 의 "위 코어". 실측에서 부록 조각이 **첫 번째로 도착한** 시행이 있어
//    그 "위" 는 이미 거짓이 될 수 있는 상태였다).
// 예외는 "위치를 안 가리키는 4건"뿐이고, 이름과 **뜻**을 붙여 목록으로 둔다(2026-08-12 실측).
// `\s*` 가 아니라 `[ \t]*` 인 이유: `\s` 는 줄바꿈을 먹어서, 한 문단이 "…적용 범위"로 끝나고
// 다음 문단이 "규칙은…"으로 시작하면 **문단 경계를 건너뛰어** 자리 참조로 잡힌다(pr-reviewer 1차 low).
// 자리 참조는 한 문장 안에서 붙어 나오는 말이라 줄바꿈을 넘길 이유가 없다.
const LOCATION_RE = /\b(above|below|earlier|later|preceding|following|at the end|at the top|at the bottom)\b|(?:위|앞|아래)[ \t]*(?:코어|절|부록|규칙|문단|항목|줄|글)|마지막에|끝에/gi;
// ⚠ 정직 회계 — 이 그물이 **못 잡는 것**: 한국어의 자유로운 자리 표현("위에 있는 그 규칙",
//    "앞서 말한", "뒤에 나오는")은 낱말 목록에 없어 안 걸린다. 넓히려다 "그 위에서"(논리적
//    '그 위에'·부록 5행) 같은 정상 문장을 오탐해 예외 목록만 늘리는 쪽이 더 나쁘다고 봤다.
//    이건 자물쇠가 아니라 그물이고, 최종 방어선은 이 주석을 읽는 사람이다.
const ALLOWED = [
  "later touching",        // 시간 — 작업 도중 나중에
  "medium and above",      // 등급 — 심각도
  "above the floor",       // 기준선 — 안전 바닥 위
  "never below the worker",// 등급 — 심판 모델
  "답장 끝에"              // 답장 안의 자리 — 규칙 조각의 도착 순서와 무관하다
];
const SCANNED = ["operating-rules.md", ...core.APPENDICES.map((a) => a.file)];

test("규칙 본문·부록 어디에도 자리 참조가 없다 — 조각은 도착 순서가 섞인다", () => {
  const joined = SCANNED.map((f) => readFileSync(join(ROOT, "src", "rules", f), "utf8")).join("\n");
  for (const ok of ALLOWED)
    assert.ok(joined.includes(ok), `예외 목록의 "${ok}" 가 본문에서 사라졌다 — 목록을 정리해라`);
  for (const f of SCANNED) {
    let scanned = readFileSync(join(ROOT, "src", "rules", f), "utf8");
    for (const ok of ALLOWED) scanned = scanned.split(ok).join("");   // 이름 붙인 예외만 먼저 뗀다
    const hits = [...scanned.matchAll(LOCATION_RE)].map((m) => m[0]);
    assert.deepEqual(hits, [],
      `${f} 에 자리로 가리키는 말이 남아 있다: ${hits.join(", ")}. ` +
      "조각 도착 순서가 섞이면 그 문장은 거짓이 된다 — 자리 대신 절 이름으로 가리켜라. " +
      "위치를 안 가리키는 말(등급·시간·기준선)이면 ALLOWED 에 **뜻을 적어** 더해라.");
  }
});

test("안전 캡슐은 이름으로 가리키고, 새 문구가 그대로 있다", () => {
  const capsule = core.sectionsOf(RULES).find((s) => s.heading.includes("Safety capsule")).text;
  assert.ok(capsule.includes("(the named section in each line is the single source)."),
    "T6 에서 못 박은 문구가 바뀌었다 — 자리 낱말을 다시 넣지 않았는지 확인해라");
  assert.ok(capsule.includes("Full text: Stop rules"), "이름 기반 참조가 사라졌다");
});

// 조각 하나만 죽으면 나머지가 정상 도착해 **세션이 완전히 정상으로 보인다.** 조각 4(멈춤·검증·보안)나
// 5(안전 캡슐)가 그 하나면 안전 규칙만 조용히 빠진 세션이 된다. 번호의 빈칸은 눈에 안 띄지만
// 이름의 빈칸은 띈다 — 그래서 머리말이 다섯 조각의 **이름**을 함께 들고 다닌다(pr-reviewer 1차 medium).
test("머리말이 조각 명단을 이름까지 들고 있다 — 조각을 늘리면 명단도 따라 늘어난다", () => {
  for (const n of [...core.PIECES.map((p) => p.n), APPENDIX_PIECE]) {
    const head = core.assemble({ rulesText: RULES, n, rulesPath: "/x/rules.md",
                                 appendixTexts: [APPENDIX_TEXT[core.APPENDICES[0].id]] }).split("\n\n")[0];
    for (const p of core.PIECES)
      assert.ok(head.includes(`${p.n} ${p.label}`),
        `조각 ${n} 머리말에 "${p.n} ${p.label}" 이 없다. 명단은 PIECES 에서 뽑아야 한다 — ` +
        "손으로 적으면 조각을 늘렸을 때 명단이 안 따라 늘고, 빠진 조각을 이름으로 못 알아본다.");
  }
});

test("배선 개수와 조각 개수가 같다 — 조각을 늘리고 배선을 안 늘리면 그 조각은 영원히 안 나간다", () => {
  const wiring = JSON.parse(readFileSync(join(ROOT, "src", "hooks", "hooks.claude.json"), "utf8"));
  const cmds = wiring.hooks.SessionStart.flatMap((g) => g.hooks).map((h) => h.command)
    .filter((c) => c.includes("activate.js"));
  assert.equal(cmds.length, core.PIECES.length + 1, "조각 5개 + 부록 1개 = 6개가 배선돼야 한다");
  const args = cmds.map((c) => c.trim().split(/\s+/).pop()).sort();
  assert.deepEqual(args, ["1", "2", "3", "4", "5", "6"], "조각 번호가 빠지거나 겹친다");
});
