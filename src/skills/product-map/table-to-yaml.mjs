#!/usr/bin/env node
// src/skills/product-map/table-to-yaml.mjs
// 기능 명세를 8칸 마크다운 표에서 YAML 블록으로 옮긴다.
//
// 왜 옮기나: 마크다운 표는 설명·비고 안에 `|` 가 한 글자만 들어가도 그 뒤 칸이 통째로 밀리는데,
// 밀려도 표는 멀쩡히 그려져서 아무도 모른다(실측 2026-08-10: 실제 프로젝트 6곳 455개 기능 중
// 10개가 밀린 채였다 — 화면 칸에 비고가 들어가 있는 식). YAML 은 칸이 이름으로 붙어 있어
// 이 사고가 구조적으로 안 생긴다.
//
// 안전 원칙: **내용은 한 글자도 버리지 않는다.** 네 겹으로 확인하고, 하나라도 어긋나면 아무것도 쓰지 않는다.
//   1. 표 영역 대조 — 표 안에서 기능 행으로 못 읽은 줄이 하나라도 있으면 멈춘다(0개도 멈춘다).
//   2. 칸 복원 대조 — 밀린 줄을 복원한 뒤 다시 합쳐 원본 칸 배열과 같은지 본다.
//   3. 되돌림 대조 — 만든 YAML 을 다시 읽어 원본 값과 글자 단위로 같은지 본다.
//   4. 조립 후 대조 — 완성한 파일에서 YAML 블록을 도로 뜯어내고, 표 밖 줄이 원본과 바이트 동일한지 본다.
//
// 알려진 예외 하나: **밀린 줄을 복원할 때 `|` 주변 공백이 한 칸으로 정규화된다**(`가격|할인` → `가격 | 할인`).
// 칸은 이미 잘라 낼 때 앞뒤 공백을 턴 뒤라 원래 간격을 되살릴 수 없다. 두 글자 늘어나는 것이고
// 뜻은 안 바뀌지만, "한 글자도 안 잃는다"의 유일한 예외라 여기 적어 둔다.
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

const splitCells = (l) => l.replace(/\s+$/, "").split("|").slice(1, -1).map((s) => s.trim());

export function convert(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const keep = [];
  const rows = [];
  const warn = [];
  const fatal = [];
  let i = 0;

  // (1) 표 머리를 **처음 한 번만** 찾는다. 파일 전역에서 찾으면 뒤쪽의 무관한 표까지 표로 오인해
  //     그 표의 머리·구분선을 지운다(2026-08-10 실제 파일에서 그 계열의 사고가 났다).
  for (; i < lines.length && !HEAD_RE.test(lines[i]); i++) keep.push(lines[i]);
  if (i >= lines.length) {
    fatal.push("8칸 표 머리(`| ID |`)를 못 찾았다 — 이 파일은 옮길 대상이 아니다");
    return { feats: [], keep, tableAt: -1, warn, fatal };
  }
  const tableAt = keep.length;
  keep.push("");                                 // 자리만 잡아 둔다(자리 표시 **문자열**은 쓰지 않는다 — render 참조)
  i++;
  if (i < lines.length && SEP_RE.test(lines[i])) i++;

  // (2) 표 영역 = 머리 다음의 **이어지는 `|` 줄들**. 이 안에서 기능 행으로 못 읽은 줄은 그냥 넘기지 않는다.
  //     넘기면 그 줄은 이름표 없는 본문으로 남고 표 머리는 지워져, 사람이 보기엔 표가 부서진다.
  let tableLines = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (IN_TABLE_RE.test(l)) {
      tableLines++;
      if (ROW_RE.test(l)) rows.push(splitCells(l));
      else fatal.push(`${i + 1}번째 줄이 표 안에 있는데 기능 행으로 못 읽었다(ID 가 \`F-숫자\` 모양인지 보라): ${l.slice(0, 60)}`);
      continue;
    }
    // 빈 줄은 **기능 행이 곧바로 다시 이어질 때만** 표 안으로 본다. 실제 파일이 그렇게 생겼다
    // (2026-08-10 이 저장소 기능 명세: 17행 + 빈 줄 + 8행). 다음 내용이 기능 행이 아니면 여기서 표가 끝난다 —
    // 그래야 아래쪽의 무관한 표·문단을 안 삼킨다.
    if (l.trim() === "") {
      let k = i + 1;
      while (k < lines.length && lines[k].trim() === "") k++;
      if (k < lines.length && ROW_RE.test(lines[k])) { tableLines += k - i; i = k - 1; continue; }
    }
    break;
  }
  for (; i < lines.length; i++) keep.push(lines[i]);

  // (3) 표 영역 **밖에** 기능 행처럼 생긴 줄이 남아 있으면 표가 두 토막 난 것이다.
  for (let k = tableAt + 1; k < keep.length; k++)
    if (ROW_RE.test(keep[k])) fatal.push(`기능 행처럼 생긴 줄이 표 밖에 있다 — 표가 끊겼는지 보라: ${keep[k].slice(0, 60)}`);

  if (!fatal.length && rows.length === 0)
    fatal.push("표는 찾았는데 옮길 기능 행이 0개다 — 행 ID 가 `F-숫자` 모양인지 확인하라(이대로 쓰면 표 머리만 지워진다)");

  const feats = [];
  for (const cells of rows) {
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
      f.id = cells[0];
      f.기능명 = cells[1];
      f.설명 = cells.slice(2, p - 1).join(" | ");            // 잘려 나간 `|` 를 되살린다
      f.사용자 = cells[p - 1];
      f.우선순위 = cells[p];
      f.상태 = cells[p + 1];
      f.화면 = cells[p + 2];
      f.비고 = cells.slice(p + 3).join(" | ");

      // 칸 복원 대조: 복원한 값을 다시 `|` 로 이어 붙여 원본 칸 배열이 그대로 나오는지 본다.
      const back = [f.id, f.기능명, ...f.설명.split(" | "), f.사용자, f.우선순위, f.상태, f.화면, ...f.비고.split(" | ")];
      if (back.length !== cells.length || back.some((v, j) => v !== cells[j]))
        fatal.push(`${f.id}: 칸 복원이 원본과 안 맞는다 — 손으로 고쳐야 한다`);
      else
        // 🛑 이 대조가 보증하는 건 "다시 이어 붙이면 원본과 같다"뿐이다. **여분의 `|` 가 설명·비고에
        // 있었다는 가정은 검사하지 않는다.** `|` 가 화면·기능명·사용자 칸에 있었으면 복원은 틀리는데
        // 이어 붙이기는 성립해서 조용히 통과한다. 그래서 사람에게 넘긴다.
        warn.push(`${f.id}: 칸이 ${cells.length}개였다 — 닻을 ${p + 1}번째에서 찾아 복원(설명 ${p - 3}조각 · 비고 ${cells.length - p - 3}조각). ` +
                  `**이 복원은 여분의 \`|\` 가 설명·비고에 있었다는 가정이다 — 화면·기능명·사용자에 있었다면 틀리니 이 줄은 눈으로 확인하라.**`);
    }
    if (!STATUS.has(f.상태)) warn.push(`${f.id}: 상태 '${f.상태}' 는 규격 밖(그대로 옮긴다)`);
    if (!PRIO.has(f.우선순위)) warn.push(`${f.id}: 우선순위 '${f.우선순위}' 는 규격 밖(그대로 옮긴다)`);
    feats.push(f);
  }
  return { feats, keep, tableAt, tableLines, warn, fatal };
}

// 따옴표를 **언제 뺄지**를 정한다(언제 붙일지가 아니다).
//
// 🛑 포지티브 화이트리스트인 이유: 위험한 글자를 열거하는 방식은 빠뜨린 한 가지에서 조용히 깨진다.
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

// 표 자리에 YAML 블록을 끼워 넣는다.
//
// 🛑 **`String.replace` 로 자리 표시 문자열을 바꾸지 말 것.** 바꿔 넣는 글자 안의 `$&`·`$1` 을 자바스크립트가
// "매치한 문자열"로 해석해 값이 조용히 바뀐다. 실측 2026-08-10: 이 저장소 자신의 기능 명세 F-05 비고에
// `$&` 가 들어 있었고(하필 "`$&` 때문에 코드가 손상됐다"는 기록이었다) 그 두 글자가 자리 표시 문자열로
// 치환됐다. 앞의 대조들이 못 잡았다 — 전부 조립 **전**의 값만 봤기 때문이다.
// 그래서 자리 표시 문자열을 아예 없애고 줄 번호로 끼워 넣은 뒤, 조립 **후** 결과를 다시 뜯어 대조한다.
export function render(text) {
  const { feats, keep, tableAt, tableLines, warn, fatal } = convert(text);
  const yaml = toYaml(feats);
  const diffs = fatal.length ? [] : verify(feats, yaml);
  let out = null;
  if (!fatal.length && !diffs.length) {
    const block = ["```yaml", ...yaml.split("\n"), "```"];
    const lines = keep.slice();
    lines.splice(tableAt, 1, ...block);
    out = lines.join("\n");

    // 조립 후 대조 ①: 끼워 넣은 자리에서 블록을 도로 꺼내 방금 만든 것과 같은지(파일의 "첫" 블록이
    // 아니라 **그 자리**를 본다 — 위쪽에 다른 ```yaml 예시가 있어도 헷갈리지 않는다).
    const gotBlock = lines.slice(tableAt, tableAt + block.length);
    // 조립 후 대조 ②: 표 밖 줄이 원본과 바이트 동일한지. 사람이 눈으로 219줄을 대조하던 것을 기계에 옮겼다.
    const gotRest = [...lines.slice(0, tableAt), ...lines.slice(tableAt + block.length)];
    const wantRest = [...keep.slice(0, tableAt), ...keep.slice(tableAt + 1)];
    if (gotBlock.join("\n") !== block.join("\n"))
      fatal.push("[조립 후 대조] 끼워 넣은 자리에서 YAML 블록을 도로 못 꺼냈다 — 손으로 확인해야 한다");
    else if (gotRest.length !== wantRest.length || gotRest.some((l, i) => l !== wantRest[i]))
      fatal.push("[조립 후 대조] 표 밖 줄이 원본과 달라졌다 — 손으로 확인해야 한다");
    if (fatal.length) out = null;
  }
  return { feats, yaml, tableLines, warn, fatal, diffs, out };
}

// 직접 실행할 때만 돈다. 이 가드가 없으면 테스트가 import 하는 순간 `process.argv[2]`(테스트 파일
// 경로)를 기능 명세로 알고 읽는다. 경로 비교는 `fileURLToPath` 로 한다 — 문자열로 `file://` 를 붙이면
// 경로에 공백·한글이 있을 때 퍼센트 인코딩 때문에 절대 안 맞아 스크립트가 말없이 끝난다.
const [, , path, flag] = process.argv;
if (process.argv[1] === fileURLToPath(import.meta.url) && path) {
  const { feats, tableLines, warn, fatal, diffs, out } = render(readFileSync(path, "utf8"));
  const chars = feats.reduce((n, f) => n + COLS.reduce((m, c) => m + (f[c] || "").length, 0), 0);
  const stage = (tag) => fatal.filter((x) => (tag === "조립" ? x.startsWith("[조립") : !x.startsWith("[조립")));

  console.log(path);
  console.log(`  표 안 ${tableLines ?? 0}줄 중 기능 ${feats.length}개 · 셀 글자수 ${chars}`);
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
