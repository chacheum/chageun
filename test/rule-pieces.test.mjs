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
function textsFor(c) {
  return core.APPENDICES.filter((a) => c.on.includes(a.id)).map((a) => APPENDIX_TEXT[a.id]);
}

// 2026-08-12 실측(손으로 세지 않았다 — 위 combos()·core.assemble() 로 뽑았다).
// 조합 2가지: unattended:꺼짐 / unattended:only. 가장 빡빡한 조각은 4번(여유 1,695자)이다.
//   조각 | 본문  | 정책(경로256) | 8,000 여유 | 물리(경로1024)
//    1   | 5597  |  6014         | 1986       | 6782
//    2   | 3865  |  4280         | 3720       | 5048
//    3   | 2695  |  3112         | 4888       | 3880
//    4   | 5884  |  6305         | 1695       | 7073
//    5   | 1387  |  1804         | 6196       | 2572
//    6   |    0  |     0         | 8000       |    0   (평시 — 조건 안 맞음)
//    6   | 3114  |  3494         | 4506       | 4262   (무인)
// 여유 근거: 이 저장소가 한 번에 넣은 규칙 덩어리의 역대 최대는 출력 스타일 절 1,674자다.
// 조각 4의 여유 1,695자는 그보다 21자 크다 — 역대 최대 덩어리를 가장 빡빡한 조각에 통째로
// 넣으면 8,000을 넘어 빨간불이 뜨고, 10,000에는 한참 못 닿는다. 즉 검사를 지나쳐
// 조용히 잘리는 경로가 없다. 이게 이 숫자의 전부다.
test("조건 조합을 전부 돌아도 조각 하나가 8,000자를 안 넘는다", () => {
  for (const c of combos())
    for (const n of ALL_PIECES) {
      const out = core.assemble({ rulesText: RULES, n, rulesPath: "x".repeat(PATH_STANDIN_CHARS),
                                  appendixTexts: textsFor(c) });
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
                                  appendixTexts: textsFor(c) });
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
//    실제 위험은 반대 방향이다 — "주입은 되는데 등록이 안 된 부록". 그 상황이 지금 옆 브랜치에
//    실재한다: feat/v0.65.0 의 activate.js 가 statusboard-appendix.md 를 하드코딩으로 이어 붙인다.
//    rebase 하는 사람이 그 갈래를 남긴 채 등록만 잊으면 그 부록은 실제로 주입되면서
//    조합 매트릭스에도 바이트 예산에도 안 잡힌다. 그래서 파일 시스템을 기준으로 양방향 대조한다.
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

// ── 자리 참조 가드 ───────────────────────────────────────────────────────────
// 🛑 대상은 안전 캡슐 절이 아니라 **주입되는 글 전체**(코어 + 등록된 부록)다. 조각은 순서가
//    섞이므로 어느 절에서든 "위/아래/끝에" 는 거짓이 될 수 있다. 캡슐만 지키면 다음 자리 참조는
//    다른 절에서 들어오고, 코어만 지키면 부록에서 들어온다(실제로 부록에 하나 있었다 —
//    unattended-appendix.md:3 의 "위 코어". 실측에서 부록 조각이 **첫 번째로 도착한** 시행이 있어
//    그 "위" 는 이미 거짓이 될 수 있는 상태였다).
// 예외는 "위치를 안 가리키는 4건"뿐이고, 이름과 **뜻**을 붙여 목록으로 둔다(2026-08-12 실측).
const LOCATION_RE = /\b(above|below|earlier|later|preceding|following|at the end|at the top|at the bottom)\b|(?:위|앞|아래)\s*(?:코어|절|부록|규칙|문단|항목|줄|글)|마지막에|끝에/gi;
// ⚠ 정직 회계 — 이 그물이 **못 잡는 것**: 한국어의 자유로운 자리 표현("위에 있는 그 규칙",
//    "앞서 말한", "뒤에 나오는")은 낱말 목록에 없어 안 걸린다. 넓히려다 "그 위에서"(논리적
//    '그 위에'·부록 5행) 같은 정상 문장을 오탐해 예외 목록만 늘리는 쪽이 더 나쁘다고 봤다.
//    이건 자물쇠가 아니라 그물이고, 최종 방어선은 이 주석을 읽는 사람이다.
const ALLOWED = [
  "later touching",        // 시간 — 작업 도중 나중에
  "medium and above",      // 등급 — 심각도
  "above the floor",       // 기준선 — 안전 바닥 위
  "never below the worker" // 등급 — 심판 모델
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

test("배선 개수와 조각 개수가 같다 — 조각을 늘리고 배선을 안 늘리면 그 조각은 영원히 안 나간다", () => {
  const wiring = JSON.parse(readFileSync(join(ROOT, "src", "hooks", "hooks.claude.json"), "utf8"));
  const cmds = wiring.hooks.SessionStart.flatMap((g) => g.hooks).map((h) => h.command)
    .filter((c) => c.includes("activate.js"));
  assert.equal(cmds.length, core.PIECES.length + 1, "조각 5개 + 부록 1개 = 6개가 배선돼야 한다");
  const args = cmds.map((c) => c.trim().split(/\s+/).pop()).sort();
  assert.deepEqual(args, ["1", "2", "3", "4", "5", "6"], "조각 번호가 빠지거나 겹친다");
});
