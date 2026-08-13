// 조각 표 + 절 분해. **순수 함수**: fs 를 쓰지 않는다(텍스트를 받아 텍스트를 낸다).
// 훅(activate.js)과 검사(test/rule-pieces.test.mjs · test/activate.test.mjs)가 **같은 함수**를 부른다.
// 왜 나눠 내보내나: CLI 는 훅 출력이 10,000 JS 문자를 넘으면 파일로 밀어내고 모델에는 앞부분만
// 보인다. 규칙 한 벌은 그 문턱의 두 배라 2026-06-30 이후 안전 규칙 14개 절이 통째로 안 닿았다.
//
// 🛑 조각 표의 순서 = 파일의 절 순서가 불변식이다(재구성 대조가 순서까지 강제한다).
//    절을 **인접한** 조각으로 넘기는 것은 파일 순서를 안 깨므로 그대로 된다.
//    **건너뛰어** 옮기려면 operating-rules.md 안의 절 순서도 함께 바꿔야 한다.
const PIECES = [
  { n: 1, label: "사람·말투",        keys: ["chageun operating rules", "User context", "Work-size switch",
                                          "Work-start card", "Output style"] },
  { n: 2, label: "게이트",           keys: ["Verification gates", "Spec confirmation gate"] },
  { n: 3, label: "만드는 법",        keys: ["Minimal implementation first", "Model · execution routing",
                                          "Proceeding by task type", "Product map"] },
  { n: 4, label: "멈춤·검증·마무리", keys: ["Stop rules", "Real-run verification", "Finish check",
                                          "Security · approval hygiene"] },
  { n: 5, label: "안전 캡슐",        keys: ["Safety capsule"] },
];

// 절 분해: 최상위 제목(`^# `)에서만 자른다. `## ` 는 상위 절에 붙는다.
// 이어 붙이면 원문이 **글자 하나까지** 복원되어야 한다: 그래서 잘라낸 조각을 다듬지 않는다.
// 첫 제목 앞에 글이 있으면 heading "" 인 절로 내보낸다(조각 표가 못 잡아 두 방향 대조가 빨간불).
function sectionsOf(text) {
  const out = [];
  const starts = [];
  const re = /^# .*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) starts.push({ index: m.index, heading: m[0] });
  if (starts.length === 0) return text.length ? [{ heading: "", text }] : [];
  if (starts[0].index > 0) out.push({ heading: "", text: text.slice(0, starts[0].index) });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    out.push({ heading: starts[i].heading, text: text.slice(starts[i].index, end) });
  }
  return out;
}

// 그 조각의 절들을 **파일 순서 그대로** 이어 붙인다.
function bodyOfPiece(text, n) {
  const piece = PIECES.find((p) => p.n === n);
  if (!piece) return "";
  return sectionsOf(text)
    .filter((s) => piece.keys.some((k) => s.heading.includes(k)))
    .map((s) => s.text)
    .join("");
}

// 두 상수를 **코어에** 두는 이유: 훅 stdout 을 재는 검사(test/activate.test.mjs)와 함수 반환값을
// 재는 검사(test/rule-pieces.test.mjs)가 **같은 숫자**를 봐야 한다. 두 파일에 각각 적으면
// 한쪽만 올려 놓고 통과시키는 길이 생긴다.
const PIECE_MAX_CHARS = 8000;       // 우리가 지키는 선. 여유 2,000자.
const CLI_TRUNCATION_CHARS = 10000; // CLI 바이너리 상수. 우리가 올려도 CLI 는 안 올라간다.

// 상황판 부록 다듬기. **순수 함수**다: 파일을 안 읽고, 바깥 사실은 ctx 로 받는다.
// 두 가지를 한다:
//   1. `{{BOARD_SERVER}}` 자리에 설치본의 절대 경로를 박는다(길이가 기계마다 다르다:
//      그래서 크기 검사는 로컬 경로가 아니라 가정값으로 잰다).
//   2. 표식이 온전하면 안내 한 줄을 **뗀다**. 모델이 판단할 조건문이 아니라 파일을 보고 내는 사실이다.
//      즉 긴 쪽은 "표식깨짐"이고, 크기 검사의 최악 판은 그쪽이다.
const BOARD_SERVER_SLOT = "{{BOARD_SERVER}}";
const APPENDIX_SPLIT = "<!-- chageun:appendix:if-no-markers -->";

function renderStatusboard(text, variant, ctx) {
  const out = text.replace(BOARD_SERVER_SLOT, (ctx && ctx.boardServer) || "");
  const cut = out.indexOf(APPENDIX_SPLIT);
  if (cut === -1) return out;
  // 구분 표식 자체는 어느 쪽으로도 출력에 안 샌다.
  return variant === "표식온전" ? out.slice(0, cut) : out.replace(APPENDIX_SPLIT + "\n", "");
}

// 조건부 부록 등록부. 파일 목록(src/rules/)과 **양방향**으로 대조된다
// (test/rule-pieces.test.mjs): 주입은 되는데 등록이 안 된 부록이 생기면 그 부록은
// 조합 매트릭스에도 바이트 예산에도 안 잡힌다. 이번 사고와 같은 방향의 구멍이다.
//
// 등록부 한 칸이 갖는 것 넷:
//   applies(ctx)    조건이 맞나. ctx 는 activate.js 가 모아 준 **바깥 사실**(env · 파일 존재 여부).
//   variants        조건이 맞았을 때 낼 수 있는 **서로 다른 글**의 이름들. 조합 매트릭스가
//                   이 목록에서 자동으로 늘어난다(부록 하나가 만드는 상태 = 꺼짐 1 + 변형 수).
//   variantOf(ctx)  ctx 를 보고 그중 어느 변형인지 고른다. 훅이 부른다.
//   render(t,v,ctx) 원문을 그 변형의 최종 글로 다듬는다. **훅과 검사가 이 함수를 같이 부른다**:
//                   검사가 자기 나름의 다듬기를 다시 짜면 실제 주입되는 글과 다른 것을 재게 된다.
// 🛑 변형을 늘리면서 render 가 그 이름으로 갈라지지 않으면, 매트릭스는 늘어나는데 두 칸이
//    같은 글을 재는 헛검사가 된다. test/rule-pieces.test.mjs 가 변형끼리 글이 다른지 본다.
const APPENDICES = [
  { id: "unattended", file: "unattended-appendix.md",
    applies: (ctx) => ctx.env.CHAGEUN_UNATTENDED === "1",
    variants: ["only"],
    variantOf: () => "only",
    render: (text) => text },
  // 🛑 무인 **다음**에 등록한다. 등록 순서 = 붙는 순서이고, 무인 안전 규칙이 먼저 읽혀야 한다.
  { id: "statusboard", file: "statusboard-appendix.md",
    applies: (ctx) => ctx.board === true,
    variants: ["표식온전", "표식깨짐"],
    variantOf: (ctx) => (ctx.boardMarkersIntact ? "표식온전" : "표식깨짐"),
    render: renderStatusboard },
];

// 부록 조각의 번호. 본문 조각 뒤 한 자리.
const APPENDIX_PIECE = PIECES.length + 1;

// 옛 머리말. 인자 없이 불릴 때(설치본 배선이 옛것일 때) 그대로 쓴다: 잘리더라도 침묵보다 낫다.
const LEGACY_HEADER = "차근 워크플로우 활성. 아래 운영 규칙을 이번 세션 내내 따른다:\n\n";

// 표식 문자열 `차근 워크플로우 활성` 은 **첫 줄 맨 앞**에 그대로 둔다
// (test/activate.test.mjs · test/statusboard-activate.test.mjs 가 이 문자열을 키로 쓴다).
// 머리말 안에는 빈 줄이 없어야 한다: 검사와 모델이 첫 "\n\n" 을 본문 시작으로 읽는다.
// 본문은 `N/5`, 부록은 번호 없이 "조건부"로 적는다: 부록은 보통 안 오는데 "6조각이 한 벌"이라고
// 하면 매 평범한 세션에서 모델이 없는 조각을 찾게 된다.
// 명단은 **조각 표에서 뽑는다**(손으로 안 적는다): 조각을 늘리면 머리말이 따라 늘어난다.
// 왜 번호만으로 부족한가: 조각 4(멈춤·검증·보안)나 5(안전 캡슐)만 죽으면 1~3이 정상 도착해
// **세션이 완전히 정상으로 보인다.** 번호의 빈칸은 눈에 안 띄지만 이름의 빈칸은 띈다:
// "안전 캡슐이 안 왔다"는 알아볼 수 있어도 "5번이 안 왔다"는 못 알아본다.
// 머리말은 조각마다 반복되어 글자 수가 ×6 이므로 명단은 짧게 쓴다.
const ROSTER = PIECES.map((p) => `${p.n} ${p.label}`).join(" / ");

function headerFor(n, label, rulesPath) {
  const tag = n === null ? "부록 조각 · 조건부" : `조각 ${n}/${PIECES.length} · ${label}`;
  const second = n === null
    ? "이 조각은 조건이 맞을 때만 온다. 규칙 본문 한 벌과 함께 쓴다."
    : "도착 순서는 섞인다. 조각끼리 서로를 대체하지 않는다.";
  return `차근 워크플로우 활성. 아래 운영 규칙을 이번 세션 내내 따른다 [${tag}].\n` +
    `${second} 한 벌 = ${ROSTER} (+조건 맞으면 부록 조각).\n` +
    `안 온 조각이 있으면 ${rulesPath} 를 읽어 채운다(부록은 같은 폴더).`;
}

// n 1~5     → 머리말 + 그 조각의 절들
// n 6       → 조건 맞는 부록이 없으면 "" (머리말도 안 붙인다), 있으면 부록 머리말 + 부록들
// n 그 밖   → 옛 동작(머리말 한 줄 + 전체 본문 + 조건 맞는 부록). 인자 없는 옛 배선용.
function assemble({ rulesText, n, rulesPath, appendixTexts }) {
  const texts = appendixTexts || [];
  const tail = texts.length ? "\n\n---\n\n" + texts.join("\n\n---\n\n") : "";
  if (n === APPENDIX_PIECE) return texts.length ? headerFor(null, null, rulesPath) + "\n\n" + texts.join("\n\n---\n\n") : "";
  const piece = PIECES.find((p) => p.n === n);
  if (!piece) return LEGACY_HEADER + rulesText + tail;
  return headerFor(piece.n, piece.label, rulesPath) + "\n\n" + bodyOfPiece(rulesText, piece.n);
}

module.exports = {
  PIECES, sectionsOf, bodyOfPiece,
  PIECE_MAX_CHARS, CLI_TRUNCATION_CHARS, APPENDICES, APPENDIX_PIECE,
  BOARD_SERVER_SLOT, APPENDIX_SPLIT, renderStatusboard,
  LEGACY_HEADER, ROSTER, headerFor, assemble,
};
