// chageun finish-work — Stop 훅.
// 에이전트가 "이제 ~하겠습니다"처럼 작업을 하겠다고 말만 하고 실제 도구 실행 없이 턴을 끝내면
// 되돌려 지금 하게 한다(보수적: 통과 넓게 / 차단 좁게). 결정론적, 외부 호출 없음, 실패 시 안전 통과.
// 개인/회사 정보 없음. shouldBlock는 finish-work-codex.mjs와 동일 로직(듀얼 미러 — 함께 갱신).

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

function run() {
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; });
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw);
      if (input.stop_hook_active === true) return process.exit(0);
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
      let lastIdx = -1;
      for (let i = objs.length - 1; i >= 0; i--) {
        if (roleOf(objs[i]) === "assistant") { lastIdx = i; break; }
      }
      if (lastIdx === -1) return process.exit(0);
      if (endedWithTool(msgOf(objs[lastIdx]))) return process.exit(0);

      const texts = [];
      for (let i = lastIdx; i >= 0; i--) {
        if (roleOf(objs[i]) !== "assistant") break;
        const t = textOf(msgOf(objs[i]));
        if (t) texts.unshift(t);
      }
      const text = texts.join("\n").trim();
      const promise = text ? shouldBlock(text) : false;
      const noEvidence = shouldBlockNoEvidence(objs);
      if (!promise && !noEvidence) return process.exit(0);
      const reason = promise ? REASON : REASON_NOEVIDENCE;
      process.stdout.write(JSON.stringify({ decision: "block", reason }));
      process.exit(0);
    } catch (_) {
      process.exit(0); // 어떤 예외든 안전 통과(chageun를 막지 않는다).
    }
  });
}

module.exports = { shouldBlock, shouldBlockNoEvidence, WAIT_RE, PROMISE_RE };
if (require.main === module) run();
