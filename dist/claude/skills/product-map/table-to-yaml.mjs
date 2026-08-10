#!/usr/bin/env node
// src/skills/product-map/table-to-yaml.mjs
// 기능 명세를 8칸 마크다운 표에서 YAML 블록으로 옮긴다.
//
// 왜 옮기나: 마크다운 표는 설명·비고 안에 `|` 가 한 글자만 들어가도 그 뒤 칸이 통째로 밀리는데,
// 밀려도 표는 멀쩡히 그려져서 아무도 모른다(실측 2026-08-10: 실제 프로젝트 지도 3벌 251개 기능 중
// 1개가 밀린 채였다 — 사용자부터 비고까지 다섯 칸이 통째로 한 칸씩). YAML 은 칸이 이름으로 붙어 있어
// 이 사고가 구조적으로 안 생긴다.
//
// 안전 원칙: **내용은 한 글자도 버리지 않는다.** 네 겹으로 확인하고, 하나라도 어긋나면 아무것도 쓰지 않는다.
//   1. 표 영역 대조 — 표 안에서 기능 행으로 못 읽은 줄이 하나라도 있으면 멈춘다(0개도 멈춘다).
//   2. 칸 복원 대조 — 밀린 줄을 복원한 뒤 도로 이어 **원본 줄이 글자까지 그대로** 나오는지 본다.
//   3. 되돌림 대조 — 만든 YAML 을 다시 읽어 원본 값과 글자 단위로 같은지 본다.
//   4. 조립 후 대조 — 완성한 파일에서 YAML 블록을 도로 뜯어내고, 표 밖 줄이 **원본과** 같은지 본다
//      (줄바꿈은 LF 로 통일한 뒤 비교한다 — CRLF 파일은 표 밖 줄도 전부 바뀌므로 "바이트 동일"은 거짓말이다).
//
// ⚠ v0.60.0 까지는 **밀린 줄을 복원할 때 `|` 주변 공백이 한 칸으로 벌어졌다**(`가격|할인` → `가격 | 할인`).
// v0.61.0 에서 고쳤다 — 이제 안쪽 공백을 안 건드린다. 판정 기준은 **모양이 아니라 원본과 같은가**다:
// 원본이 `A | B` 였으면 `A | B` 로 나오는 게 정답이고(테스트가 그걸 정답으로 못 박고 있다),
// **원본과 값 안쪽의 `|` 주변 공백이 달라졌으면** 그 버그가 되살아난 신호다.
// (값 **양 끝** 공백은 표에서든 YAML 에서든 원래 안 옮긴다 — `참고|  ` 가 `참고|` 로 나오는 건 정상이다.)
//
// 사용: node "${CLAUDE_PLUGIN_ROOT}/skills/product-map/table-to-yaml.mjs" docs/feature-spec.md [--write]
//       --write 없이 돌리면 결과만 보고하고 파일은 안 건드린다.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 옛 표의 `관련 화면` 칸이 여기선 `화면` 이다 — 이름만 짧아졌고 뜻은 같다.
const COLS = ["id", "기능명", "설명", "사용자", "우선순위", "상태", "화면", "비고"];
const STATUS = new Set(["기획중", "개발중", "완료", "보류"]);
const PRIO = new Set(["높음", "중간", "낮음"]);

// 실제 파일에는 규격 밖 값도 있다(과거에 손으로 적힌 것). 옮기는 단계에서 고치지 않는다 —
// 내용 보존이 우선이고, 규격 밖이라는 사실만 경고로 남겨 사람이 판단하게 한다.
// 단 밀린 줄을 복원할 때는 이 값들도 닻으로 인정해야 복원이 된다.
const PRIO_SEEN = new Set([...PRIO, "큰", "작음", "-", "—"]);
const STATUS_SEEN = new Set([...STATUS, "미정", "폐기", "진행중", "진행", "완료(1단계)"]);

const HEAD_RE = /^\s*\|\s*ID\s*\|/;
const SEP_RE = /^\s*\|[\s|:-]+\|\s*$/;          // 꼬리 공백·CRLF 를 넘긴다
const ROW_RE = /^\s*\|\s*F-\d+\s*\|/;
const IN_TABLE_RE = /^\s*\|/;

// 안내는 상황마다 다르다. 한 문구로 뭉쳐 두면 **멀쩡한 다른 표를 지우라고 읽힌다**(2026-08-10 3차 리뷰).
// 🛑 "표 위로 옮겨라"는 절대 권하지 않는다 — 아래 검사 (3)은 표 **아래쪽만** 훑으므로, 안내대로 옮기면
// 그 줄은 안 옮겨진 채 네 겹이 전부 초록불이 된다(4차 리뷰). 안내가 검사 사각으로 사람을 보내면 안 된다.
const MOVE_OUT = "잠시 다른 곳에 오려 두었다가 옮기기가 끝나면 되돌려라";
const HINT_IN = `이 줄이 다른 표의 시작이면 기능 표와 사이에 제목이나 문단을 한 줄 넣어라. 예시로 적어 둔 줄이면 ${MOVE_OUT}. 아니면 ID 가 \`F-숫자\` 모양인지 보라 — 이게 가장 흔한 원인이다.`;
const HINT_OUT = `이 줄이 표가 아니라 예시라면 ${MOVE_OUT}.`;
// 다듬기 **전** 조각(raw)까지 들고 다닌다. 다듬은 값만 들고 다니면 밀린 행을 다시 이을 때
// `|` 양옆의 공백이 사라진 채 ` | ` 로 붙어 **값이 바뀐다** — 실사고 2026-08-10:
// `?open=activity|opp` 가 `?open=activity | opp` 로 나갔고 fatal 0 · 대조 세 줄 전부 초록이었다.
// 기준이 전부 "다듬은 값"이라 뽑는 단계에서 생긴 차이는 볼 자리가 없었다.
export const splitCells = (l) => {
  const line = l.replace(/\s+$/, "");
  const parts = line.split("|");
  return { line, head: parts[0], tail: parts[parts.length - 1], raw: parts.slice(1, -1) };
};

// 밀린 행 복원 대조를 **밖에서 일부러 깨뜨려 볼 수 있게** 함수로 뺀다. 안에 묻어 두면
// "검사가 있다"는 말만 남고 실제로 실패하는지는 아무도 못 본다(옛 판이 정확히 그랬다).
export const rowRestoreOk = (row, parts) =>
  !parts.some((v) => v === undefined) &&
  row.head + "|" + parts.join("|") + "|" + row.tail === row.line;

export function convert(text) {
  // 🛑 여기서 줄바꿈을 LF 로 통일한다 — CRLF 파일은 **표 밖 줄도 전부 바뀐다.** 그래서 아래 대조와
  // 스킬 문서는 "바이트 동일"이 아니라 "줄바꿈 정규화 후 동일"이라고 적는다(못 지킬 약속을 안 적는다).
  const src = text.replace(/\r\n/g, "\n").split("\n");
  const keep = [];
  const rows = [];
  const warn = [];
  const fatal = [];
  let i = 0;

  // (1) 표 머리를 **처음 한 번만** 찾는다. 파일 전역에서 찾으면 뒤쪽의 무관한 표까지 표로 오인해
  //     그 표의 머리·구분선을 지운다(2026-08-10 실제 파일에서 그 계열의 사고가 났다).
  for (; i < src.length && !HEAD_RE.test(src[i]); i++) keep.push(src[i]);
  if (i >= src.length) {
    fatal.push("8칸 표 머리(`| ID |`)를 못 찾았다 — 이 파일은 옮길 대상이 아니다");
    return { feats: [], src, keep, tableAt: -1, tableFrom: -1, tableTo: -1, tableLines: 0, blankLines: 0, warn, fatal };
  }
  const tableAt = keep.length;
  const tableFrom = i;                           // 원본에서 표 영역이 시작하는 줄(조립 후 대조가 이걸 쓴다)
  keep.push("");                                 // 자리만 잡아 둔다(자리 표시 **문자열**은 쓰지 않는다 — render 참조)
  i++;
  if (i < src.length && SEP_RE.test(src[i])) i++;

  // (2) 표 영역 = 머리 다음의 **이어지는 `|` 줄들**. 이 안에서 기능 행으로 못 읽은 줄은 그냥 넘기지 않는다.
  //     넘기면 그 줄은 이름표 없는 본문으로 남고 표 머리는 지워져, 사람이 보기엔 표가 부서진다.
  let tableLines = 0, blankLines = 0;
  for (; i < src.length; i++) {
    const l = src[i];
    if (IN_TABLE_RE.test(l)) {
      tableLines++;
      if (!ROW_RE.test(l))
        fatal.push(`${i + 1}번째 줄이 표 안에 있는데 기능 행으로 못 읽었다: ${l.slice(0, 60)} — ${HINT_IN}`);
      // 닫는 `|` 가 없으면 마지막 칸이 잘려 나간다. 칸이 9개였던 밀린 행은 잘린 뒤 정확히 8칸이 되어
      // **정상 행으로 통과하고 조각 하나가 조용히 사라진다** — 어느 대조도 없어진 조각은 못 본다.
      else if (!l.replace(/\s+$/, "").endsWith("|"))
        fatal.push(`${i + 1}번째 줄이 \`|\` 로 안 끝난다 — 마지막 칸이 잘려 사라진다, 손으로 닫아라: ${l.slice(0, 60)}`);
      else rows.push(splitCells(l));
      continue;
    }
    // 빈 줄은 **표가 곧바로 다시 이어질 때만** 표 안으로 본다. 실제 파일이 그렇게 생겼다
    // (2026-08-10 이 저장소 기능 명세: 17행 + 빈 줄 + 8행).
    // 앞보기를 `기능 행`이 아니라 `표 줄`로 잡는 이유: ID 가 어긋난 줄이 빈 줄 바로 뒤에 오면
    // 표가 끝난 줄 알고 그 아래를 통째로 본문으로 넘기는데, 표 밖 검사는 **잘 생긴 기능 행만** 찾으므로
    // 아무도 안 본다. 표 줄로 잡으면 위 fatal 에 걸린다.
    // 단 다음이 **새 표의 시작**이면 거기서 끝낸다 — 무관한 표를 삼키지 않는다.
    // 새 표인지는 머리 **이름**이 아니라 **모양**으로 본다: 표 줄 바로 다음이 구분선이면 그게 새 표의 머리다.
    // 이름(`| ID |`)으로만 보면 `| 항목 | 값 |` 같은 옆 표가 통째로 빨려 들어가 정상 파일이 거부된다
    // (2026-08-10 3차 리뷰 · 재현함). 기능 표의 뒷토막은 구분선이 뒤따르지 않으므로 지금처럼 이어진다.
    if (l.trim() === "") {
      let k = i + 1;
      while (k < src.length && src[k].trim() === "") k++;
      if (k < src.length && IN_TABLE_RE.test(src[k])) {
        const startsNewTable = HEAD_RE.test(src[k]) || SEP_RE.test(src[k]) ||
          (k + 1 < src.length && SEP_RE.test(src[k + 1]));
        if (!startsNewTable) { blankLines += k - i; i = k - 1; continue; }
      }
    }
    break;
  }
  const tableTo = i;                             // 표 영역의 끝(이 줄부터는 원본 그대로 남는다)
  for (; i < src.length; i++) keep.push(src[i]);

  // (3) 표 영역 **밖에** 기능 행처럼 생긴 줄이 남아 있으면 표가 두 토막 난 것이다.
  //     여기는 **잘 생긴 기능 행만** 본다. ID 가 어긋난 표 줄이 문단 아래 남아 있으면 못 본다는 뜻인데,
  //     그 줄들은 원본에서도 이미 표 밖이고 이 스크립트가 **아무것도 안 지우므로** 실피해가 없다.
  //     "파이프 7개 이상인 표 모양 줄"까지 넓히면 닫히지만, 그러면 무관한 표를 다시 오탐한다 —
  //     방금 3차에서 고친 게 바로 그 오탐이라 넓히지 않는다(2026-08-10 판단).
  for (let k = tableAt + 1; k < keep.length; k++)
    if (ROW_RE.test(keep[k])) fatal.push(`기능 행처럼 생긴 줄이 표 밖에 있다 — 표가 끊겼는지 보라: ${keep[k].slice(0, 60)} — ${HINT_OUT}`);

  if (!fatal.length && rows.length === 0)
    fatal.push("표는 찾았는데 옮길 기능 행이 0개다 — 행 ID 가 `F-숫자` 모양인지 확인하라(이대로 쓰면 표 머리만 지워진다)");

  const feats = [];
  for (const row of rows) {
    const cells = row.raw.map((s) => s.trim());
    const f = {};
    if (cells.length === COLS.length) {
      COLS.forEach((c, j) => (f[c] = cells[j]));
    } else {
      // 칸이 밀린 줄. **자리로 짐작하지 않는다** — 실측: 어떤 줄은 설명에, 어떤 줄은 비고에 `|` 가 있었다.
      // 대신 값이 정해진 두 칸(우선순위·상태)이 나란히 붙어 있는 자리를 닻으로 삼는다.
      // 닻 후보가 둘 이상이면 **고르지 않고 멈춘다** — 골랐다가 틀리면 아무 신호도 안 남는다.
      const anchors = [];
      for (let j = 4; j < cells.length - 2; j++)
        if (PRIO_SEEN.has(cells[j]) && STATUS_SEEN.has(cells[j + 1])) anchors.push(j);
      if (anchors.length === 0) { fatal.push(`${cells[0]}: 칸이 ${cells.length}개인데 닻(우선순위+상태)을 못 찾았다 — 손으로 고쳐야 한다`); continue; }
      if (anchors.length > 1) { fatal.push(`${cells[0]}: 닻(우선순위+상태) 후보가 ${anchors.length}군데다 — 어느 쪽인지 기계가 못 정한다, 손으로 고쳐야 한다`); continue; }
      const p = anchors[0];
      // 🛑 다듬은 조각이 아니라 **원본 조각**을 잇는다. 잘려 나간 건 `|` 하나뿐이므로 `|` 하나로만
      //    되돌리고, 다듬기는 이어 붙인 **뒤 바깥쪽에 한 번만** 한다(안쪽 공백을 안 건드린다).
      const joinRaw = (from, to) => row.raw.slice(from, to).join("|");
      const parts = [row.raw[0], row.raw[1], joinRaw(2, p - 1), row.raw[p - 1],
                     row.raw[p], row.raw[p + 1], row.raw[p + 2], joinRaw(p + 3, row.raw.length)];
      if (parts.some((v) => v === undefined)) { fatal.push(`${cells[0]}: 닻 자리가 칸 수를 벗어났다 — 손으로 고쳐야 한다`); continue; }
      COLS.forEach((c, j) => (f[c] = parts[j].trim()));

      // 칸 복원 대조: 되살린 8조각을 `|` 로 도로 이어 **원본 줄이 글자까지 그대로 나오는지** 본다.
      // 🛑 옛 판은 다듬은 값을 ` | ` 로 붙인 뒤 같은 문자열을 그 구분자로 도로 쪼개 비교했다. 붙이기와
      //    쪼개기가 서로 정확한 역함수라 **이어 붙이는 방식이 틀린 건 절대 못 잡았고**, 그래서 위
      //    실사고를 통과시켰다(칸 수가 안 맞는 행은 잡았으니 "항상 참"까지는 아니다). 이 판은 깨진다 —
      //    이어 붙이기에 공백을 섞거나(실사고 그 자체) 자르는 자리가 겹치거나 비면 여기서 멈춘다.
      //    ⚠ 이 대조가 보증하는 건 "글자를 더하거나 잃지 않았다"까지다. **어느 칸에 여분의 `|` 가
      //    있었는지는 여전히 못 본다** — 그 가정은 아래 경고로 사람에게 넘긴다.
      if (!rowRestoreOk(row, parts))
        // 🛑 "칸을 8개로 맞춰라"라고 적지 않는다. 설명·비고에 `|` 를 **일부러 쓴** 줄은 칸이 8개보다
        //    많은 게 정상이라, 개수를 목표로 주면 그 `|` 와 주변 글자를 지우게 된다 — 이 스크립트가
        //    막으려는 바로 그 행동이다(2차 리뷰 · `| F-50 | 이름 | a|b | 설 | 명 | …` 로 재현).
        // 🛑 붙일 **조각**(`| |`)을 주지 않는다. 그 줄은 이미 `|` 로 끝나서 조각을 그대로 이어 붙이면
        //    칸이 하나 더 생기고 비고에 `|` 한 글자가 남는다(3차 리뷰 · 재현함). 결과 **모양**을 준다.
        fatal.push(`${f.id}: 이 줄은 끝 칸이 빠진 것 같다 — 줄 맨 끝을 \`… | 화면 |  |\` 처럼 ` +
                   `빈 칸 하나로 닫아 이름표 ${COLS.length}칸을 다 채워라. 설명·비고에 \`|\` 를 ` +
                   `일부러 썼다면 칸이 ${COLS.length}개보다 많은 게 정상이니 **그 \`|\` 는 지우지 마라**`);
      else
        warn.push(`${f.id}: 칸이 ${cells.length}개였다 — 닻을 ${p + 1}번째에서 찾아 복원(설명 ${p - 3}조각 · 비고 ${cells.length - p - 3}조각). ` +
                  `**이 복원은 여분의 \`|\` 가 설명·비고에 있었다는 가정이다 — 화면·기능명·사용자에 있었다면 틀리니 이 줄은 눈으로 확인하라.**`);
    }
    if (!STATUS.has(f.상태)) warn.push(`${f.id}: 상태 '${f.상태}' 는 규격 밖(그대로 옮긴다)`);
    if (!PRIO.has(f.우선순위)) warn.push(`${f.id}: 우선순위 '${f.우선순위}' 는 규격 밖(그대로 옮긴다)`);
    feats.push(f);
  }
  return { feats, src, keep, tableAt, tableFrom, tableTo, tableLines, blankLines, warn, fatal };
}

// 따옴표를 **언제 뺄지**를 정한다(언제 붙일지가 아니다). 위험 조건을 넓게 잡고, 하나라도 걸리면 감싼다.
//
// 🛑 조건을 넓게 잡는 이유: 위험한 글자만 좁게 열거하는 방식은 빠뜨린 한 가지에서 조용히 깨진다.
// 특히 YAML 은 특수문자가 없어도 뜻이 바뀐다 — `2026-09-01` 은 날짜, `no`·`off` 는 거짓,
// `~`·`null` 은 빈 값, `007` 은 숫자로 읽힌다. 아래 조건을 **전부** 만족할 때만 맨값으로 두고,
// 나머지는 큰따옴표로 감싼다(JSON 문자열은 YAML 큰따옴표 문법의 부분집합이라 그대로 유효하다).
// 이 규칙이 곧 아래 `verify` 의 되읽기 전제이기도 하다 — "맨값 = 적힌 글자 그대로"가 여기서 보증된다.
const PLAIN_HEAD_BAD = /^[\s\-?:,[\]{}#&*!|>'"%@`~]/;   // 맨 앞에 오면 YAML 문법 기호로 읽히는 글자
const PLAIN_BODY_BAD = /[:#]|\s$/;                       // 값 안의 `:`·`#` 과 꼬리 공백
const LOOKS_SPECIAL = /^(?:true|false|yes|no|on|off|null|~|[+-]?\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|0[xob][0-9a-fA-F_]+|\.(?:inf|nan)|\d{4}-\d{1,2}-\d{1,2}.*)$/i;
const quote = (raw) => {
  const s = raw == null ? "" : String(raw);
  if (s === "") return '""';
  if (s.includes("\n")) return null;                     // 여러 줄은 블록으로 뺀다
  if (PLAIN_HEAD_BAD.test(s) || PLAIN_BODY_BAD.test(s) || LOOKS_SPECIAL.test(s)) return JSON.stringify(s);
  return s;
};

export function toYaml(feats) {
  const out = [
    "# 기능 명세 — 형식의 단일 원본은 chageun `product-map` 스킬이다.",
    "# 표가 아니라 YAML 인 이유: 표는 값에 `|` 가 하나만 섞여도 뒤 칸이 조용히 밀린다.",
    "# 칸 8개는 전부 적는다(빈 값은 \"\"). 따옴표를 언제 빼도 되는지는 스킬 문서를 보라.",
    "features:",
  ];
  for (const f of feats) {
    out.push(`  - id: ${quote(f.id) ?? JSON.stringify(String(f.id))}`);
    for (const c of COLS.slice(1)) {
      const v = f[c] ?? "";
      const one = quote(v);
      if (one === null) {
        out.push(`    ${c}: |-`);
        for (const ln of String(v).split("\n")) out.push(`      ${ln}`);
      } else out.push(`    ${c}: ${one}`);
    }
  }
  return out.join("\n");
}

// 되돌림 대조: 만든 YAML 을 다시 읽어 원본 값과 글자 단위로 같은지 본다.
export function verify(feats, yaml) {
  const back = [];
  let cur = null, blk = null;
  const unwrap = (v) => (/^".*"$/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
  for (const line of yaml.split("\n")) {
    let m;
    if ((m = /^  - id: (.*)$/.exec(line))) { cur = { id: unwrap(m[1]) }; blk = null; back.push(cur); continue; }
    if (!cur) continue;
    if ((m = /^ {4}([^:]+): \|-$/.exec(line))) { blk = m[1]; cur[blk] = []; continue; }
    if (blk && /^ {6}/.test(line)) { cur[blk].push(line.slice(6)); continue; }
    blk = null;
    if ((m = /^ {4}([^:]+): (.*)$/.exec(line))) cur[m[1]] = unwrap(m[2]);
  }
  const diffs = [];
  if (back.length !== feats.length) diffs.push(`기능 개수가 ${feats.length} → ${back.length} 로 달라졌다`);
  for (let i = 0; i < Math.min(back.length, feats.length); i++)
    for (const c of COLS) {
      let b = back[i][c];
      if (Array.isArray(b)) b = b.join("\n");
      const a = feats[i][c] ?? "";
      if ((b ?? "") !== a) diffs.push(`${feats[i].id} · ${c}: 원본 ${JSON.stringify(a).slice(0, 60)} → 되읽음 ${JSON.stringify(b ?? "").slice(0, 60)}`);
    }
  return diffs;
}

// 조립 후 대조 — **실제로 파일에 쓰일 글자**(`out`)를 다시 쪼개, 표 영역만 뺀 **원본**(`src`)과 맞춘다.
//
// 🛑 대조 상대가 원본이어야 하는 이유. 앞 판은 끼워 넣은 결과를 끼워 넣기 **입력**과 비교해서
// 어떤 파일을 넣어도 통과했다(2026-08-10 2차 리뷰). 기준이 실수의 결과물 자신이면, 중간 결과를
// 만들며 한 줄 빠뜨린 실수는 영원히 안 걸린다. 그런데 스킬 문서는 "기계가 본다"고 약속했으니
// 사람은 눈으로 안 본다 — 약속만 남고 검사는 없는 상태가 가장 나쁘다.
// 함수로 빼 둔 것도 같은 이유다: 밖에서 일부러 망가뜨려 **이 검사가 실제로 실패하는지** 시험할 수 있다.
//
// 이 검사가 **못 보는 것 하나**: 표 영역의 경계(`tableFrom`·`tableTo`)는 `convert` 가 스스로 정한 값이라,
// 경계가 틀리게 넓으면 그 안의 줄은 비교 대상에서 통째로 빠진다. 그 자리는 1번째 겹(표 안에 못 읽은
// 줄이 있으면 멈춤)이 지킨다. 표 영역 판정을 손볼 때 이 검사가 그 변경을 봐 주지 못한다는 걸 기억할 것.
export function assembledIssues({ src, tableFrom, tableTo, tableAt, block, out }) {
  const issues = [];
  // 머리 앞 줄은 원본 그대로 `keep` 에 들어가므로 둘은 항상 같아야 한다. 어긋나면 `got` 과 `src` 를
  // 서로 다른 자리에서 잘라 비교하게 되어 **어긋난 채로 조용히 통과**한다.
  if (tableAt !== tableFrom) return [`[조립 후 대조] 표 자리 계산이 어긋났다(${tableAt} ≠ ${tableFrom}) — 손으로 확인해야 한다`];
  const got = String(out).split("\n");
  const gotBlock = got.slice(tableAt, tableAt + block.length);
  const gotRest = [...got.slice(0, tableAt), ...got.slice(tableAt + block.length)];
  const wantRest = [...src.slice(0, tableFrom), ...src.slice(tableTo)];
  if (gotBlock.join("\n") !== block.join("\n"))
    issues.push("[조립 후 대조] 끼워 넣은 자리에서 YAML 블록을 도로 못 꺼냈다 — 손으로 확인해야 한다");
  else if (gotRest.length !== wantRest.length)
    issues.push(`[조립 후 대조] 표 밖 줄 수가 원본과 다르다(${wantRest.length} → ${gotRest.length}) — 손으로 확인해야 한다`);
  else {
    const at = gotRest.findIndex((l, i) => l !== wantRest[i]);
    if (at >= 0) issues.push(`[조립 후 대조] 표 밖 ${at + 1}번째 줄이 원본과 달라졌다 — 손으로 확인해야 한다: ${wantRest[at].slice(0, 50)}`);
  }
  return issues;
}

// 표 자리에 YAML 블록을 끼워 넣는다.
//
// 🛑 **`String.replace` 로 자리 표시 문자열을 바꾸지 말 것.** 바꿔 넣는 글자 안의 `$&`·`$1` 을 자바스크립트가
// "매치한 문자열"로 해석해 값이 조용히 바뀐다. 실측 2026-08-10: 이 저장소 자신의 기능 명세 F-05 비고에
// `$&` 가 들어 있었고(하필 "`$&` 때문에 코드가 손상됐다"는 기록이었다) 그 두 글자가 자리 표시 문자열로
// 치환됐다. 앞의 대조들이 못 잡았다 — 전부 조립 **전**의 값만 봤기 때문이다.
// 그래서 자리 표시 문자열을 아예 없애고 줄 번호로 끼워 넣은 뒤, 조립 **후** 결과를 다시 뜯어 대조한다.
export function render(text) {
  const { feats, src, keep, tableAt, tableFrom, tableTo, tableLines, blankLines, warn, fatal } = convert(text);
  const yaml = toYaml(feats);
  const diffs = fatal.length ? [] : verify(feats, yaml);
  let out = null;
  if (!fatal.length && !diffs.length) {
    const block = ["```yaml", ...yaml.split("\n"), "```"];
    const lines = keep.slice();
    lines.splice(tableAt, 1, ...block);
    out = lines.join("\n");

    for (const x of assembledIssues({ src, tableFrom, tableTo, tableAt, block, out })) fatal.push(x);
    if (fatal.length) out = null;
  }
  return { feats, yaml, tableLines, blankLines, warn, fatal, diffs, out };
}

// 직접 실행할 때만 돈다. 이 가드가 없으면 테스트가 import 하는 순간 `process.argv[2]`(테스트 파일
// 경로)를 기능 명세로 알고 읽는다. 경로 비교는 `fileURLToPath` 로 한다 — 문자열로 `file://` 를 붙이면
// 경로에 공백·한글이 있을 때 퍼센트 인코딩 때문에 절대 안 맞아 스크립트가 말없이 끝난다.
const [, , path, flag] = process.argv;
if (process.argv[1] === fileURLToPath(import.meta.url) && path) {
  const { feats, tableLines, blankLines, warn, fatal, diffs, out } = render(readFileSync(path, "utf8"));
  const chars = feats.reduce((n, f) => n + COLS.reduce((m, c) => m + (f[c] || "").length, 0), 0);
  const stage = (tag) => fatal.filter((x) => (tag === "조립" ? x.startsWith("[조립") : !x.startsWith("[조립")));

  console.log(path);
  // 빈 줄은 따로 적는다. 합쳐 세면 `표 안 26줄 중 기능 25개` 가 되어 한 행을 놓친 것처럼 보인다.
  console.log(`  표 안 ${tableLines ?? 0}줄 중 기능 ${feats.length}개${blankLines ? ` (사이 빈 줄 ${blankLines})` : ""} · 셀 글자수 ${chars}`);
  const early = stage("앞");
  console.log(`  표 영역·칸 복원 대조 : ${early.length ? "❌ " + early.length + "건" : "✅ 이상 없음"}`);
  for (const x of early) console.log("     " + x);
  console.log(`  되돌림 대조 : ${early.length ? "건너뜀" : diffs.length ? "❌ " + diffs.length + "건" : "✅ 완전 일치"}`);
  for (const d of diffs.slice(0, 5)) console.log("     " + d);
  const late = stage("조립");
  console.log(`  조립 후 대조 : ${early.length || diffs.length ? "건너뜀" : late.length ? "❌ " + late.length + "건" : "✅ 표 밖 그대로"}`);
  for (const x of late) console.log("     " + x);
  if (warn.length) {
    console.log(`  ⚠ 알아 둘 것 ${warn.length}건:`);
    for (const w of warn) console.log("     " + w);
  }

  if (flag === "--write") {
    if (out == null) {
      console.log("  → 어긋난 곳이 있어 **아무것도 쓰지 않았다**.");
      process.exit(1);
    }
    writeFileSync(path, out);
    console.log("  → 옮겼다.");
  } else {
    console.log("  (--write 를 안 줘서 파일은 안 건드렸다)");
  }
}
