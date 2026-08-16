// 상황판 §2("지금 뒤에서 도는 것")와 머리 블록을 기계가 쓰기 위한 **순수 함수**들(v0.65.0 F-27 · T2c).
//
// 🛑 **fs 가 없다.** 파일 읽기·쓰기·git 은 전부 `posttooluse.js` 쪽에 있다. 여기 계약을 순수하게
//    두는 이유는 검사가 **직접 부를 수 있어야** 하기 때문이다: 배선은 자식 프로세스로 돌아
//    안쪽 계수기를 부모가 못 읽는다. 소스 문자열로 대신 재는 검사는 아무것도 안 잡는다.
//
// 🛑 **누출 화이트리스트: 이름 · 상태 · 시각 셋만 밖으로 나간다.** 상황판은 비밀번호가 없는
//    평문 보고서라, 아래 넷은 어떤 경로로도 이 파일이 만드는 문자열에 못 들어간다.
//      1. `<result>` 본문(서브에이전트 보고 전문 · 평균 7,680자): **자르고 파싱조차 안 한다.**
//      2. `agentId`/`<task-id>`: 스폰 안내문이 스스로 "사용자에게 보이지 말라"고 적는다.
//         장부의 **열쇠로만** 살고 렌더링에는 한 글자도 안 쓴다.
//      3. `<output-file>`·경로 일체: 계정 이름이 드러난다.
//      4. `<summary>` 통째 - 실측에 `Agent "이름" failed: … You've hit your session limit ·
//         resets 8:40pm` 처럼 **따옴표 뒤에 계정 사정**이 붙는다. 따옴표 안쪽만 뽑는다.
"use strict";
const { redact } = require("./secret-scan-core.js");

// 🛑 닫힌 낱말 목록. **목록 밖은 전부 "모름"** 이다: 새 값이 생겨도 지어내지 않는다.
const ENDED = { completed: "끝남", failed: "멈춤", killed: "멈춤", stopped: "멈춤" };
/**
 * 일감 레코드가 **띄움**인가. 🛑 **띄움만 좁게 알아보고 그 밖은 전부 끝남으로 넘긴다.**
 * 뒤집어 "끝남을 닫힌 목록으로" 읽으면, 목록 밖 값이 온 일감은 상태가 **빈 채로** 남아
 * §2 에서 "도는 중"으로 세어지고 12시간을 버틴다 - 이 파일이 막으려던 유령이 옆자리에서
 * 되살아난다. 같은 파일의 형제 경로(`collectNotif`)는 이미 어떤 값이든 그대로 적어
 * `stateOf` 가 "모름"으로 떨어뜨린다: **같은 판정에 처분이 둘이면 안 된다.** 값을 그대로
 * 넘기므로 틀린 "끝남"도 안 생긴다("모름"은 끝남이 아니다).
 * 🛑 앞에서 기다린 일감에는 **뒤따라올 알림이 없다.** 뒤에서 띄운 것은 나중에 알림이 와서
 *    고쳐지지만, 앞단은 그 레코드가 유일한 기회다.
 * 🛑 **칸 두 개를 함께 본다.** 하나만 남기면 그쪽 칸이 빠진 레코드가 반대로 뒤집힌다.
 *    실측(이 저장소 트랜스크립트 31개 · 2026-08-17)에서 `agentId` 를 든 띄움 284건은 둘 다
 *    갖고 있었고, `async_launched` 인데 `isAsync` 가 없는 레코드 2건은 **`agentId` 대신
 *    `taskId` 를 써서** 이 갈래에 아예 안 들어왔다(각본 띄우기). 그러니 이 `||` 는 지금
 *    무엇을 고치는 것이 아니라 **뒷문을 미리 막는 쪽**이다.
 */
const isLaunch = (status, tur) => status === "async_launched" || !!(tur && tur.isAsync === true);
const STALE_MS = 12 * 3600 * 1000;      // 띄움만 보고 이만큼 지나면 "도는 중"이라 안 한다
const MAX_TASKS = 50;                    // 장부 상한(오래된 것부터 버린다)
const MAX_ROWS = 20;                     // 표 상한
const NAME_MAX = 40;
// `<summary>` 에서 따옴표 안쪽만. 앞머리 넷은 실측으로 나온 것 전부다.
const QUOTED_RE = /^(?:Agent|Background command|Dynamic workflow|Monitor)\s+"([^"]*)"/;

const pad2 = (n) => (n < 10 ? "0" + n : String(n));
function fmtAbs(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function fmtHM(ms) {
  const d = new Date(ms);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// ── 조각 파싱 ────────────────────────────────────────────────────────────────
// 알림 하나에서 셋만 뽑는다. 🛑 `<result>` 앞에서 자르고 그 뒤는 쳐다보지 않는다.
function collectNotif(text, at, out) {
  const s = String(text || "");
  if (s.indexOf("<task-notification>") === -1) return;
  const parts = s.split("<task-notification>");
  for (let i = 1; i < parts.length; i++) {
    const cut = parts[i].indexOf("<result>");
    const head = cut === -1 ? parts[i] : parts[i].slice(0, cut);
    const id = /<task-id>([^<]*)<\/task-id>/.exec(head);
    if (!id) continue;
    const st = /<status>([^<]*)<\/status>/.exec(head);
    const sm = /<summary>([^<]*)<\/summary>/.exec(head);
    const q = sm ? QUOTED_RE.exec(sm[1].trim()) : null;
    out.push({ taskId: id[1].trim(), status: st ? st[1].trim() : "", quoted: q ? q[1] : "", at });
  }
}
/**
 * 트랜스크립트 **조각**(늘어난 부분)에서 띄움과 끝남만 뽑는다.
 * 🛑 조각은 **반쪽 줄에서 시작할 수 있다**: `{` 로 시작하지 않는 줄은 버린다.
 * 짝은 `agentId` ↔ `<task-id>` 로만 짓는다(`<tool-use-id>` 는 실측 66.3%라 안 쓴다).
 *
 * 🛑 **일감 레코드는 런타임이 실은 칸(`toolUseResult.agentId`)으로만 알아본다. 글자로 안 찾는다.**
 *    옛 판은 도구 결과 **본문**에서 `agentId:` 를 찾았는데, 그 글자는 아무 도구나 낼 수 있다:
 *    이 파일을 `grep` 한 Bash 출력이 자기 소스 줄(`spawns.push({ agentId: m[1]`)을 되비쳐
 *    **`m` 이라는 유령 일감**을 §2 에 올렸고, 이름표는 그 Bash 호출의 설명이었다(실측 2세션 ·
 *    2026-08-12 · 2026-08-16). 차근 코드를 들여다볼 때마다 상황판이 오염된다는 뜻이다.
 *    같은 판정을 구조화된 칸으로 짓는 형제가 이미 있다(`pretooluse-core.js` 의 `hasPrReviewer`).
 *    실측 대조(이 저장소 트랜스크립트 31개 · 2026-08-17): 글자와 칸이 함께 잡은 것 328건 ·
 *    **글자만 2건**(둘 다 위 유령) · **칸만 9건**(글자가 놓친 진짜 일감 - 전부 앞에서 기다린
 *    것이고, 보고 본문에 그 낱말이 우연히 없었을 뿐이다). 좁히면서 동시에 넓어진다.
 *
 * 🛑 **띄움과 끝남은 "띄움이냐 아니냐"로 가른다. `agentId` 가 있다고 끝난 것이 아니다.**
 *    뒤에서 띄운 것은 **뜰 때도** 같은 칸에 `agentId` 를 실어 온다(`async_launched` · 실측 284건).
 *    "칸이 있으면 끝남"으로 읽으면 뒤에서 도는 일감이 **뜨자마자 끝난 것으로 뒤집힌다** - 지금의
 *    틀린 "도는 중"보다 나쁘다(사장님이 안 끝난 일을 끝났다고 믿는다). 앞에서 기다린 것만 결과가
 *    그 자리에서 돌아온다(실측 55건 전부 `completed`). 가르는 자리는 `isLaunch` 한 곳이고,
 *    **띄움이 아닌 값은 목록 밖이라도 끝남에 적되 값을 그대로 넘긴다**(그쪽 🛑).
 * @returns {{spawns: Array, ends: Array}}
 */
function parseDelta(chunk) {
  const spawns = [], ends = [];
  const names = new Map();                     // tool_use_id → description(1순위 이름)
  for (const line of String(chunk || "").split("\n")) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    let o; try { o = JSON.parse(s); } catch (_) { continue; }
    const at = Date.parse((o && o.timestamp) || "") || 0;
    const msg = (o && o.message) || o;
    const content = msg && msg.content;
    // 일감 레코드. 칸은 `message` 안이 아니라 **레코드 맨 바깥**에 실려서, 결과 본문이 글이든
    // 배열이든 상관없이 여기서 한 번에 본다(아래 두 갈래보다 먼저 두는 이유).
    const tur = o && o.toolUseResult;
    if (tur && typeof tur === "object" && tur.agentId) {
      const agentId = String(tur.agentId);
      // 이름표는 이 결과가 답한 **그 호출**의 것만 쓴다. 결과 블록이 정확히 하나일 때만 짝을
      // 짓는다: 모호하면 이름 없이 둔다(형제 `hasPrReviewer` 의 1:1 조인과 같은 규율).
      let key = "";
      if (Array.isArray(content)) {
        const rs = content.filter((b) => b && b.type === "tool_result" && b.tool_use_id);
        if (rs.length === 1) key = String(rs[0].tool_use_id);
      }
      // 앞에서 기다린 것은 **뜬 기록이 따로 없다.** 띄움도 함께 적어야 장부에 줄이 생긴다
      // (부르는 쪽은 장부에 없는 끝남으로 줄을 만들지 않는다 - `posttooluse.js` 의 🛑). 표에
      // 나가는 시각은 `끝` 쪽 하나뿐이라(`rowsOf` 가 `endedAt` 을 먼저 쓴다) 없는 시각을 지어내지 않는다.
      // 이름표 2순위는 **레코드 자신이 든 것**이다. 조각이 갈리면 호출 줄이 지난 회차로 넘어가
      // `names` 가 비는데, 띄움 레코드는 `description` 을 자기 안에 싣고 온다(실측 284/284).
      // ⚠ **앞에서 기다린 레코드에는 그 칸이 없다**(실측 55건 중 0건) - 그쪽은 `names` 가 유일한
      //    길이라 여기서 더 해 줄 것이 없다. 이 값도 부르는 쪽에서 `safeName` 을 지나 가려진다.
      spawns.push({ agentId, name: names.get(key) || String(tur.description || ""), at });
      const st = String(tur.status || "");
      if (!isLaunch(st, tur)) ends.push({ taskId: agentId, status: st, quoted: "", at });
    }
    if (typeof content === "string") { collectNotif(content, at, ends); continue; }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (b.type === "tool_use" && b.input && typeof b.input.description === "string") {
        // 🛑 **위임 도구 이름으로 안 거른다.** 새 정규식을 적지 않는다(같은 판에서 F-29 가
        //    "위임 도구는 그 두 이름이 아니다"를 사실로 만들었고, 사본을 만들면 통로가 늘 때
        //    한쪽만 고쳐진다). 이름표를 아무 도구에서나 모아 두고, **`agentId` 칸을 실어 돌아온
        //    호출의 것만** 골라 쓴다: 짝짓기는 그 열쇠가 하므로 이 쪽은 넓어도 안전하다.
        names.set(String(b.id || ""), b.input.description);
      } else if (b.type === "text") {
        collectNotif(b.text, at, ends);
      }
    }
  }
  return { spawns, ends };
}

// 조각의 지문. 자리(offset)와 함께 적어 두고 다음 회차에 대조한다: 이 훅은 **자기가
// 트랜스크립트를 고쳐 쓰므로**(G7 가리기가 기록된 항목을 대체한다) 크기가 줄지 않고도
// 자리가 밀린다. 안 맞으면 자리를 버린다.
function fingerprintOf(chunk) {
  const lines = String(chunk || "").split("\n").filter((l) => l.trim());
  if (!lines.length) return "";
  const last = lines[lines.length - 1];
  try {
    const o = JSON.parse(last);
    if (o && typeof o.uuid === "string" && o.uuid) return o.uuid;
  } catch (_) { /* 아래 해시로 */ }
  return require("crypto").createHash("sha1").update(last).digest("hex").slice(0, 16);
}

/**
 * 조기 탈출 판정. 거짓이면 JSON 파싱을 **한 줄도 안 한다**.
 * 🛑 장부에 아직 안 끝난 일감이 있으면 참이다: 시간만 흘러도 "도는 중"이 "모름"으로
 *    뒤집히므로(12시간) 그 회차에 표를 다시 그려야 한다.
 * 🛑 **미뤄 둔 쓰기가 있어도 참이다.** 미룬 회차는 장부만 적고 파일을 안 건드리는데, 그 빚을
 *    갚는 자리가 이 문 **뒤**에 있다. 조각에 온 새 소식으로만 문을 열면, 마지막 일감이 끝난
 *    회차에 미뤘을 때 갚을 기회가 영영 안 온다(끝났으니 바로 위 갈래도 함께 닫힌다).
 *    그러면 §2 가 마지막으로 쓴 시각에 얼어붙어 **끝난 일을 계속 "도는 중"으로 보여 준다** -
 *    자리를 비웠다 돌아온 사람이 정반대로 읽는, 상황판이 막으려던 바로 그 결과다.
 *    🛑 **표시를 내리는 것은 부르는 쪽(`posttooluse.js` 의 autoBoard)이고, 자리가 셋이다**:
 *      ① 쓰기가 실제로 나갔을 때 ② 상황판을 못 읽을 때 ③ 무시 판정이 통과가 아닐 때.
 *      ②③ 은 못 갚은 갈래인데 **곧장 안 내리고 몇 회차까지 들고 있다가 내린다**(그쪽
 *      `PENDING_TRIES_MAX`). 못 갚는 이유의 수명이 둘로 갈리기 때문이다: `blocked` 는 캐시가
 *      세션 내내 굳어 안 풀리지만, `unknown`(git 2초 타임아웃)은 5분 뒤 다시 재므로 일시적이다.
 *      곧장 내리면 그 일시적인 쪽에서 §2 가 얼어붙고, 안 내리면 이 문이 세션 내내 열린 채가 되어
 *      한 글자도 못 쓰는 프로젝트에서 도구 호출마다 파싱 비용만 나간다. 한도가 그 둘을 다 막는다.
 *      내려도 잃는 것은 없다 - 표는 조각이 아니라 장부 전체로 다시 그리므로 다음 소식 때 그
 *      변화도 함께 나간다.
 *      켜는 자리는 하나뿐이다: **이번 회차의 도구 대상이 상황판 파일이었을 때.**
 */
function shouldParse(chunk, ledger) {
  const s = String(chunk || "");
  // 🛑 **찾는 글자도 칸 이름이다**(`"agentId"` = JSON 에 그 칸이 적힌 모양). 도구 결과 **본문**의
  //    `agentId:` 로 문을 열던 옛 판은, 그 낱말을 낸 평범한 출력마다 최대 4MB 조각을 통째로
  //    파싱하고 비밀값까지 걷었다. `parseDelta` 가 이제 본문을 아예 안 보므로 그 문을 열어 둘
  //    이유가 없다. 두 자리는 **같은 근거로 함께** 움직인다: 여기만 좁히면 진짜 소식을 놓치고,
  //    저기만 좁히면 헛비용이 남는다.
  if (s.indexOf("\"agentId\"") !== -1 || s.indexOf("<task-notification>") !== -1) return true;
  if (ledger && ledger.pendingWrite === true) return true;
  const tasks = (ledger && ledger.tasks) || ledger || {};
  for (const k of Object.keys(tasks)) {
    const t = tasks[k];
    if (t && !t.status) return true;
  }
  return false;
}

// ── 이름 손질 ────────────────────────────────────────────────────────────────
/**
 * ① 줄바꿈·표 구분자를 빈칸으로 ② 비밀 값 가리기 ③ 40자에서 자르기 ④ 특수문자 이스케이프.
 * 🛑 기계는 사람에게 "다시 쓰세요"를 못 하므로 **막는 게 아니라 가린다**(§2.0 과 같은 부품).
 */
function safeName(raw, secrets) {
  let s = String(raw == null ? "" : raw).replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(secrets) && secrets.length) s = redact(s, secrets).text;
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX) + "…";
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([`*_[\]])/g, "\\$1");
  return s.trim() ? s : "(이름 없음)";
}

// ── 상태 · 렌더링 ────────────────────────────────────────────────────────────
/** 닫힌 목록 밖은 전부 "모름". 끝남을 못 봤는데 12시간이 지났어도 "모름"이다. */
function stateOf(task, now) {
  if (!task) return "모름";
  const st = String(task.status || "");
  if (st) return ENDED[st] || "모름";
  const at = Number(task.spawnedAt) || 0;
  if (!at || (Number(now) || 0) - at > STALE_MS) return "모름";
  return "도는 중";
}

/**
 * 장부 전체를 줄로 만들고, **"도는 중"으로 먼저 채운 뒤** 남는 자리에 나머지를 넣어 자른다.
 *
 * 🛑 **자르기가 §2 의 존재 이유부터 자르지 않게 하는 순서다.** 정렬 열쇠(`endedAt || spawnedAt`)는
 *    끝난 것에 **끝난 시각**(최신)을, 도는 것에 **띄운 시각**(과거)을 준다. 그래서 한 줄로 세워
 *    자르면 상한에서 **먼저 밀려 나가는 것이 지금 도는 것**이다: 두 시간째 도는 일꾼 하나가
 *    그 사이 스무 번 오간 검토에 밀려 표에서 사라지고, 자리를 비웠다 돌아온 사람이 다 끝난 줄
 *    알고 창을 닫는다 - 이 칠판이 막으려던 바로 그 결과다.
 * 🛑 **개수는 자르기 전 장부 전체로 센다.** 자른 결과에서 세면 위 상황에서 제목이 "0건"이 된다.
 * 🛑 묶음 **안**의 차례는 그대로 최신 먼저다(`at` 내림차순). 바뀌는 것은 묶음 순서뿐이라
 *    표가 보기에 뒤죽박죽이 되지 않는다.
 * @returns {{rows: Array, running: number}} `running` 은 **장부 전체**의 "도는 중" 수
 */
function rowsOf(tasks, now) {
  const all = [];
  for (const id of Object.keys(tasks || {})) {
    const t = tasks[id];
    if (!t) continue;
    all.push({
      name: t.name || "(이름 없음)",
      state: stateOf(t, now),
      at: Number(t.endedAt) || Number(t.spawnedAt) || 0,
      ended: !!t.endedAt,
    });
  }
  all.sort((a, b) => b.at - a.at);
  const running = all.filter((r) => r.state === "도는 중");
  const rest = all.filter((r) => r.state !== "도는 중");
  return { rows: running.concat(rest).slice(0, MAX_ROWS), running: running.length };
}

/**
 * 두 표시 사이에 들어갈 §2 블록. 🛑 제목의 `N건` 은 **장부 전체**의 "도는 중" 수를 기계가
 * 다시 쓴다(표의 줄 수가 아니다 - `rowsOf` 의 🛑). 표는 `MAX_ROWS` 에서 잘리므로 도는 것이
 * 그보다 많으면 숫자가 표보다 클 수 있는데, **어긋나는 방향이 한쪽으로 고정된다**: 안 보이는
 * 것이 있다는 사실은 숫자가 알려 주고, 없는 일을 있다고 말하지는 않는다.
 * 🛑 시각은 **절대 표기만**. "3분 전"은 갱신이 멎으면 거짓말을 계속한다.
 */
function renderBlock(tasks, now) {
  const { rows, running } = rowsOf(tasks, now);
  const head = "## 2. 지금 뒤에서 도는 것: " + running + "건";
  const stamp = "> 마지막 확인 " + fmtAbs(now);
  if (!rows.length) return head + "\n\n없습니다.\n\n" + stamp;
  const lines = ["| 일감 | 상태 | 시각 |", "|---|---|---|"];
  for (const r of rows) {
    lines.push("| " + r.name + " | " + r.state + " | " + (r.at ? fmtHM(r.at) + (r.ended ? " 끝" : " 띄움") : "모름") + " |");
  }
  return head + "\n\n" + lines.join("\n") + "\n\n" + stamp;
}

/**
 * 머리 블록 두 줄. 🛑 `…에 썼습니다` 로 안 쓴다: 기계는 사람이 **쓴** 순간을 못 보고
 * **바뀐 것을 본** 때만 안다. 그래서 "적어도 …부터"다(틀리는 방향이 한쪽으로 고정된다:
 * 실제보다 오래돼 보일 수는 있어도 새것으로 보이지는 않는다).
 * 🛑 못 본 것을 `지금` 으로 채우지 않는다: 방금 깐 기계가 몇 주 묵은 §1을 "방금 확인함"으로 만든다.
 */
function renderHead(machineWroteAt, humanSeenAt) {
  const l1 = "> 기계가 이 파일을 마지막으로 고친 때 **" + fmtAbs(machineWroteAt) + "**";
  const l2 = humanSeenAt
    ? "> 사람이 쓰는 칸(§1 · §3~§7)은 **적어도 " + fmtAbs(humanSeenAt) + " 부터** 안 바뀌었습니다"
    : "> 사람이 쓰는 칸(§1 · §3~§7)이 언제 바뀌었는지 모릅니다";
  return l1 + "\n" + l2;
}

// ── 경계 표시 ────────────────────────────────────────────────────────────────
const openOf = (mark) => "<!-- " + mark + " -->";
const closeOf = (mark) => "<!-- /" + mark + " -->";
const countOf = (text, needle) => text.split(needle).length - 1;

/**
 * 두 표시가 **짝으로, 여는 것이 먼저, 각각 하나씩**일 때만 사이를 갈아 끼운다.
 * 그 밖(한쪽 없음 · **아예 없음** · 순서 뒤바뀜 · 둘 이상)은 `null` = **한 글자도 안 쓴다.**
 * 🛑 자리를 짐작해 새로 넣지 않는다. "아예 없음"이 **이미 있는 상황판의 기본 상태**이고,
 *    사람이 고쳐 놓은 글에서 "여기가 §2였을 것"이라 짐작해 끼워 넣는 것이 사람 글을 지우는
 *    가장 흔한 길이다. 없다는 사실을 사람에게 알리는 일은 세션 시작 부록이 한다.
 */
function spliceBlock(fileText, block, mark) {
  const text = String(fileText || "");
  const open = openOf(mark), close = closeOf(mark);
  if (countOf(text, open) !== 1 || countOf(text, close) !== 1) return null;
  const a = text.indexOf(open), b = text.indexOf(close);
  if (b < a + open.length) return null;
  return text.slice(0, a + open.length) + "\n" + String(block == null ? "" : block) + "\n" + text.slice(b);
}

/**
 * 파일에서 **두 기계 블록을 표시 포함 통째로 뺀** 나머지.
 * 🛑 §2 블록을 안 빼면 **기계 자신의 쓰기가 "사람이 고쳤다"로 잡혀** 시각이 매번 움직인다.
 */
function humanText(fileText) {
  let t = String(fileText || "");
  for (const mark of ["chageun:auto", "chageun:auto:head"]) {
    const open = openOf(mark), close = closeOf(mark);
    for (let guard = 0; guard < 8; guard++) {
      const a = t.indexOf(open);
      if (a === -1) break;
      const b = t.indexOf(close, a);
      if (b === -1) break;
      t = t.slice(0, a) + t.slice(b + close.length);
    }
  }
  return t;
}

module.exports = {
  parseDelta, safeName, stateOf, renderBlock, spliceBlock, shouldParse, fingerprintOf,
  humanText, renderHead, fmtAbs, fmtHM, MAX_TASKS, MAX_ROWS, STALE_MS,
};
