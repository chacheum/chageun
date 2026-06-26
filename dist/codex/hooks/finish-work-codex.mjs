// chageun finish-work (Codex Stop 훅). Claude판과 동일 판정, 입력만 Codex식.
// 보수적: 통과 넓게/차단 좁게. 외부 호출 없음. 실패 시 안전 통과. 개인/회사 정보 없음.

const WAIT_RE = /[?]|할까요|갈까요|드릴까요|주세요|골라|선택|진행해도|알려|어느|확인해|검토|괜찮(을까|나요)|승인|합의|기다리|다음\s*단계|진행\s*보고|멈춤|shall i|would you|do you want|let me know|which option|approve|confirm|waiting for/i;
const PROMISE_RE = /(이제|곧|다음(엔|은)?|바로)\s*[^.!?\n]{0,40}(구현|만들|작성|수정|실행|추가|저장|시작|진행)(하겠|할게|할께|하겠습니다|할게요|합니다)|\b(I'?ll|I will|let me|now I|next,? I)\b[^.!?\n]{0,60}\b(implement|create|write|add|run|fix|save|build|start|proceed)\b/i;
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

// CLI 진입: stdin JSON → 차단 시 {decision:block} 출력. 어떤 예외든 안전 통과.
if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const r = decide(JSON.parse(raw));
      if (r.block) process.stdout.write(JSON.stringify({ decision: "block", reason: r.reason }));
    } catch (_) { /* 안전 통과 */ }
    process.exit(0);
  });
}
