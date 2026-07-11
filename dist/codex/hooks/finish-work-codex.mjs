// chageun finish-work (Codex Stop 훅). Claude판과 동일 판정, 입력만 Codex식.
// 보수적: 통과 넓게/차단 좁게. 외부 호출 없음. 실패 시 안전 통과. 개인/회사 정보 없음.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { collectSecrets, findLeaks } = require("./secret-scan-core.js");

// Claude판 finish-work.js와 동일 로직(듀얼 미러 — 함께 갱신). bare 알려·검토는 WAIT에서 제외.
const WAIT_RE = /[?]|할까요|갈까요|드릴까요|주세요|골라|선택|진행해도|어느|확인해|괜찮(을까|나요)|승인|합의|기다리|다음\s*단계|진행\s*보고|멈춤|shall i|would you|do you want|let me know|which option|approve|confirm|waiting for/i;
const PROMISE_RE = /(이제|곧|다음(엔|은)?|바로)\s*[^.!?\n]{0,40}(?:(구현|만들|작성|수정|실행|추가|저장|시작|진행)(하겠|할게|할께|하겠습니다|할게요|합니다)|(검토|보고|알려|공유|설명|정리)(하겠|할게|할께|하겠습니다|할게요))|(완료|끝나|이후|나중)[^.!?\n]{0,20}(알려|보고|공유|검토)[^.!?\n]{0,10}(드리|하)(겠|ㄹ게)|\b(I'?ll|I will|let me|now I|next,? I)\b[^.!?\n]{0,60}\b(implement|create|write|add|run|fix|save|build|start|proceed|review|report|share|explain|summarize)\b/i;
const REASON = "직전 응답이 작업을 하겠다고 말만 하고 실제로 하지 않은 채 끝났습니다. 지금 그 작업을 수행하세요. 작업이 끝났거나 사용자만 줄 수 있는 입력이 필요할 때만 턴을 끝내세요.";

export function decide(input) {
  if (!input || input.stop_hook_active === true) return { block: false };
  const text = (input.last_assistant_message || "").trim();
  if (!text) return { block: false };
  const tail = text.slice(-400);
  if (WAIT_RE.test(tail)) return { block: false };
  if (!PROMISE_RE.test(tail)) return { block: false };
  return { block: true, reason: REASON };
}

// ── P2 증거가드(빈손 완료 선언 차단) — Claude판 shouldBlockNoEvidence의 Codex 이식 ──
// rollout JSONL 형식: openai/codex rust-v0.142.5 소스 추출(2026-07-06) 기준.
// 오차단 봉쇄 3단: (1) 파일/파싱 문제 → 통과 (2) 도구 마커 발견 → 통과
// (3) "구조를 확실히 인식(알려진 봉투 type + 알려진 payload.type만 + session_meta 시작 + 턴 경계 존재)"
//     인데 도구 0일 때만 차단. 형식이 바뀌면 차단이 아니라 무동작 쪽으로만 틀린다(후속 모니터링).
const EXEC_CLAIM_RE = /돌려\s*(보|봤|본)|실행해\s*(보|봤|본)|테스트[^.!?\n]{0,20}통과|스크린샷[^.!?\n]{0,10}(찍|캡처)|직접\s*눌러|구동\s*검증[^.!?\n]{0,10}(완료|했|끝)|실제로\s*(확인|실행)|눌러\s*(보|봤)/;
const PAST_REF_RE = /아까|앞서|이전에|기존에|already|earlier|previously/;
const REASON_NOEVIDENCE = "\"돌려봤다/테스트 통과\"처럼 실행한 것처럼 말했지만, 이번 턴에 도구 실행 기록이 없습니다. 코드를 읽어 짐작하지 말고 실제로 돌려(테스트·실행) 확인한 뒤 그 증거로 보고하세요.";
const KNOWN_TYPES = new Set(["session_meta", "response_item", "event_msg", "turn_context", "compacted", "inter_agent_communication"]);
// payload.type 전체 어휘 — rust-v0.142.5 policy.rs 영속화 목록. 미열거 payload.type(신형 도구 기록 등)이
// 알려진 봉투 안에 나타나면 형식 변경 신호 → fail-open (정당 완료를 "도구 아님"으로 오분류해 차단하는 경로 봉쇄).
const KNOWN_PAYLOAD = {
  response_item: new Set(["message", "agent_message", "reasoning", "local_shell_call", "function_call", "tool_search_call", "function_call_output", "tool_search_output", "custom_tool_call", "custom_tool_call_output", "web_search_call", "image_generation_call", "compaction", "context_compaction"]),
  event_msg: new Set(["user_message", "agent_message", "agent_reasoning", "agent_reasoning_raw_content", "patch_apply_end", "token_count", "thread_goal_updated", "context_compacted", "entered_review_mode", "exited_review_mode", "mcp_tool_call_end", "thread_rolled_back", "turn_aborted", "task_started", "turn_started", "task_complete", "turn_complete", "web_search_end", "image_generation_end", "sub_agent_activity", "item_completed"]),
};

function isToolLine(o) {
  const p = (o && o.payload) || {};
  if (o.type === "response_item") {
    return ["function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output", "local_shell_call"].includes(p.type);
  }
  if (o.type === "event_msg") {
    if (p.type === "mcp_tool_call_end") return true;
    if (p.type === "patch_apply_end") return p.status !== "declined";
  }
  return false;
}
function isTurnBoundary(o) {
  const p = (o && o.payload) || {};
  return o.type === "event_msg" && (p.type === "user_message" || p.type === "task_started" || p.type === "turn_started");
}

export function decideNoEvidence(input, rawTranscript) {
  try {
    if (!input || input.stop_hook_active === true) return { block: false };
    const text = (input.last_assistant_message || "").trim();
    if (!text) return { block: false };
    const tail = text.slice(-600);
    if (WAIT_RE.test(tail) || !EXEC_CLAIM_RE.test(tail)) return { block: false };
    if (!rawTranscript || typeof rawTranscript !== "string") return { block: false };

    const objs = [];
    for (const ln of rawTranscript.split("\n")) {
      const s = ln.trim(); if (!s) continue;
      let o; try { o = JSON.parse(s); } catch (_) { continue; }
      if (!o || typeof o.type !== "string") continue;
      if (!KNOWN_TYPES.has(o.type)) return { block: false }; // 알 수 없는 봉투 → fail-open
      const known = KNOWN_PAYLOAD[o.type];
      if (known && !known.has(String((o.payload || {}).type))) return { block: false }; // 알 수 없는 payload → fail-open
      objs.push(o);
    }
    if (!objs.length) return { block: false };
    const mp = (objs[0].payload || {});
    if (objs[0].type !== "session_meta" || !(mp.id || mp.session_id)) return { block: false }; // 형식 인식 실패
    let lastBoundary = -1;
    for (let i = objs.length - 1; i >= 0; i--) { if (isTurnBoundary(objs[i])) { lastBoundary = i; break; } }
    if (lastBoundary === -1) return { block: false }; // 턴 경계 불명 → fail-open

    let turnTools = 0, sessionTools = 0;
    for (let i = 1; i < objs.length; i++) {
      if (isToolLine(objs[i])) { sessionTools++; if (i > lastBoundary) turnTools++; }
    }
    if (turnTools > 0) return { block: false };
    if (PAST_REF_RE.test(tail) && sessionTools > 0) return { block: false }; // 정당 재보고
    return { block: true, reason: REASON_NOEVIDENCE };
  } catch (_) { return { block: false }; }
}

// ── G7 Codex Stop 백스톱(decideLeak): .env 시크릿 값이 답에 인용되면 차단. Codex 유일 기계 그물(PostToolUse 없음). ──
// 설계(C1): last_assistant_message(decide/decideNoEvidence가 이미 쓰는 검증된 필드)를 '바닥'으로 최종답 누출을
// 확실히 잡는다 — 매 Stop 실행이라 재작성 시 최신 메시지만 봐 F1 루프차단·H3 재범 포착이 자연히 성립.
// 첫 Stop엔 rollout의 턴경계 이후 agent_message(형식: event_msg/response_item의 payload.message —
// 이 파일·테스트가 이미 인코딩한 shape. [실기기 미검증: 이 머신에 Codex CLI 없음])도 '가산' 스캔해 중간
// 누출(H4)을 보강. 가산이라 payload 필드가 실제와 달라도 바닥(last_assistant_message)이 받쳐 silent 전면
// 무동작이 되지 않는다. 값은 어디에도 로깅/전송 안 함. reason엔 키 이름만(M7).
function agentTextSinceBoundary(rawTranscript) {
  if (!rawTranscript || typeof rawTranscript !== "string") return "";
  const objs = [];
  for (const ln of rawTranscript.split("\n")) {
    const s = ln.trim(); if (!s) continue;
    let o; try { o = JSON.parse(s); } catch (_) { continue; } // 알 수 없는 줄은 스킵(중단 아님 — 스캔 보존)
    if (o && typeof o.type === "string") objs.push(o);
  }
  let lastBoundary = -1;
  for (let i = objs.length - 1; i >= 0; i--) { if (isTurnBoundary(objs[i])) { lastBoundary = i; break; } }
  const parts = [];
  for (let i = lastBoundary + 1; i < objs.length; i++) { // -1이면 0부터
    const o = objs[i], p = (o && o.payload) || {};
    const isAgent = (o.type === "response_item" && (p.type === "agent_message" || p.type === "message")) ||
                    (o.type === "event_msg" && p.type === "agent_message");
    if (!isAgent) continue;
    const t = typeof p.message === "string" ? p.message
      : typeof p.text === "string" ? p.text
      : Array.isArray(p.content) ? p.content.map((c) => (c && (c.text || (typeof c === "string" ? c : ""))) || "").join("") : "";
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

export function decideLeak(input, rawTranscript) {
  try {
    if (!input) return { block: false };
    const secrets = collectSecrets(input.cwd || process.cwd());
    if (!secrets.length) return { block: false };
    const latestOnly = input.stop_hook_active === true;
    let text = String(input.last_assistant_message || "");
    if (!latestOnly) text += "\n" + agentTextSinceBoundary(rawTranscript); // 첫 Stop만 whole-turn(재작성은 최신만 — F1)
    const leaked = findLeaks(text, secrets);
    if (!leaked.length) return { block: false };
    return { block: true, reason: `비밀값을 답변에 인용했습니다(키: ${leaked.join(", ")}). 값 빼고 이름/존재만 다시 보고. 진짜/가짜 판단 안 함.` };
  } catch (_) { return { block: false }; }
}

// CLI 진입: stdin JSON → 차단 시 {decision:block} 출력. 어떤 예외든 안전 통과.
// 순서: G7 누출 백스톱(독립·재작성에도 실행, N3) → 약속가드(decide) → 증거가드. rollout은 1회만 읽음.
if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw);
      let rawT = null;
      try { if (input.transcript_path) rawT = readFileSync(input.transcript_path, "utf8"); } catch (_) { /* fail-open */ }
      // G7 누출 백스톱 — 독립 경로, 재작성(stop_hook_active)에도 실행(N3). 가장 치명적이라 최우선.
      const lk = decideLeak(input, rawT);
      if (lk.block) { process.stdout.write(JSON.stringify({ decision: "block", reason: lk.reason })); process.exit(0); }
      const r = decide(input);
      if (r.block) { process.stdout.write(JSON.stringify({ decision: "block", reason: r.reason })); process.exit(0); }
      const ne = decideNoEvidence(input, rawT);
      if (ne.block) process.stdout.write(JSON.stringify({ decision: "block", reason: ne.reason }));
    } catch (_) { /* 안전 통과 */ }
    process.exit(0);
  });
}
