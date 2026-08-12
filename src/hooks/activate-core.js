// 조각 표 + 절 분해. **순수 함수** — fs 를 쓰지 않는다(텍스트를 받아 텍스트를 낸다).
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
// 이어 붙이면 원문이 **글자 하나까지** 복원되어야 한다 — 그래서 잘라낸 조각을 다듬지 않는다.
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

module.exports = { PIECES, sectionsOf, bodyOfPiece };
