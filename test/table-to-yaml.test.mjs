// test/table-to-yaml.test.mjs — table-to-yaml.mjs is ESM, so import it (do NOT createRequire a .mjs).
//
// 이 스크립트가 지켜야 하는 약속은 하나다: **내용을 한 글자도 잃지 않는다.**
// 그래서 테스트도 "잘 옮겼나"가 아니라 "잃은 게 없나"를 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, toYaml, verify, render } from "../src/skills/product-map/table-to-yaml.mjs";

const HEAD = "| ID | 기능명 | 설명 | 사용자 | 우선순위 | 상태 | 관련 화면 | 비고 |";
const SEP = "|----|--------|------|--------|----------|------|-----------|------|";
const doc = (...rows) => ["# 기능 명세", "", HEAD, SEP, ...rows, "", "## 검증 체크리스트"].join("\n");

test("칸 8개짜리 정상 행은 이름표만 붙여 그대로 옮긴다", () => {
  const { feats, fatal, warn } = convert(doc("| F-01 | 회원가입 | 계정 생성 | 비로그인 | 높음 | 완료 | 인증/가입 | 메모 |"));
  assert.deepEqual(fatal, []);
  assert.deepEqual(warn, []);
  assert.equal(feats.length, 1);
  assert.deepEqual(feats[0], {
    id: "F-01", 기능명: "회원가입", 설명: "계정 생성", 사용자: "비로그인",
    우선순위: "높음", 상태: "완료", 화면: "인증/가입", 비고: "메모",
  });
});

test("설명에 `|` 가 섞여 밀린 행은 우선순위+상태를 닻으로 복원한다", () => {
  // 이게 표를 버리는 이유다. 사람 눈엔 멀쩡한 표인데 `화면` 칸에 `비고` 가 들어가 있다.
  const { feats, fatal, warn } = convert(doc("| F-02 | 가격 | A | B | 사용자 | 중간 | 개발중 | 대시보드 | 메모 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].설명, "A | B", "잘려 나간 `|` 를 되살려야 한다");
  assert.equal(feats[0].사용자, "사용자");
  assert.equal(feats[0].화면, "대시보드");
  assert.equal(feats[0].비고, "메모");
  assert.ok(warn.some((w) => w.startsWith("F-02: 칸이 9개였다")), "복원했으면 사람이 볼 수 있게 알려야 한다");
});

test("비고에 `|` 가 섞여 밀린 행도 복원한다(밀린 자리를 미리 가정하지 않는다)", () => {
  const { feats, fatal } = convert(doc("| F-03 | 알림 | 설명 | 사용자 | 낮음 | 기획중 | 설정 | 가 | 나 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].설명, "설명");
  assert.equal(feats[0].비고, "가 | 나");
});

test("닻을 못 찾으면 손으로 고치라고 멈춘다 — 짐작으로 옮기지 않는다", () => {
  const { fatal, out } = render(doc("| F-04 | 이름 | 설 | 명 | 사용자 | 뭔가 | 이상함 | 화면 | 비고 |"));
  assert.equal(fatal.length, 1);
  assert.match(fatal[0], /F-04: 칸이 9개인데 닻/);
  assert.equal(out, null, "어긋난 게 있으면 아무것도 안 쓴다");
});

test("규격 밖 상태·우선순위는 고치지 않고 경고만 남긴다(내용 보존이 먼저)", () => {
  const { feats, fatal, warn } = convert(doc("| F-05 | 이름 | 설명 | 사용자 | 큰 | 폐기 | 화면 | 비고 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].우선순위, "큰");
  assert.equal(feats[0].상태, "폐기");
  assert.equal(warn.length, 2, "상태·우선순위 각각 한 줄");
});

test("YAML 특수문자가 든 값은 따옴표로 감싸 되읽어도 같다", () => {
  const rows = [
    '| F-06 | 할인 | 가격: 10% 할인 | 사용자 | 높음 | 완료 | 화면 | # 주석처럼 보임 |',
    '| F-07 | 대시 | -로 시작 | 사용자 | 높음 | 완료 | 화면 |  |',
  ];
  const { feats, fatal } = convert(doc(...rows));
  assert.deepEqual(fatal, []);
  const yaml = toYaml(feats);
  assert.deepEqual(verify(feats, yaml), [], "되돌림 대조가 완전 일치여야 한다");
  assert.match(yaml, /설명: "가격: 10% 할인"/);
  assert.match(yaml, /비고: ""/, "빈 값도 칸을 비우지 않고 적는다");
});

test("표 밖 텍스트는 한 글자도 안 건드린다 — 뒤에 있는 다른 표까지 포함", () => {
  // 실측 사고: 기능 표 머리를 본 뒤로 모든 구분선을 지우게 짜서, 본문 뒤쪽의 무관한 표가 조용히 깨졌다.
  const other = ["| 회차 | 지적 |", "|---|---|", "| 1 | 둘 |"];
  const text = [
    "# 기능 명세", "", HEAD, SEP,
    "| F-08 | 이름 | 설명 | 사용자 | 높음 | 완료 | 화면 | 비고 |",
    "", "## 회차 통계", "", ...other, "", "끝.",
  ].join("\n");
  const { out, fatal, diffs } = render(text);
  assert.deepEqual(fatal, []);
  assert.deepEqual(diffs, []);
  // `includes` 로 보면 줄이 중복되거나 자리가 바뀌어도 통과한다 — 배열로 통째 비교한다.
  const lines = out.split("\n");
  const at = lines.indexOf("```yaml");
  const end = lines.indexOf("```", at + 1);
  const rest = [...lines.slice(0, at), ...lines.slice(end + 1)];
  assert.deepEqual(rest, ["# 기능 명세", "", "", "## 회차 통계", "", ...other, "", "끝."]);
  assert.match(out, /```yaml\n#[^\n]*\n(?:#[^\n]*\n)*features:\n/, "표 자리에 안내 주석 + YAML 블록이 들어가야 한다");
});

test("[high] 기능 행을 하나도 못 알아본 파일을 초록불로 덮어쓰지 않는다", () => {
  // 실측 2026-08-10: 행 ID 가 `F-01` 모양이 아니면(한글 편집기가 바꾼 U+2011 하이픈 등) 행 인식이
  // 통째로 실패하는데, 그때도 fatal 0 · diffs 0 으로 나와 **표 머리만 지운 파일**을 썼다.
  const { feats, fatal, out } = render(doc("| F‑01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |"));
  assert.equal(feats.length, 0);
  assert.equal(out, null, "한 줄도 못 읽었으면 아무것도 쓰지 않는다");
  assert.ok(fatal.some((x) => /표 안에 있는데 기능 행으로 못 읽었다/.test(x)), fatal.join(" / "));
});

test("[high] 표 안의 일부 줄만 알아본 경우에도 멈춘다", () => {
  const { feats, fatal, out } = render(doc(
    "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "| F02 | 두번째 | 설명 | u | 높음 | 완료 | 화면 | 비고 |"));
  assert.equal(feats.length, 1);
  assert.equal(out, null, "17행 중 3행만 옮기고 나머지를 고아 텍스트로 남기지 않는다");
  assert.ok(fatal.some((x) => x.includes("F02")), fatal.join(" / "));
});

test("표 영역이 비면 멈춘다 — `기능 0개 · ✅ 이상 없음` 이 나오지 않는다", () => {
  const { fatal, out } = render(["# x", "", HEAD, SEP, "", "## 뒤"].join("\n"));
  assert.equal(out, null);
  assert.ok(fatal.some((x) => x.includes("기능 행이 0개")), fatal.join(" / "));
});

test("표 중간의 빈 줄은 기능 행이 다시 이어질 때만 표 안으로 본다", () => {
  // 실제 파일이 이렇게 생겼다(2026-08-10 이 저장소 기능 명세: 17행 + 빈 줄 + 8행).
  const { feats, fatal } = convert(doc(
    "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "",
    "| F-02 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats.length, 2, "빈 줄로 갈린 뒷토막도 같은 표다");
});

test("빈 줄 다음이 기능 행이 아니면 거기서 표가 끝난다", () => {
  const { out, fatal } = render([
    "# x", "", HEAD, SEP, "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "", "본문 문단", "",
  ].join("\n"));
  assert.deepEqual(fatal, []);
  assert.ok(out.includes("본문 문단"));
});

test("`| ID |` 표가 두 개면 뒤엣것을 건드리지 않는다 — 앞 표만 옮긴다", () => {
  // 표 머리를 파일 전역에서 찾던 판은 `tableAt` 이 뒤 표로 옮겨가 **앞 표의 머리를 지웠다.**
  const second = ["| ID | 의심 | 근거 |", "|---|---|---|", "| 3 | 고아 화면 | 링크 없음 |"];
  const { out, fatal } = render([
    "# x", "", HEAD, SEP, "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "", "## 의심", "", ...second, "",
  ].join("\n"));
  assert.deepEqual(fatal, []);
  for (const l of second) assert.ok(out.includes(l), `뒤 표가 깨졌다: ${l}`);
});

test("기능 행처럼 생긴 줄이 표 밖에 남아 있으면 멈춘다 — 표가 끊긴 신호다", () => {
  const { fatal, out } = render([
    "# x", "", HEAD, SEP, "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "", "잘못 끼어든 문단", "", "| F-02 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |", "",
  ].join("\n"));
  assert.equal(out, null);
  assert.ok(fatal.some((x) => x.includes("표 밖에 있다")), fatal.join(" / "));
});

test("닻 후보가 둘 이상이면 고르지 않고 멈춘다", () => {
  // 첫 매치를 취하면 틀려도 아무 신호가 안 남는다. 규격 밖 값까지 닻으로 인정하는 대가다.
  const { fatal, out } = render(doc("| F-05 | 이름 | 설1 | 설2 | 높음 | 완료 | 설3 | 사용자 | 높음 | 완료 | 화면 | 비고 |"));
  assert.equal(out, null);
  assert.ok(fatal.some((x) => x.includes("후보가 2군데")), fatal.join(" / "));
});

test("밀린 줄 경고에 '이 복원은 가정이다'가 들어간다", () => {
  // `|` 가 화면·기능명·사용자에 있었으면 복원이 틀리는데 칸 복원 대조는 통과한다. 유일한 방어가 이 문구다.
  const { warn, fatal } = convert(doc("| F-04 | 이름 | 설명 | 사용자 | 높음 | 완료 | 대시보드 | 설정 | 비고 |"));
  assert.deepEqual(fatal, []);
  assert.ok(warn[0].includes("화면·기능명·사용자에 있었다면 틀리니"), warn[0]);
});

test("특수문자가 없어도 다른 뜻으로 읽히는 값은 따옴표로 감싼다", () => {
  // YAML 은 `2026-09-01`=날짜 · `no`=거짓 · `~`=빈 값 · `007`=숫자로 읽는다. 지금은 글로 읽으니 티가
  // 안 나지만, 나중에 이 파일을 기계가 읽으면 문자열 비교가 조용히 어긋난다.
  const { feats, fatal } = convert(doc(
    "| F-07 | 이름 | no | u | 높음 | 완료 | 화면 | 2026-09-01 |",
    "| F-08 | 007 | ~ | u | 높음 | 완료 | 화면 | &모듈 참고 |"));
  assert.deepEqual(fatal, []);
  const yaml = toYaml(feats);
  for (const q of ['설명: "no"', '비고: "2026-09-01"', '기능명: "007"', '설명: "~"', '비고: "&모듈 참고"'])
    assert.ok(yaml.includes(q), `따옴표가 안 붙었다: ${q}`);
  assert.deepEqual(verify(feats, yaml), []);
});

test("구분선 뒤에 공백이 있거나 CRLF 여도 구분선으로 알아본다", () => {
  const { out, fatal } = render(["# x", "", HEAD, SEP + "  ", "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |", ""].join("\r\n"));
  assert.deepEqual(fatal, []);
  assert.ok(!out.includes("|----"), "구분선이 본문에 남으면 안 된다");
});

test("위쪽에 다른 ```yaml 블록이 있어도 헷갈리지 않는다", () => {
  const { out, fatal } = render(["# x", "", "```yaml", "예시: 1", "```", "", HEAD, SEP,
    "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |", ""].join("\n"));
  assert.deepEqual(fatal, []);
  assert.ok(out.includes("예시: 1"), "앞선 예시 블록은 그대로 남아야 한다");
});

test("값에 `$&` 가 있어도 그대로 남는다 — 조립 단계에서 잃었던 자리", () => {
  // 실측 2026-08-10: `String.replace` 로 자리 표시 문자열을 바꾸던 판이 값 안의 `$&` 를 그 자리 표시
  // 문자열로 바꿔치기했다. 앞의 세 겹 대조는 전부 조립 **전** 값만 봐서 못 잡았다.
  const { out, fatal, diffs } = render(doc("| F-10 | 치환 | 치환값의 `$&` 가 확장됐다 | u | 높음 | 완료 | 화면 | `$1`·`$'` 도 위험 |"));
  assert.deepEqual(fatal, []);
  assert.deepEqual(diffs, []);
  assert.ok(out.includes("치환값의 `$&` 가 확장됐다"), "설명의 `$&` 가 그대로 남아야 한다");
  assert.ok(out.includes("`$1`·`$'` 도 위험"), "비고의 `$1`·`$'` 도 그대로 남아야 한다");
});

test("기능 표가 없는 파일은 옮길 대상이 아니라고 멈춘다", () => {
  const { fatal, out } = render("# 그냥 문서\n\n표 없음.\n");
  assert.equal(fatal.length, 1);
  assert.equal(out, null);
});

test("되돌림 대조는 값이 실제로 달라졌을 때 잡아낸다", () => {
  // 대조가 늘 초록이면 대조가 아니다 — 일부러 어긋난 YAML 을 물려 잡는지 본다.
  const feats = [{ id: "F-09", 기능명: "이름", 설명: "원본", 사용자: "u", 우선순위: "높음", 상태: "완료", 화면: "s", 비고: "" }];
  const broken = toYaml(feats).replace("설명: 원본", "설명: 바뀜");
  const diffs = verify(feats, broken);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /F-09 · 설명/);
});
