#!/usr/bin/env node
// src/skills/product-map/table-to-yaml.mjs
// 기능 명세를 8칸 마크다운 표에서 YAML 블록으로 옮긴다.
//
// 왜 옮기나: 마크다운 표는 설명·비고 안에 `|` 가 한 글자만 들어가도 그 뒤 칸이 통째로 밀리는데,
// 밀려도 표는 멀쩡히 그려져서 아무도 모른다(실측 2026-08-10: 실제 프로젝트 6곳 455개 기능 중
// 10개가 밀린 채였다 — 화면 칸에 비고가 들어가 있는 식). YAML 은 칸이 이름으로 붙어 있어
// 이 사고가 구조적으로 안 생긴다.
//
// 안전 원칙: **내용은 한 글자도 버리지 않는다.** 세 겹으로 확인하고, 하나라도 어긋나면 아무것도 쓰지 않는다.
//   1. 칸 복원 대조 — 밀린 줄을 복원한 뒤 다시 합쳐 원본 칸 배열과 같은지 본다.
//   2. 되돌림 대조 — 만든 YAML 을 다시 읽어 원본 값과 글자 단위로 같은지 본다.
//   3. 표 밖 텍스트(검증 체크리스트 등)는 손대지 않고 그대로 둔다.
//
// 사용: node "${CLAUDE_PLUGIN_ROOT}/skills/product-map/table-to-yaml.mjs" docs/feature-spec.md [--write]
//       --write 없이 돌리면 결과만 보고하고 파일은 안 건드린다.

import { readFileSync, writeFileSync } from "node:fs";

// 옛 표의 `관련 화면` 칸이 여기선 `화면` 이다 — 이름만 짧아졌고 뜻은 같다.
const COLS = ["id", "기능명", "설명", "사용자", "우선순위", "상태", "화면", "비고"];
const STATUS = new Set(["기획중", "개발중", "완료", "보류"]);
const PRIO = new Set(["높음", "중간", "낮음"]);

// 실제 파일에는 규격 밖 값도 있다(과거에 손으로 적힌 것). 옮기는 단계에서 고치지 않는다 —
// 내용 보존이 우선이고, 규격 밖이라는 사실만 경고로 남겨 사람이 판단하게 한다.
// 단 밀린 줄을 복원할 때는 이 값들도 닻으로 인정해야 복원이 된다.
const PRIO_SEEN = new Set([...PRIO, "큰", "작음", "-", "—"]);
const STATUS_SEEN = new Set([...STATUS, "미정", "폐기", "진행중", "진행", "완료(1단계)"]);

export function convert(text) {
  const lines = text.split("\n");
  const rows = [];
  const keep = [];
  const warn = [];
  const fatal = [];
  let tableAt = -1;        // 표가 있던 **줄 번호**를 기억한다(자리 표시 문자열을 쓰지 않는 이유는 render 참조)
  let expectSep = false;   // 기능 표 **머리 바로 다음 줄**만 구분선으로 본다

  for (const l of lines) {
    if (/^\|\s*ID\s*\|/.test(l)) { tableAt = keep.length; expectSep = true; keep.push(""); continue; }
    // ⚠ 여기 조건을 "표 머리를 한 번이라도 봤으면"으로 넓히면 안 된다. 본문 뒤쪽에 있는 **다른 표**의 구분선까지 지워
    // 그 표가 조용히 깨진다(2026-08-10 실제 파일에서 발생 — 기능 표와 무관한 통계 표였다).
    if (expectSep && /^\|[\s|:-]+\|$/.test(l)) { expectSep = false; continue; }
    expectSep = false;
    if (/^\|\s*F-\d+/.test(l)) { rows.push(l.split("|").slice(1, -1).map((s) => s.trim())); continue; }
    keep.push(l);
  }
  if (tableAt < 0) fatal.push("8칸 표 머리(`| ID |`)를 못 찾았다 — 이 파일은 옮길 대상이 아니다");

  const feats = [];
  for (const cells of rows) {
    const f = {};
    if (cells.length === COLS.length) {
      COLS.forEach((c, i) => (f[c] = cells[i]));
    } else {
      // 칸이 밀린 줄. **자리로 짐작하지 않는다** — 실측: 어떤 줄은 설명에, 어떤 줄은 비고에 `|` 가 있었다.
      // 대신 값이 정해진 두 칸(우선순위·상태)이 나란히 붙어 있는 자리를 찾아 닻으로 삼는다.
      let p = -1;
      for (let i = 4; i < cells.length - 2; i++)
        if (PRIO_SEEN.has(cells[i]) && STATUS_SEEN.has(cells[i + 1])) { p = i; break; }
      if (p < 0) { fatal.push(`${cells[0]}: 칸이 ${cells.length}개인데 닻(우선순위+상태)을 못 찾았다 — 손으로 고쳐야 한다`); continue; }
      f.id = cells[0];
      f.기능명 = cells[1];
      f.설명 = cells.slice(2, p - 1).join(" | ");            // 잘려 나간 `|` 를 되살린다
      f.사용자 = cells[p - 1];
      f.우선순위 = cells[p];
      f.상태 = cells[p + 1];
      f.화면 = cells[p + 2];
      f.비고 = cells.slice(p + 3).join(" | ");

      // 칸 복원 대조: 복원한 값을 다시 `|` 로 이어 붙여 원본 칸 배열이 그대로 나오는지 본다.
      // 닻을 엉뚱한 자리에서 찾았으면 여기서 걸린다.
      const back = [f.id, f.기능명, ...f.설명.split(" | "), f.사용자, f.우선순위, f.상태, f.화면, ...f.비고.split(" | ")];
      if (back.length !== cells.length || back.some((v, i) => v !== cells[i]))
        fatal.push(`${f.id}: 칸 복원이 원본과 안 맞는다 — 손으로 고쳐야 한다`);
      else
        warn.push(`${f.id}: 칸이 ${cells.length}개였다 — 닻을 ${p + 1}번째에서 찾아 복원(설명 ${p - 3}조각 · 비고 ${cells.length - p - 3}조각)`);
    }
    if (!STATUS.has(f.상태)) warn.push(`${f.id}: 상태 '${f.상태}' 는 규격 밖(그대로 옮긴다)`);
    if (!PRIO.has(f.우선순위)) warn.push(`${f.id}: 우선순위 '${f.우선순위}' 는 규격 밖(그대로 옮긴다)`);
    feats.push(f);
  }
  return { feats, keep, tableAt, warn, fatal };
}

// YAML 에서 특별한 뜻을 갖는 글자가 있으면 큰따옴표로 감싼다. 여러 줄이면 블록으로 뺀다.
const quote = (raw) => {
  const s = raw == null ? "" : String(raw);
  if (s === "") return '""';
  if (s.includes("\n")) return null;
  return /^[-?:,[\]{}#&*!|>'"%@`]|:( |$)|\s#| $|^ /.test(s) ? JSON.stringify(s) : s;
};

export function toYaml(feats) {
  const out = [
    "# 기능 명세 — 형식의 단일 원본은 chageun `product-map` 스킬이다.",
    "# 표가 아니라 YAML 인 이유: 표는 값에 `|` 가 하나만 섞여도 뒤 칸이 조용히 밀린다.",
    "# 칸 8개는 전부 적는다(빈 값은 \"\"). 값에 : # | 가 있거나 맨 앞이 - 면 큰따옴표로 감싼다.",
    "features:",
  ];
  for (const f of feats) {
    out.push(`  - id: ${f.id}`);
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
  for (const line of yaml.split("\n")) {
    let m;
    if ((m = /^  - id: (.*)$/.exec(line))) { cur = { id: m[1] }; blk = null; back.push(cur); continue; }
    if (!cur) continue;
    if ((m = /^ {4}([^:]+): \|-$/.exec(line))) { blk = m[1]; cur[blk] = []; continue; }
    if (blk && /^ {6}/.test(line)) { cur[blk].push(line.slice(6)); continue; }
    blk = null;
    if ((m = /^ {4}([^:]+): (.*)$/.exec(line))) {
      let v = m[2];
      if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { /* 원문 유지 */ } }
      cur[m[1]] = v;
    }
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
// 치환됐다. 아래 세 겹 대조도 못 잡았다 — 셋 다 조립 **전**의 값만 봤기 때문이다.
// 그래서 자리 표시 문자열을 아예 없애고 줄 번호로 끼워 넣은 뒤, 조립 **후** 결과를 다시 뜯어 대조한다.
export function render(text) {
  const { feats, keep, tableAt, warn, fatal } = convert(text);
  const yaml = toYaml(feats);
  const diffs = fatal.length ? [] : verify(feats, yaml);
  let out = null;
  if (!fatal.length && !diffs.length) {
    const lines = keep.slice();
    lines[tableAt] = "```yaml\n" + yaml + "\n```";
    out = lines.join("\n");
    // 조립 후 대조: 결과 파일에서 YAML 블록을 도로 뜯어내 방금 만든 것과 글자 단위로 같은지 본다.
    const got = /```yaml\n([\s\S]*?)\n```/.exec(out);
    if (!got || got[1] !== yaml) {
      fatal.push("조립한 파일에서 YAML 블록을 도로 못 꺼냈다 — 손으로 확인해야 한다");
      out = null;
    }
  }
  return { feats, yaml, warn, fatal, diffs, out };
}

// 직접 실행할 때만 돈다. 이 가드가 없으면 테스트가 import 하는 순간 `process.argv[2]`(테스트 파일
// 경로)를 기능 명세로 알고 읽는다 — retrospect-scan.mjs 와 같은 방식.
const [, , path, flag] = process.argv;
if (import.meta.url === `file://${process.argv[1]}` && path) {
  const { feats, warn, fatal, diffs, out } = render(readFileSync(path, "utf8"));
  const chars = feats.reduce((n, f) => n + COLS.reduce((m, c) => m + (f[c] || "").length, 0), 0);

  console.log(path);
  console.log(`  기능 ${feats.length}개 · 셀 글자수 ${chars}`);
  console.log(`  칸 복원 대조 : ${fatal.length ? "❌ " + fatal.length + "건" : "✅ 이상 없음"}`);
  for (const x of fatal) console.log("     " + x);
  console.log(`  되돌림 대조 : ${fatal.length ? "건너뜀" : diffs.length ? "❌ " + diffs.length + "건" : "✅ 완전 일치"}`);
  for (const d of diffs.slice(0, 5)) console.log("     " + d);
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
