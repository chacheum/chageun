// chageun P4 design color backstop — pure detection for the Claude PreToolUse hard-block.
// Reimplements check-design-violations.sh's TWO color rules in node. Why not shell-out the .sh:
// in a hook there's no git staged yet (staged mode passes empty = silent worst case) and --all is
// an unbounded tree scan (10s timeout). So detection here reads ONLY tool_input content/new_string
// (no tree scan). docs/design-system.md existence gates it; its front-matter lint-allow-colors gives
// the palette exceptions. Claude-only (Codex lacks PreToolUse). P3(soft reminder)와 별개 채널 = 기계 강제층.
"use strict";
const fs = require("fs");
const path = require("path");

// .sh 원본과 동일: Tailwind 팔레트 22종.
const PALETTE = ["slate","gray","zinc","neutral","stone","red","orange","amber","yellow","lime","green","emerald","teal","cyan","sky","blue","indigo","violet","purple","fuchsia","pink","rose"];
// 색 관련 유틸리티 접두. ring-offset를 ring보다 먼저 둬 더 긴 접두가 우선 매칭되게(정확한 토큰 추출).
const PROPS = ["bg","text","border","ring-offset","ring","from","via","to","fill","stroke","outline","accent","caret","decoration","divide","shadow"];
// 색 검사 대상 파일 = .sh 글롭과 동일. css/scss 제외: 그 파일들의 hex는 토큰 '정의'라 정상(오탐 방지).
const SCAN_TARGET_RE = /\.(tsx|ts|jsx|js|vue|svelte|astro)$/i;
function isDesignScanTarget(p) { return SCAN_TARGET_RE.test(String(p || "")); }

// design-system.md front-matter의 `lint-allow-colors:` — 팔레트명을 시맨틱 토큰으로 재사용할 때만 예외.
// 첫 `---`~다음 `---` 사이(front-matter)만 본다. 템플릿 플레이스홀더(`<예: ...>`)는 무시.
function parseAllowColors(docText) {
  const text = String(docText || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const line = m[1].split(/\r?\n/).find((l) => /^lint-allow-colors:/.test(l));
  if (!line) return [];
  const val = line.replace(/^lint-allow-colors:\s*/, "").replace(/\s*#.*$/, "").trim();
  if (!val || val.startsWith("<")) return [];
  return val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// 주어진 텍스트에서 raw 색 매치를 모두 뽑는다. 반환: [{token, rule}].
// `design-lint-ignore` 주석이 있는 라인은 그 줄만 건너뜀(전체 우회 CHAGEUN_SKIP_DESIGN_LINT와 구분).
// 룰1: (prop)-(palette)-<digits>  · 룰2: -[#hex(3자+)] 또는 -[(rgb|rgba|hsl|hsla)(  (.sh와 동일 범위).
const MAX_SCAN = 512 * 1024; // 거대한 입력은 스캔 skip(fail-open) — readDesignDoc MAX_DOC과 대칭.
function scanColors(text, allow) {
  const s = String(text || "");
  if (s.length > MAX_SCAN) return [];
  const allowed = new Set(allow || []);
  const palette = PALETTE.filter((p) => !allowed.has(p));
  const rule1 = palette.length
    ? new RegExp(`(?:${PROPS.join("|")})-(?:${palette.join("|")})-\\d+`, "g") : null;
  // 앞의 속성 접두까지 포함해 메시지를 친절하게(text-[#ff0000). 접두는 {0,40}로 바운드(긴 단어런
  // 백트래킹 O(n^2) 방지 — 실제 접두 ring-offset 등은 40자 훨씬 이하). hex는 3자+ 무한(.sh와 동일).
  const rule2 = /[\w-]{0,40}-\[(?:#[0-9a-fA-F]{3,}|(?:rgb|rgba|hsl|hsla)\()/g;
  const out = [];
  for (const line of s.split(/\r?\n/)) {
    if (line.includes("design-lint-ignore")) continue;
    let mm;
    if (rule1) { rule1.lastIndex = 0; while ((mm = rule1.exec(line))) out.push({ token: mm[0], rule: "palette" }); }
    rule2.lastIndex = 0; while ((mm = rule2.exec(line))) out.push({ token: mm[0], rule: "arbitrary" });
  }
  return out;
}

// new에는 있고 old에는 없던 '색 토큰'만(브라운필드-터치 오탐 방지: 기존 색 줄을 다른 이유로 고쳐도
// 그 색은 old에도 있어 안 걸림). content/new_string만 사용(제약 a) · fs 접근 없음(순수).
function newColors(oldStr, newStr, allow) {
  const oldSet = new Set(scanColors(oldStr, allow).map((m) => m.token));
  return scanColors(newStr, allow).filter((m) => !oldSet.has(m.token));
}

// tool_input에서 '새로 추가된 색' 위반. Edit/MultiEdit는 old 대비 신규 토큰만.
// Write는 old가 없어(전체가 신규일 수도, 브라운필드 재작성일 수도) 여기선 판정 불가 → null 반환,
// wrapper가 fs.existsSync로 '신규 파일'일 때만 content 전체를 검사한다(기존 파일 통짜 덮어쓰기는 v1 미차단).
function violationsForEdit(toolName, ti, allow) {
  const t = ti || {};
  if (String(toolName) === "Edit") return newColors(t.old_string, t.new_string, allow);
  if (String(toolName) === "MultiEdit" && Array.isArray(t.edits)) {
    const out = [];
    for (const e of t.edits) out.push(...newColors(e && e.old_string, e && e.new_string, allow));
    return out;
  }
  return null; // Write(및 그 외)는 wrapper 처리
}

// 게이트 + 허용목록 원본: docs/design-system.md(또는 DESIGN_LINT_DOC) 1개 파일만 읽는다(트리 스캔 아님).
// 부재·초과·예외 → null(게이트 off = 미채택 프로젝트 완전 침묵).
const MAX_DOC = 256 * 1024;
function readDesignDoc(cwd) {
  try {
    const base = cwd || ".";
    const docPath = process.env.DESIGN_LINT_DOC
      ? path.resolve(base, process.env.DESIGN_LINT_DOC)
      : path.join(base, "docs", "design-system.md");
    const st = fs.statSync(docPath);
    if (!st.isFile() || st.size > MAX_DOC) return null;
    return fs.readFileSync(docPath, "utf8");
  } catch (_) { return null; }
}

module.exports = { isDesignScanTarget, parseAllowColors, scanColors, newColors, violationsForEdit, readDesignDoc, PALETTE, PROPS };
