// chageun finish-work — Stop 훅.
// 에이전트가 "이제 ~하겠습니다"처럼 작업을 하겠다고 말만 하고 실제 도구 실행 없이 턴을 끝내면
// 되돌려 지금 하게 한다(보수적: 통과 넓게 / 차단 좁게). 결정론적, 외부 호출 없음, 실패 시 안전 통과.
// 개인/회사 정보 없음. shouldBlock·G7 누출 백스톱은 finish-work-codex.mjs와 동일 로직(듀얼 미러 — 함께 갱신).

// 사용자 대기/질문 신호가 있으면 통과(chageun가 정상적으로 묻고 멈추는 경우).
// bare "알려"·"검토"는 제외 — 약속 문장("검토하겠습니다")까지 통과시켜 브레이크를 무력화했음.
// 의문형("검토할까요?"·"알려주세요")은 [?]·할까요·주세요가 여전히 잡는다.
const WAIT_RE = /[?]|할까요|갈까요|드릴까요|주세요|골라|선택|진행해도|어느|확인해|괜찮(을까|나요)|승인|합의|기다리|다음\s*단계|진행\s*보고|멈춤|shall i|would you|do you want|let me know|which option|approve|confirm|waiting for/i;
// 명백한 미래형 작업 약속만 차단. 작업 동사는 현재형(합니다)도 약속으로 보지만,
// 보고성 동사(검토·보고·알려·공유·설명·정리)는 미래형(하겠/할게)에서만 잡는다 —
// "다음과 같이 정리합니다"처럼 지금 실제로 요약하는 현재형 마무리를 오차단하지 않도록.
const PROMISE_RE = /(이제|곧|다음(엔|은)?|바로)\s*[^.!?\n]{0,40}(?:(구현|만들|작성|수정|실행|추가|저장|시작|진행)(하겠|할게|할께|하겠습니다|할게요|합니다)|(검토|보고|알려|공유|설명|정리)(하겠|할게|할께|하겠습니다|할게요))|(완료|끝나|이후|나중)[^.!?\n]{0,20}(알려|보고|공유|검토)[^.!?\n]{0,10}(드리|하)(겠|ㄹ게)|\b(I'?ll|I will|let me|now I|next,? I)\b[^.!?\n]{0,60}\b(implement|create|write|add|run|fix|save|build|start|proceed|review|report|share|explain|summarize)\b/i;

// 끝 400자만 검사. 대기 신호가 있으면 통과, 없고 약속만 있으면 차단.
function shouldBlock(text) {
  const tail = (text || "").trim().slice(-400);
  if (!tail) return false;
  if (WAIT_RE.test(tail)) return false;
  return PROMISE_RE.test(tail);
}

const REASON = "직전 응답이 작업을 하겠다고 말만 하고 실제로 하지 않은 채 끝났습니다. 지금 그 작업을 도구로 수행하세요. 작업이 끝났거나 사용자만 줄 수 있는 입력이 필요할 때만 턴을 끝내세요.";
const REASON_NOEVIDENCE = "\"돌려봤다/테스트 통과\"처럼 실제로 실행한 것처럼 말했지만, 이번 요청 동안 도구를 한 번도 쓰지 않았습니다. 코드를 읽어 짐작하지 말고 실제로 돌려(테스트·실행·스크린샷) 확인한 뒤 그 증거로 보고하세요.";

// 실행 주장(돌려봤다/테스트 통과 등). 보고어휘(✅·성공 기준·완료)는 제외 — 정상 끝 점검 오차단 방지.
const EXEC_CLAIM_RE = /돌려\s*(보|봤|본)|실행해\s*(보|봤|본)|테스트[^.!?\n]{0,20}통과|스크린샷[^.!?\n]{0,10}(찍|캡처)|직접\s*눌러|구동\s*검증[^.!?\n]{0,10}(완료|했|끝)|실제로\s*(확인|실행)|눌러\s*(보|봤)/;

// P1 스킬갭 가드: 절차 스킬(지연로드)의 저발동 기계 백스톱 — 결정 시점(턴 종료) 검사.
// 차단 좁게: FULL 끝 점검 채점 텍스트(끝 점검/자가점검 + 채점 표시 2개 이상, LIGHT 제외)와
// 실구동 완료 주장만 반응. 채점 표시 1개는 설명일 수 있어 침묵(오탐 축소).
// 세션 내 스킬 로드 1회면 통과(스펙 🙋 합의 — 훅은 바닥, "매번 로드" 규칙 자체는 각 절이 정의).
// v0.42: 회고 탐지기(retrospect-scan.mjs GATES[].ctx)가 이 훅보다 넓어 실측 10건 중 7건이 **어휘**로 샜다
// ("완료했습니다 + 채점표"는 잡히지 않았다). 완료 어휘를 여기 더해 두 탐지기를 맞춘다.
// **marks >= 2 는 필수 조건으로 유지한다** — `성공 기준`은 이 워크플로우의 정본 라벨이라 거의 모든 FULL
// 턴에 나오고, 그걸 단독 신호로 쓰면 중간 진행 보고가 걸린다(plan-validator F-9).
const FINISH_TEXT_RE = /(끝\s*점검|자가점검|마무리(했|합니다)|다\s*됐|완료(했|됐|됨|입니다)|모두\s*충족)/;
const LIGHT_RE = /LIGHT/;
const RUN_CLAIM_RE = /(실구동|구동\s*검증|띄워\s*(보|봤|서))[^.!?\n]{0,20}(✅|완료|했|됐|끝|통과)/;
// formats 갭(batch6): FULL "비전문가 요약" 보고 형태만 반응 — 완료 맥락 한정으로 좁힌다.
// 작업 시작 카드 턴·LIGHT 한 줄 요약은 라벨/필드가 달라 절대 안 걸린다(plan-validator HIGH 반영:
// 카드는 매 FULL 작업 첫 턴이라 여기 걸리면 과차단). 필드 어휘 2개 이상 = FULL 요약 형태 신호.
const SUMMARY_TEXT_RE = /비전문가\s*요약/;
const SUMMARY_FIELD_RE = /무엇을 했|왜 이렇게 결정|왜 이 결정|잘되면|잘못되면|다음에 확인|다음 확인/g;
function looksLikeFullSummary(text) {
  if (!SUMMARY_TEXT_RE.test(text) || LIGHT_RE.test(text)) return false;
  return (text.match(SUMMARY_FIELD_RE) || []).length >= 2;
}

// 세션 transcript에 Skill 도구로 해당 스킬을 로드한 흔적이 있나.
// 형식은 실제 transcript로 검증됨(2026-07-06): {"name":"Skill","input":{"skill":"chageun:spec-gate"}}
function hasSkillLoad(objs, name) {
  if (!Array.isArray(objs)) return false;
  for (const o of objs) {
    const m = msgOf(o); const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === "tool_use" && String(b.name || "") === "Skill" &&
          String((b.input && b.input.skill) || "").indexOf(name) !== -1) return true;
    }
  }
  return false;
}

// 이번 턴 + 직전 턴(SKILLGAP_TURNS) assistant 텍스트로 스킬갭 판정. **세그먼트(턴)별 독립 판정** —
// 하나라도 성립하면 그 게이트를 돌려준다(합성 오차단 방지, plan-validator F-3).
// 직전 턴까지 보는 이유는 위 assistantTurnSegments 주석 참조(마지막 메시지 미반영 실측).
// WAIT_RE 면제 없음 — 질문으로 끝나도 이미 수행된 무절차 끝 점검/검증 선언은 위반(1회 차단이라 안전).
// 게이트당 세션 1회 백스톱: 이미 되돌린 게이트는 침묵한다(alreadyBounced). 완전 커버리지가 아니라
// 백스톱이다 — 한 번 되돌린 뒤 같은 세션에서 재발하면 못 잡는다(의식적 선택: 영구 루프가 더 나쁘다).
const SKILLGAP_TURNS = 2;
function shouldBlockSkillGap(objs) {
  if (!Array.isArray(objs) || !objs.length) return null;
  const segs = assistantTurnSegments(objs, SKILLGAP_TURNS);
  if (!segs.length) return null;
  let hit = null;
  for (const text of segs) {
    if (!text) continue;
    const marks = (text.match(/[✅❌]/g) || []).length;
    if (!hit && FINISH_TEXT_RE.test(text) && marks >= 2 && !LIGHT_RE.test(text) &&
        !hasSkillLoad(objs, "finish-check")) hit = "finish-check";
    if (!hit && RUN_CLAIM_RE.test(text) && !hasSkillLoad(objs, "run-verify")) hit = "run-verify";
    if (!hit && looksLikeFullSummary(text) && !hasSkillLoad(objs, "formats")) hit = "formats";
  }
  if (hit && alreadyBounced(objs, hit)) return null;
  return hit;
}

// 문구 끝의 "직전 턴 또는 이번 턴 앞부분" 은 정확한 서술이다 — 창이 2턴이라 지적 대상이 방금 쓴 글이
// 아닐 수 있다(L-7). 어디를 말하는지 안 밝히면 받는 쪽이 엉뚱한 자리를 고친다.
const WINDOW_NOTE = " (지적 대상은 **직전 턴 또는 이번 턴 앞부분**입니다 — 안전장치가 매 턴의 마지막 글은 못 보기 때문에 한 턴 늦게 잡습니다.)";
const REASON_SKILLGAP = {
  "finish-check": "FULL 끝 점검을 chageun:finish-check 스킬 로드 없이 마쳤습니다. 지금 Skill 도구로 chageun:finish-check를 로드하고 그 절차(채점·제품지도 갱신·체크리스트)대로 끝 점검을 다시 마치세요. (LIGHT 끝 점검이었다면 'LIGHT'를 명시하세요.)" + WINDOW_NOTE,
  "run-verify": "실구동 검증을 chageun:run-verify 스킬 로드 없이 완료로 선언했습니다. 지금 Skill 도구로 chageun:run-verify를 로드하고 그 절차(띄우기·엣지 눌러보기·보고)대로 검증한 뒤 보고하세요." + WINDOW_NOTE,
  "formats": "FULL 비전문가 요약을 chageun:formats 스킬 로드 없이 작성했습니다. 지금 Skill 도구로 chageun:formats를 로드하고 그 양식(핵심5 칸·⚠위험 전부·심각도순)대로 요약을 다시 작성하세요. (LIGHT 한 줄 요약이었다면 'LIGHT'를 명시하세요.)" + WINDOW_NOTE,
};

// user 메시지가 도구결과(tool_result)로만 이뤄졌으면 '진짜 user'가 아님(도구 실행 결과).
function isToolResultOnly(m) {
  const c = m && m.content;
  return Array.isArray(c) && c.length > 0 && c.every((b) => b && b.type === "tool_result");
}

// 세션 transcript 어디든 실행형 도구를 썼나 — Bash(테스트·명령)·Task/Agent(위임 실행)·
// playwright/puppeteer(브라우저)·executeCode·MCP 실행(execute/sql/migration/deploy/invoke/
// query — Supabase 등 DB 검증). 과거참조 fail-open은 이 증거가 있을 때만 정당. 넓게 잡아
// 정당 재보고 오차단을 피한다("차단 좁게"; 오차단이 이 훅의 최대 실패 양식). 순수함수(fs 없음).
function hasExecEvidence(objs) {
  if (!Array.isArray(objs)) return false;
  const EXEC = /^(Bash|Task|Agent)$|playwright|puppeteer|executeCode|mcp__.*(execute|sql|migration|deploy|invoke|query)/i;
  for (const o of objs) {
    const m = msgOf(o); const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === "tool_use" && EXEC.test(String(b.name || ""))) return true;
    }
  }
  return false;
}

// 직전 '진짜 user 메시지' 이후 assistant 구간에서 도구를 한 번도 안 쓰고(0회) 실행 주장만 하며
// 끝났으면 차단(증거 없는 성공 선언). F-1: tool_result(role=user)를 진짜 user로 착각하지 않도록
// 건너뛴다 — 이전 턴에 도구를 썼으면(정상 끝 점검) 통과.
function shouldBlockNoEvidence(objs) {
  if (!Array.isArray(objs) || !objs.length) return false;
  let u = -1;
  for (let i = objs.length - 1; i >= 0; i--) {
    if (roleOf(objs[i]) !== "user") continue;
    if (isToolResultOnly(msgOf(objs[i]))) continue; // 도구결과 user는 건너뜀
    u = i; break;
  }
  let toolCount = 0; const texts = [];
  for (let i = u + 1; i < objs.length; i++) {
    if (roleOf(objs[i]) !== "assistant") continue;
    const m = msgOf(objs[i]);
    if (Array.isArray(m.content)) for (const b of m.content) if (b && b.type === "tool_use") toolCount++;
    const t = textOf(m); if (t) texts.push(t);
  }
  if (toolCount > 0) return false; // 이번 요청 동안 도구 사용 → 정상, 통과
  const tail = texts.join("\n").trim().slice(-600);
  if (!tail || WAIT_RE.test(tail)) return false;
  // 과거 참조("아까 돌려보니")여도, 세션에 실제 실행 증거(Bash·서브에이전트·브라우저·MCP 실행)가
  // 있을 때만 재보고로 보고 통과(후속 턴 오차단 방지). 실행이 아예 없는데 "아까 돌려봤다"면
  // 조작이므로 fall-through해 차단(item8 신선도 규칙의 기계 백스톱).
  if (/아까|앞서|이전에|기존에|already|earlier|previously/.test(tail) && hasExecEvidence(objs)) return false;
  return EXEC_CLAIM_RE.test(tail);
}

function roleOf(o) { return o.type || (o.message && o.message.role) || ""; }
function msgOf(o) { return o.message || o; }
function textOf(m) {
  const c = m && m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n");
  return "";
}
function endedWithTool(m) {
  if (!m) return false;
  if (m.stop_reason === "tool_use") return true;
  const c = m.content;
  if (Array.isArray(c) && c.length) {
    const last = c[c.length - 1];
    if (last && last.type === "tool_use") return true;
  }
  return false;
}

// F7: 단일 검증된 창 함수 — 마지막 '진짜 user'(도구결과-only user는 건너뜀, N2) 이후 assistant 텍스트.
// latestOnly=true(재작성)면 마지막 assistant 메시지 하나만 스캔한다(F1 무한루프 차단 — 불변 기록의
// 옛 누출 메시지가 매 Stop 재탐지돼 영구 block되는 걸 막음; 최신 메시지의 재범은 여전히 잡힘 H3).
function assistantTextSinceLastUser(objs, latestOnly) {
  if (!Array.isArray(objs) || !objs.length) return "";
  let start = 0;
  for (let i = objs.length - 1; i >= 0; i--) {
    if (roleOf(objs[i]) === "user" && !isToolResultOnly(msgOf(objs[i]))) { start = i + 1; break; }
  }
  const seg = [];
  for (let i = start; i < objs.length; i++) {
    if (roleOf(objs[i]) === "assistant") {
      const t = textOf(msgOf(objs[i]));
      if (t) seg.push(t);
    }
  }
  const chosen = latestOnly ? seg.slice(-1) : seg;
  return chosen.join("\n");
}

// ── 턴 세그먼트 창(v0.42) ────────────────────────────────────────────────────
// **왜 이게 필요한가(실측):** Stop 훅은 그 턴의 **마지막 assistant 메시지가 트랜스크립트 파일에
// 반영되기 전에** 돈다. 스킬갭 가드가 찾는 세 신호(끝 점검 채점표·실구동 완료 선언·비전문가 요약)는
// 전부 턴의 마지막 메시지에 쓰이므로 가드는 그 글을 **절대 못 본다**. 실측(2026-08-02, 전 프로젝트
// stop_hook_summary 전수): finish-work 훅 실행 2,941회 중 끝 점검 스킬갭 발동 **0회**. 같은 트랜스크립트를
// 잘라 이 코드에 재생하면 50세션 312지점에서 51회 차단해야 한다. "약속만 하고 끝냄"만 살아 있는 이유는
// 약속 문장이 도구 호출 **앞** 중간 메시지에 나와 이미 반영돼 있기 때문이다.
// → 창을 **직전 턴까지** 넓힌다. 직전 턴의 마지막 메시지는 이미 반영돼 있으므로 한 턴 늦게 잡힌다.
// **판정은 세그먼트(턴)별로 독립 수행한다** — 두 턴을 이어붙여 한 번에 매칭하면 "직전 턴의 끝 점검 언급 +
// 이번 턴의 무관한 ✅✅"가 합성돼 오차단이 된다(plan-validator F-3). 세그먼트는 **턴 단위**이지 메시지
// 단위가 아니다 — 같은 턴 안에서 어휘와 채점표가 두 메시지에 나뉜 경우는 계속 잡아야 한다(F-3/L-2).
function assistantTurnSegments(objs, turns) {
  if (!Array.isArray(objs) || !objs.length) return [];
  const segs = [];
  let cur = [];
  for (const o of objs) {
    const r = roleOf(o);
    if (r === "user" && !isToolResultOnly(msgOf(o))) { if (cur.length) segs.push(cur.join("\n")); cur = []; continue; }
    if (r === "assistant") { const t = textOf(msgOf(o)); if (t) cur.push(t); }
  }
  if (cur.length) segs.push(cur.join("\n"));
  return segs.slice(-Math.max(1, turns | 0));
}

// 같은 게이트로 **이 세션에서 이미 되돌린 적이 있나**. 있으면 다시 막지 않는다(게이트당 세션 1회).
// 지난 턴의 글은 고칠 수 없으므로, 창을 넓힌 채 반복 차단하면 영구 루프가 된다.
// **판정은 문자열이 아니라 구조로 앵커한다** — 이 저장소는 차단 사유 문구를 소스·테스트에 담고 있어서
// (REASON_SKILLGAP 여기 · "Stop hook feedback:" 리터럴이 retrospect-scan.mjs·test/finish-work.test.mjs)
// 원시 부분문자열 검색으로 만들면 그 파일을 Read한 세션에서 **가드가 영구 침묵**한다.
// detectNearMisses(retrospect-scan.mjs)가 이미 같은 함정을 밟고 구조 앵커로 해결한 전례가 있다. 4조건:
//   1) role=user 레코드   2) content의 **text 블록만**(tool_result 블록 제외 — 파일 읽은 결과가 거기 실린다)
//   3) 그 text가 `Stop hook feedback:` 로 **시작**(인용·언급은 접두가 안 맞아 탈락)
//   4) 사유 대조는 REASON_SKILLGAP 상수에서 딴 부분문자열(문구를 고치면 자동으로 같이 움직인다)
function alreadyBounced(objs, gate) {
  const reason = REASON_SKILLGAP[gate];
  if (!reason || !Array.isArray(objs)) return false;
  const key = reason.slice(0, 24);
  for (const o of objs) {
    if (roleOf(o) !== "user") continue;
    const c = msgOf(o).content;
    const texts = typeof c === "string" ? [c]
      : Array.isArray(c) ? c.filter((b) => b && b.type === "text").map((b) => String(b.text || "")) : [];
    for (const t of texts) {
      if (!/^\s*Stop hook feedback:/.test(t)) continue;
      if (t.indexOf(key) !== -1) return true;
    }
  }
  return false;
}

// G7 Stop 백스톱: .env 시크릿 '값'이 최종답에 인용됐으면 사유(키 이름만, 값 없음)를, 아니면 null.
// stopHookActive(재작성)면 최신 메시지만 스캔(F1). 어떤 오류든 fail-open(null) — chageun를 막지 않는다.
// 값은 어디에도 로깅/전송하지 않는다(secret-scan-core가 메모리 내에서만 처리).
function leakBlockReason(objs, cwd, stopHookActive) {
  try {
    const { collectSecrets, findLeaks } = require("./secret-scan-core.js");
    const secrets = collectSecrets(cwd);
    if (!secrets.length) return null;
    const leaked = findLeaks(assistantTextSinceLastUser(objs, stopHookActive === true), secrets);
    if (!leaked.length) return null;
    return `비밀값을 답변에 인용했습니다(키: ${leaked.join(", ")}). 값은 빼고 이름/존재만 다시 보고하세요. 진짜/가짜 판단은 하지 않습니다.`;
  } catch (_) {
    return null; // fail-open
  }
}

function run() {
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; });
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw);
      const tpath = input.transcript_path;
      if (!tpath) return process.exit(0);
      const fs = require("fs");
      if (!fs.existsSync(tpath)) return process.exit(0);

      const objs = [];
      for (const ln of fs.readFileSync(tpath, "utf8").split("\n")) {
        const s = ln.trim();
        if (!s) continue;
        try { objs.push(JSON.parse(s)); } catch (_) { /* skip */ }
      }

      // G7 누출 백스톱: stop_hook_active 조기종료보다 먼저 실행(첫 Stop 누출도 잡음).
      // 재작성이면 최신 메시지만 스캔해 옛 누출 무한루프를 끊는다(F1). leakBlockReason은 자체 fail-open.
      const leak = leakBlockReason(objs, input.cwd || process.cwd(), input.stop_hook_active === true);
      if (leak) { process.stdout.write(JSON.stringify({ decision: "block", reason: leak })); return process.exit(0); }

      // 재작성(재프롬프트)이면 아래 약속/무증거/스킬갭 검사는 건너뛴다(기존 동작 유지) — 누출검사만 항상 돈다.
      if (input.stop_hook_active === true) return process.exit(0);

      let lastIdx = -1;
      for (let i = objs.length - 1; i >= 0; i--) {
        if (roleOf(objs[i]) === "assistant") { lastIdx = i; break; }
      }
      if (lastIdx === -1) return process.exit(0);

      // v0.42(F-1): `endedWithTool` 조기 종료를 **스킬갭 판정에는 적용하지 않는다.**
      // 마지막 메시지가 아직 반영되지 않은 탓에 파일의 마지막 assistant 레코드가 tool_use로 끝나는
      // 경우가 실측 25%(311 Stop 지점 중 78건)인데, 그때마다 스킬갭 검사에 **도달조차 못 했다.**
      // Stop 시점은 이미 턴이 끝난 자리라 이 조기 종료는 스킬갭 판정에 의미가 없다.
      // 약속·무증거 검사는 지금 경로 그대로 둔다(정상 동작 중 — 회귀 위험).
      // 남는 사각(정직 고지): 미반영이 두 메시지 이상 걸치면 이 창으로도 못 잡는다. 백스톱이지 보장이 아니다.
      const gap = shouldBlockSkillGap(objs);
      let promise = false, noEvidence = false;
      if (!endedWithTool(msgOf(objs[lastIdx]))) {
        const texts = [];
        for (let i = lastIdx; i >= 0; i--) {
          if (roleOf(objs[i]) !== "assistant") break;
          const t = textOf(msgOf(objs[i]));
          if (t) texts.unshift(t);
        }
        const text = texts.join("\n").trim();
        promise = text ? shouldBlock(text) : false;
        noEvidence = shouldBlockNoEvidence(objs);
      }
      if (!promise && !noEvidence && !gap) return process.exit(0);
      const reason = promise ? REASON : noEvidence ? REASON_NOEVIDENCE : REASON_SKILLGAP[gap];
      process.stdout.write(JSON.stringify({ decision: "block", reason }));
      process.exit(0);
    } catch (_) {
      process.exit(0); // 어떤 예외든 안전 통과(chageun를 막지 않는다).
    }
  });
}

module.exports = { shouldBlock, shouldBlockNoEvidence, shouldBlockSkillGap, assistantTextSinceLastUser, assistantTurnSegments, alreadyBounced, leakBlockReason, WAIT_RE, PROMISE_RE, SKILLGAP_TURNS };
if (require.main === module) run();
