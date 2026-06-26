// chageun finish-work — Stop 훅.
// 에이전트가 "이제 ~하겠습니다"처럼 작업을 하겠다고 말만 하고 실제 도구 실행 없이 턴을 끝내면
// 되돌려 지금 하게 한다(보수적: 통과 넓게 / 차단 좁게). 결정론적, 외부 호출 없음, 실패 시 안전 통과.
// 개인/회사 정보 없음.

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);

    // 1) 무한루프 방지: 이미 한 번 막았으면 통과.
    if (input.stop_hook_active === true) return pass();

    // 2) transcript 없으면 통과.
    const tpath = input.transcript_path;
    if (!tpath) return pass();
    const fs = require("fs");
    if (!fs.existsSync(tpath)) return pass();

    // 3) JSONL 파싱(깨진 줄은 건너뜀).
    const objs = [];
    for (const ln of fs.readFileSync(tpath, "utf8").split("\n")) {
      const s = ln.trim();
      if (!s) continue;
      try { objs.push(JSON.parse(s)); } catch (_) { /* skip */ }
    }

    // 4) 마지막 assistant 줄 찾기(마지막 줄이 assistant가 아닐 수 있음 — 역방향 탐색).
    let lastIdx = -1;
    for (let i = objs.length - 1; i >= 0; i--) {
      if (roleOf(objs[i]) === "assistant") { lastIdx = i; break; }
    }
    if (lastIdx === -1) return pass();

    // 5) 그 줄이 도구 호출로 끝났으면 통과(작업 중).
    if (endedWithTool(msgOf(objs[lastIdx]))) return pass();

    // 6) 한 턴이 여러 줄로 쪼개질 수 있으므로, 마지막 assistant 줄부터 연속된 assistant 줄의 text를 모은다.
    const texts = [];
    for (let i = lastIdx; i >= 0; i--) {
      if (roleOf(objs[i]) !== "assistant") break;
      const t = textOf(msgOf(objs[i]));
      if (t) texts.unshift(t);
    }
    const text = texts.join("\n").trim();
    if (!text) return pass();

    // 7) 마지막 단락(끝 400자)만 검사.
    const tail = text.slice(-400);

    // 8) 사용자 대기 신호가 있으면 통과(chageun가 정상적으로 묻고 멈추는 경우).
    const waitRe = /[?]|할까요|갈까요|드릴까요|주세요|골라|선택|진행해도|알려|어느|확인해|검토|괜찮(을까|나요)|승인|합의|기다리|다음\s*단계|진행\s*보고|멈춤|shall i|would you|do you want|let me know|which option|approve|confirm|waiting for/i;
    if (waitRe.test(tail)) return pass();

    // 9) 명백한 미래형 작업 약속만 차단.
    const promiseRe = /(이제|곧|다음(엔|은)?|바로)\s*[^.!?\n]{0,40}(구현|만들|작성|수정|실행|추가|저장|시작|진행)(하겠|할게|할께|하겠습니다|할게요|합니다)|\b(I'?ll|I will|let me|now I|next,? I)\b[^.!?\n]{0,60}\b(implement|create|write|add|run|fix|save|build|start|proceed)\b/i;
    if (!promiseRe.test(tail)) return pass();

    // 10) 차단(공식 Stop 형식: top-level decision:block + reason).
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "직전 응답이 작업을 하겠다고 말만 하고 실제로 하지 않은 채 끝났습니다. 지금 그 작업을 도구로 수행하세요. 작업이 끝났거나 사용자만 줄 수 있는 입력이 필요할 때만 턴을 끝내세요."
    }));
    process.exit(0);
  } catch (_) {
    return pass(); // 어떤 예외든 안전 통과(chageun를 막지 않는다).
  }
});

function pass() { process.exit(0); }
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
