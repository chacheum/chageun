// test/table-to-yaml.test.mjs — table-to-yaml.mjs is ESM, so import it (do NOT createRequire a .mjs).
//
// 이 스크립트가 지켜야 하는 약속은 하나다: **내용을 한 글자도 잃지 않는다.**
// 그래서 테스트도 "잘 옮겼나"가 아니라 "잃은 게 없나"를 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, toYaml, verify, render, assembledIssues, splitCells, rowRestoreOk } from "../src/skills/product-map/table-to-yaml.mjs";

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

// 🛑 v0.67.0 T7: `PRIO_SEEN` 의 마지막 항목(긴 줄표 U+2014)은 **판정 값**이다. 옛 지도 표에는 우선순위 칸이
//    한 글자로 적힌 줄이 있고, 그 줄을 닻으로 인식해 복원하려고 집합에 넣어 둔 값이다.
//    T7 이 소스의 긴 줄표를 걷어내는 판이라 **여기까지 하이픈으로 바뀌면** `"-"` 가 두 번 들어가
//    실질 항목이 하나 줄고, 우선순위 칸이 긴 줄표인 밀린 줄을 닻으로 못 찾아 "손으로 고쳐야 한다"로
//    빠진다. 그런데 그 사고를 잡는 칸이 하나도 없었다(전수 확인 - 이 파일의 긴 줄표는 전부 테스트
//    이름과 주석이고, 긴 줄표 우선순위 칸을 쓰는 픽스처가 없었다). 이 픽스처가 그 자리를 지킨다.
test("우선순위 칸이 긴 줄표 한 글자인 밀린 줄도 닻으로 인정한다(PRIO_SEEN 의 판정 값)", () => {
  const { feats, fatal } = convert(doc("| F-40 | 가격 | A | B | 사용자 | — | 개발중 | 대시보드 | 메모 |"));
  assert.deepEqual(fatal, [],
    "PRIO_SEEN 에서 긴 줄표를 빼면 이 줄의 닻을 못 찾아 변환이 멈춘다(옛 지도 줄이 조용히 유실된다)");
  assert.equal(feats[0].설명, "A | B", "잘려 나간 `|` 를 되살려야 한다");
  assert.equal(feats[0].우선순위, "—", "규격 밖 값도 고치지 않고 그대로 보존한다");
  assert.equal(feats[0].상태, "개발중");
  assert.equal(feats[0].화면, "대시보드");
  assert.equal(feats[0].비고, "메모");
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

test("조립 후 대조는 실제로 실패할 수 있다 — 표 밖 줄을 망가뜨리면 잡는다", () => {
  // 2026-08-10 2차 리뷰: 앞 판은 끼워 넣은 결과를 끼워 넣기 입력과 비교해 **어떤 입력에서도 실패할 수
  // 없었다.** 그런데 스킬 문서는 "기계가 본다"고 약속해 사람은 눈으로 안 본다. 그래서 검사를 함수로 빼
  // 일부러 망가뜨려 본다 — 이 테스트가 통과해야 위 4번째 겹이 검사라고 말할 수 있다.
  const src = ["머리말", "| ID |", "| F-01 | … |", "꼬리말"];
  const block = ["```yaml", "features: []", "```"];
  const base = { src, tableFrom: 1, tableTo: 3, tableAt: 1, block };
  assert.deepEqual(assembledIssues({ ...base, out: ["머리말", ...block, "꼬리말"].join("\n") }), [], "멀쩡하면 조용하다");

  const dropped = assembledIssues({ ...base, out: ["머리말", ...block].join("\n") });
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /표 밖 줄 수가 원본과 다르다\(2 → 1\)/);

  const changed = assembledIssues({ ...base, out: ["머리말", ...block, "꼬리말이 바뀜"].join("\n") });
  assert.equal(changed.length, 1);
  assert.match(changed[0], /표 밖 2번째 줄이 원본과 달라졌다/);

  const badBlock = assembledIssues({ ...base, out: ["머리말", "```yaml", "다른 것", "```", "꼬리말"].join("\n") });
  assert.equal(badBlock.length, 1);
  assert.match(badBlock[0], /YAML 블록을 도로 못 꺼냈다/);
});

test("빈 줄 뒤에 ID 가 어긋난 줄이 와도 표 안으로 보고 멈춘다", () => {
  // 앞 판은 빈 줄 다음이 **잘 생긴 기능 행**일 때만 표를 이었다. 어긋난 줄이 오면 표가 끝난 줄 알고
  // 그 아래를 본문으로 넘겼는데, 표 밖 검사는 잘 생긴 행만 찾으므로 아무도 안 봤다(1차 high 의 좁은 통로).
  const { out, fatal } = render(doc(
    "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "",
    "| F02 | 두번째 | 설명 | u | 높음 | 완료 | 화면 | 비고 |"));
  assert.equal(out, null);
  assert.ok(fatal.some((x) => x.includes("F02")), fatal.join(" / "));
});

test("행이 `|` 로 안 끝나면 멈춘다 — 마지막 칸이 잘려 사라지는 자리", () => {
  // 칸이 9개였던 밀린 행이 닫는 `|` 를 잃으면 잘린 뒤 정확히 8칸이 되어 "정상 행"으로 통과한다.
  // 없어진 조각은 어느 대조도 못 본다 — 이미 아무 데도 없기 때문이다.
  const { out, fatal } = render(doc("| F-12 | 알림 | 채널 | 빈도 | 사용자 | 높음 | 완료 | 설정 | 후속은 v2"));
  assert.equal(out, null);
  assert.ok(fatal.some((x) => x.includes("`|` 로 안 끝난다")), fatal.join(" / "));
});

test("빈 줄 뒤가 새 표면 거기서 끝난다 — 머리 이름이 아니라 모양으로 가른다", () => {
  // 2026-08-10 3차: 종료 조건이 `| ID |` 라는 **이름**뿐이라, `| 항목 | 값 |` 같은 옆 표가 통째로
  // 빨려 들어가 정상 파일이 거부됐다. 게다가 안내문이 "그 줄을 지워라"로 읽혀 멀쩡한 표를 지우게 했다.
  const ROW = "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |";
  for (const second of [
    ["| 상태 | 개수 |", "|---|---|", "| 완료 | 3 |"],          // ID 칸 없는 옆 표
    ["| ID | 의심 | 근거 |", "|---|---|---|", "| 3 | 고아 | 없음 |"],
  ]) {
    const { out, fatal } = render(["# x", "", HEAD, SEP, ROW, "", ...second, ""].join("\n"));
    assert.deepEqual(fatal, [], `정상 파일이 거부됐다: ${second[0]}`);
    for (const l of second) assert.ok(out.includes(l), `뒤 표가 깨졌다: ${l}`);
  }
});

test("표 안에서 못 읽은 줄과 표 밖 기능 행은 서로 다른 안내를 준다", () => {
  const inside = render(doc(
    "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "",
    "| F02 | 둘 | 설명 | u | 높음 | 완료 | 화면 | 비고 |")).fatal[0];
  assert.match(inside, /사이에 제목이나 문단을 한 줄 넣어라/, "옆 표를 지우라고 읽히면 안 된다");
  // 표 밖 검사는 표 **아래쪽만** 훑는다. 안내가 "표 위로 옮겨라"라고 하면 그 줄은 안 옮겨진 채
  // 네 겹이 전부 초록불이 된다 — 안내가 검사 사각으로 사람을 보내면 안 된다(4차 리뷰).
  const outside = render([
    "# x", "", HEAD, SEP, "| F-01 | 이름 | 설명 | u | 높음 | 완료 | 화면 | 비고 |",
    "", "문단", "", "| F-02 | 둘 | 설명 | u | 높음 | 완료 | 화면 | 비고 |", "",
  ].join("\n")).fatal[0];
  assert.match(outside, /표가 아니라 예시라면/);
  for (const m of [inside, outside])
    assert.ok(!m.includes("표 위로"), `검사가 안 보는 자리로 보내면 안 된다: ${m}`);
});

test("표 자리 계산이 어긋나면 조립 후 대조가 비교를 시작하지 않는다", () => {
  const issues = assembledIssues({
    src: ["a", "| ID |", "b"], tableFrom: 1, tableTo: 2, tableAt: 0,
    block: ["```yaml", "features: []", "```"], out: "x",
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /표 자리 계산이 어긋났다\(0 ≠ 1\)/);
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

// ── 밀린 행을 다시 이을 때 `|` 양옆 공백이 사라지던 자리 (2026-08-10 실사고) ──────────────
// 한 실무 프로젝트 지도의 어느 행에서 `?open=activity|opp` 가 `?open=activity | opp` 로 나갔다.
// fatal 0 · 대조 세 줄 전부 초록이었다 — 셋 다 기준이 "다듬은 값"이라 볼 자리가 없었다.
// 잡은 건 PyYAML 로 원본 표와 행·칸까지 맞춘 바깥 대조뿐이었다.

test("붙어 있던 `|` 는 붙은 채로 되살린다 — 양옆에 공백을 넣지 않는다", () => {
  const { feats, fatal } = convert(doc("| F-30 | 이름 | 플래그(`?open=activity|opp`)로 재마운트 | u | 높음 | 완료 | 화면 | 비고 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].설명, "플래그(`?open=activity|opp`)로 재마운트");
});

test("띄어 있던 `|` 는 띄운 채로 되살린다 — 원본 공백을 그대로 옮긴다", () => {
  const { feats, fatal } = convert(doc("| F-31 | 이름 | 가격|할인 |  여백 | u | 높음 | 완료 | 화면 | 비고 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].설명, "가격|할인 |  여백", "안쪽 공백은 손대지 않는다(바깥만 다듬는다)");
});

test("비고 쪽에 붙어 있던 `|` 도 붙은 채로 되살린다", () => {
  const { feats, fatal } = convert(doc("| F-32 | 이름 | 설명 | u | 높음 | 완료 | 화면 | a|b 참고 |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].비고, "a|b 참고");
});

// 검사가 **실제로 실패할 수 있는지**를 시험한다. 옛 판의 칸 복원 대조는 자기가 만든 문자열을 같은
// 구분자로 도로 쪼개 비교해서 **이어 붙이는 방식이 틀린 건 절대 못 잡았고**, 그래서 위 사고를 통과시켰다.
test("칸 복원 대조는 이어 붙이기에 공백을 섞으면 실패한다", () => {
  const line = "| F-33 | 이름 | 가격|할인 | u | 높음 | 완료 | 화면 | 비고 |";
  const row = splitCells(line);
  const 성실하게 = [row.raw[0], row.raw[1], row.raw.slice(2, 4).join("|"), row.raw[4],
                   row.raw[5], row.raw[6], row.raw[7], row.raw.slice(8).join("|")];
  assert.equal(rowRestoreOk(row, 성실하게), true, "제대로 이었으면 통과해야 한다");

  const 공백을섞으면 = [...성실하게];
  공백을섞으면[2] = row.raw.slice(2, 4).join(" | ");        // 옛 판이 하던 그대로
  assert.equal(rowRestoreOk(row, 공백을섞으면), false, "이게 false 가 아니면 검사가 아니다");
});

test("칸 복원 대조는 조각을 빠뜨리거나 겹쳐 자르면 실패한다", () => {
  const row = splitCells("| F-34 | 이름 | 가 | 나 | u | 높음 | 완료 | 화면 | 비고 |");
  const 성실하게 = [row.raw[0], row.raw[1], row.raw.slice(2, 4).join("|"), row.raw[4],
                   row.raw[5], row.raw[6], row.raw[7], row.raw.slice(8).join("|")];
  assert.equal(rowRestoreOk(row, 성실하게), true);
  assert.equal(rowRestoreOk(row, [...성실하게.slice(0, 2), row.raw[2], ...성실하게.slice(3)]), false, "한 조각을 빠뜨리면 잡아야 한다");
  assert.equal(rowRestoreOk(row, [...성실하게.slice(0, 2), row.raw.slice(2, 5).join("|"), ...성실하게.slice(3)]), false, "같은 조각을 두 번 쓰면 잡아야 한다");
});

test("칸 복원 대조의 `undefined` 가드는 그 가드만이 잡는 자리를 지킨다", () => {
  // 마지막 칸이 원래 **빈 칸**이면 `join` 이 undefined 를 빈 문자열로 써서 이어 붙인 글자가 똑같아진다.
  // 그래서 등호만으로는 못 잡고 가드가 있어야 잡힌다 — 가드를 지우면 이 단언만 빨개진다.
  const row = splitCells("| F-35 | 이름 | 가|나 | u | 높음 | 완료 | 화면 ||");
  const 성실하게 = [row.raw[0], row.raw[1], row.raw.slice(2, 4).join("|"), row.raw[4],
                   row.raw[5], row.raw[6], row.raw[7], row.raw.slice(8).join("|")];
  assert.equal(성실하게[7], "", "이 시험이 성립하려면 마지막 조각이 빈 칸이어야 한다");
  assert.equal(rowRestoreOk(row, 성실하게), true);
  assert.equal(rowRestoreOk(row, [...성실하게.slice(0, 7), undefined]), false, "가드가 없으면 여기서 true 가 나온다");
});

test("칸 복원 대조가 실패하면 **실제로** 파일을 안 쓴다 — 검사와 멈춤이 배선돼 있다", () => {
  // 이 저장소가 세 번 겪은 실패 양식이 "검사는 있는데 아무것도 안 막았다"이다. 함수만 시험하면
  // 함수와 멈춤 **사이의 한 줄**이 비어도 테스트가 초록이다(실측: 그 줄을 지워도 전부 통과했다).
  // 프로덕션에서 이 fatal 을 밟는 입력은 끝 칸이 빠져 닻이 배열 끝에 붙는 행 한 종류다.
  const { fatal, out } = render(doc("| F-40 | 이름 | 설 | 명 | 사 | 용 | 높음 | 완료 | 화면 |"));
  assert.equal(out, null, "어긋났으면 아무것도 안 쓴다");
  assert.equal(fatal.length, 1);
  assert.match(fatal[0], /F-40: 이 줄은 끝 칸이 빠진 것 같다/);
  assert.match(fatal[0], /빈 칸 하나로 닫아/, "무엇을 어떻게 고칠지까지 알려 준다");
  // 붙일 조각을 주면 그 줄은 이미 `|` 로 끝나 칸이 하나 더 생긴다 — 결과 모양으로만 안내한다.
  assert.doesNotMatch(fatal[0], /\(`\| \|`\)를 더 넣어/, "붙일 조각을 그대로 주지 않는다");
});

test("멈춤 문구가 **일부러 쓴 `|` 를 지우라고** 시키지 않는다", () => {
  // 개수를 목표로 주면("칸을 8개로 맞춰라") 설명에 `|` 를 일부러 쓴 줄에서는 그 `|` 와 주변 글자를
  // 지우게 된다 — 스크립트가 막으려는 바로 그 행동이다(2차 리뷰). 그래서 목표는 개수가 아니라 행동이다.
  const { fatal, out } = render(doc("| F-50 | 이름 | a|b | 설 | 명 | u | 높음 | 완료 | 화면 |"));
  assert.equal(out, null);
  assert.equal(fatal.length, 1);
  // 숫자를 글자로 박으면 칸 수가 바뀔 때 이 금지 목록만 옛 숫자를 보게 되어 조용히 약해진다.
  assert.doesNotMatch(fatal[0], /개수를 세어|개가 되게/, "개수를 목표로 주면 안 된다");
  assert.match(fatal[0], /지우지 마라/, "일부러 쓴 `|` 는 건드리지 말라고 해야 한다");
});

test("설명·비고 **양쪽**에 `|` 가 있는 행도 각각 제자리로 되살린다", () => {
  const { feats, fatal } = convert(doc("| F-41 | 이름 | a|b | u | 높음 | 완료 | 화면 | c|d |"));
  assert.deepEqual(fatal, []);
  assert.equal(feats[0].설명, "a|b");
  assert.equal(feats[0].비고, "c|d");
  assert.equal(feats[0].화면, "화면", "가운데 칸들이 밀리지 않아야 한다");
});
