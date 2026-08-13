// 상황판 보는 페이지: 순수 부분(폴더 훑기 · 작은 마크다운 변환기).
//
// 왜 갈라 두나: HTTP 배선(board-server.mjs)과 판정을 나눠야 경계를 검사로 찍을 수 있다.
// 🛑 이 파일과 board-server.mjs 는 **읽기만** 한다. 상황판 파일에도 프로젝트 트리에도 안 쓴다
//    (단일 원본은 파일이고 페이지는 그것을 그릴 뿐이다). 유일한 예외는 서버의 실행 상태 파일
//    한 곳이고, 그 경로는 board-server.mjs 상단 상수(STATE_DIR·STATE_FILE)에서만 정한다.
import { readdirSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";

// 파일 이름은 언어와 무관하게 하나로 고정한다. 언어마다 이름이 갈리면 한 프로젝트에
// 상황판이 두 장 생기고, 모아 보는 페이지가 이름 하나만 알면 되는 성질이 깨진다.
const FILE = "status.md";
const MAX_DIRS = 50;
const MAX_BYTES = 512 * 1024;

// 기계가 쓰는 칸의 경계 표시. 화면에는 안 보여야 한다: esc() 가 `<` 를 `&lt;` 로 바꾸므로
// 안 버리면 글자로 그대로 뜬다. 🛑 일반 HTML 주석 처리를 넣지 않는다(넓히면 사람이 쓴
// 다른 주석까지 조용히 사라진다). **이 네 줄과 정확히 일치할 때만** 버린다.
const MARKERS = new Set([
  "<!-- chageun:auto -->",
  "<!-- /chageun:auto -->",
  "<!-- chageun:auto:head -->",
  "<!-- /chageun:auto:head -->",
]);
const isMarker = (l) => MARKERS.has(String(l).trim());

/**
 * 어느 폴더를 훑을지 정한다.
 * 🛑 **언제나 `{root, single}` 객체 하나로** 돌려준다. 문자열과 객체를 섞어 돌려주면
 *    받는 쪽이 어느 쪽인지 몰라 안전장치가 조용히 무시된다.
 * 홈 폴더·`/`·`/home` 이 부모면 형제 폴더를 아예 안 훑고 지금 프로젝트 하나만 본다.
 * (`env.HOME` 을 먼저 보는 이유: POSIX 의 homedir() 이 그 값을 읽는다 - 같은 사실을
 *  주입 가능하게 두어 검사가 진짜 홈을 어지럽히지 않고 이 갈래를 잰다.)
 */
export function resolveRoot(cwd, env = {}) {
  if (env.CHAGEUN_BOARD_ROOT) return { root: env.CHAGEUN_BOARD_ROOT, single: false };
  const home = env.HOME || homedir();
  const parent = dirname(cwd);
  if (parent === "/" || parent === "/home" || parent === home) return { root: cwd, single: true };
  return { root: parent, single: false };
}

function readHead(fsx, p, size) {
  const len = Math.max(0, Math.min(size, MAX_BYTES));
  // 🛑 크기를 먼저 보고 앞부분만 읽는다. 통째로 읽은 뒤 자르면 상한이 메모리를 안 지킨다.
  const fd = fsx.openSync(p, "r");
  try {
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = fsx.readSync(fd, buf, off, len - off, off);
      if (!n) break;
      off += n;
    }
    return buf.subarray(0, off).toString("utf8");
  } finally {
    fsx.closeSync(fd);
  }
}

/**
 * 상황판을 모은다. 요청 문자열로 경로를 만들지 않는다: 목록은 서버가 직접 훑어 만든다.
 * opts.single 이 참이면 root 폴더 **자신의** status.md 하나만 본다(홈 안전장치의 실효).
 * opts.fs 로 파일 시스템을 주입할 수 있다(검사가 경계를 찍을 때 쓴다).
 */
export function listBoards(root, opts = {}) {
  const fsx = opts.fs || { readdirSync, lstatSync, openSync, readSync, closeSync };
  const out = [];
  const push = (name, dir) => {
    const p = join(dir, FILE);
    let st;
    try { st = fsx.lstatSync(p); } catch (_) { return; }
    if (!st.isFile()) return;   // lstat 이라 심링크 파일은 여기서 걸러진다
    let text;
    try { text = readHead(fsx, p, st.size); } catch (_) { return; }
    out.push({ name, path: p, mtime: st.mtimeMs, text, truncated: st.size > MAX_BYTES });
  };
  if (opts.single) { push(basename(root) || root, root); return out; }
  let entries = [];
  try { entries = fsx.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  let n = 0;
  for (const d of entries) {
    if (n >= MAX_DIRS) break;
    if (d.name.startsWith(".")) continue;
    if (!d.isDirectory()) continue;   // withFileTypes 는 lstat 계열이라 심링크 폴더는 여기서 빠진다
    n++;
    push(d.name, join(root, d.name));
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * 폴더 이름 목록 → **주소용 조각** 목록.
 * 스크립트를 빼면서 주소 뒤 조각과 `id` 속성이 글자 그대로 맞아야 하게 됐다:
 * 빈칸이 든 이름(`my project`)을 그대로 쓰면 규격 위반이라 브라우저마다 다르게 군다.
 * 🛑 **표시용 이름은 손대지 않는다.** 화면에는 원래 폴더 이름이 그대로 나가고,
 *    조각은 `id`·`href` 에만 쓴다(한글 이름이 `-----` 로 보이면 안 된다).
 */
export function slugify(names) {
  const used = new Set();
  return (names || []).map((raw) => {
    let s = String(raw == null ? "" : raw)
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!s) s = "board";
    let out = s;
    for (let i = 2; used.has(out); i++) out = s + "-" + i;
    used.add(out);
    return out;
  });
}

// 탭에 붙일 숫자 = "지금 하실 것: N건" 의 N. 제목에 개수가 없으면 아무 표시도 안 한다
// (없는 숫자를 지어내지 않는다). ⚠ 배지로 읽는 것은 §1 하나뿐이다.
export function todoCount(text) {
  const m = String(text || "").match(/^#{1,4}\s*[^\n]*하실 것[^\n]*?(\d+)\s*건/m);
  return m ? Number(m[1]) : null;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 인라인: **굵게** · `코드`. 순서 주의: 코드 안의 별표는 굵게로 읽지 않는다.
export function inline(s) {
  const code = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => ` ${code.push(c) - 1} `);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return t.replace(/ (\d+) /g, (_, i) => `<code>${code[i]}</code>`);
}

// 표·목록·인용·제목만 다루는 작은 변환기. 바깥 라이브러리를 안 쓰는 이유는 이 페이지에
// 딸려 오는 코드를 늘리지 않기 위해서다. **링크 문법은 안 넣는다** - `javascript:` 주소가
// 생길 여지 자체를 없앤다.
export function md(src) {
  const lines = String(src == null ? "" : src).split("\n");
  const out = [];
  let i = 0;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));

  while (i < lines.length) {
    const l = lines[i];

    if (isMarker(l)) { i++; continue; }   // 경계 표시는 아무것도 안 내놓고 넘긴다
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^---+\s*$/.test(l)) { out.push("<hr>"); i++; continue; }

    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }

    if (isRow(l) && isRow(lines[i + 1] || "") && /^[\s|:-]+$/.test(lines[i + 1])) {
      const head = cells(l); i += 2;
      const body = [];
      while (i < lines.length && isRow(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push(
        '<div class="tw"><table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join("") +
        "</tr></thead><tbody>" +
        body.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") +
        "</tbody></table></div>"
      );
      continue;
    }

    if (/^\s*>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }

    const ol = /^\s*\d+\.\s+(.*)$/, ul = /^\s*[-*]\s+(.*)$/;
    if (ol.test(l) || ul.test(l)) {
      const ordered = ol.test(l);
      const tag = ordered ? "ol" : "ul";
      const buf = [];
      const re = ordered ? ol : ul;
      while (i < lines.length) {
        const m = lines[i].match(re);
        if (m) { buf.push(inline(m[1])); i++; continue; }
        // 들여쓴 이어지는 줄은 바로 앞 항목에 붙인다. 안 붙이면 목록이 거기서 끊겨
        // 다음 항목이 다시 1번부터 매겨진다.
        if (buf.length && /^\s{2,}\S/.test(lines[i]) && !isRow(lines[i]) && !isMarker(lines[i])) {
          buf[buf.length - 1] += "<br>" + inline(lines[i].trim()); i++; continue;
        }
        break;
      }
      out.push(`<${tag}>` + buf.map((x) => `<li>${x}</li>`).join("") + `</${tag}>`);
      continue;
    }

    // ⚠ 참고 구현은 여기서 `\s*[->*]` 로 걸렀는데, 그러면 **굵게** 로 시작하는 줄이
    //   목록 시작으로 잡혔다가 목록 정규식(`*` 뒤 빈칸 필요)에도 안 맞아 **통째로 사라졌다**
    //   (직접 확인). 상황판은 굵은 글로 줄을 시작하는 문서라 조용한 유실이 실제로 난다.
    //   목록 판정을 실제 목록 정규식과 같게(빈칸 필요) 좁힌다.
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isMarker(lines[i])
      && !/^(#{1,4}\s|---+\s*$|\s*>|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !isRow(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
    else i++;
  }
  return out.join("\n");
}

export function ago(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export { FILE, MAX_BYTES, MAX_DIRS };
