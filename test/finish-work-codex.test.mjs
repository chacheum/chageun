import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { decide, decideNoEvidence } from "../src/hooks/finish-work-codex.mjs";

test("stop_hook_active면 통과(재귀가드)", () => {
  assert.equal(decide({ stop_hook_active: true, last_assistant_message: "이제 구현하겠습니다" }).block, false);
});
test("대기 신호(질문)면 통과", () => {
  assert.equal(decide({ last_assistant_message: "이대로 진행할까요?" }).block, false);
});
test("미래형 작업 약속만 있고 끝나면 차단", () => {
  const r = decide({ last_assistant_message: "이제 로그인 폼을 구현하겠습니다." });
  assert.equal(r.block, true);
  assert.match(r.reason, /지금/);
});
test("빈/일반 메시지는 통과(보수적)", () => {
  assert.equal(decide({ last_assistant_message: "완료했습니다." }).block, false);
});
// Claude판과 동일 로직 검증(듀얼 미러 표류 방지) — bare 알려·검토 제거 + 보고성 약속 차단.
test("검토·보고 약속만 하고 끝나면 차단(Fable 지적 사례)", () => {
  assert.equal(decide({ last_assistant_message: "이제 코드를 검토하겠습니다" }).block, true);
  assert.equal(decide({ last_assistant_message: "완료되면 알려드리겠습니다" }).block, true);
});
test("과거형·요약·요청은 통과(false-block 방지)", () => {
  assert.equal(decide({ last_assistant_message: "코드를 검토했습니다. 문제 없습니다." }).block, false);
  assert.equal(decide({ last_assistant_message: "확인해 주세요" }).block, false);
  assert.equal(decide({ last_assistant_message: "결과를 정리하면 다음과 같습니다." }).block, false);
});

// ── P2 증거가드(Codex): rollout(rust-v0.142.5 소스 추출 형식) 기반, 인식-불가-시-통과 ──
const L = (type, payload) => JSON.stringify({ timestamp: "2026-07-06T01:00:00.000Z", type, payload });
const META = L("session_meta", { id: "0196a7e2-1111-2222-3333-444444444444" });
const USER = L("event_msg", { type: "user_message", message: "고쳐줘", local_images: [], text_elements: [] });
const EXEC = L("response_item", { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"npm test\"}", call_id: "c1" });
const EXEC_OUT = L("response_item", { type: "function_call_output", call_id: "c1", output: "ok" });
const AGENT = L("event_msg", { type: "agent_message", message: "테스트 통과했습니다" });
const roll = (...lines) => lines.join("\n") + "\n";
const claimInput = (msg) => ({ last_assistant_message: msg, stop_hook_active: false });
const CLAIM = "돌려보니 테스트 통과했습니다.";

test("증거가드(codex): 턴에 도구 흔적 있으면 통과", () => {
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(META, USER, EXEC, EXEC_OUT, AGENT)).block, false);
});
test("증거가드(codex): 도구 0 + 실행 주장 → 차단", () => {
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(META, USER, AGENT)).block, true);
});
test("증거가드(codex): 질문으로 끝나면 통과", () => {
  assert.equal(decideNoEvidence(claimInput("돌려볼까요?"), roll(META, USER, AGENT)).block, false);
});
test("증거가드(codex): '아까 돌려봤다' + 이전 턴 실행 증거 → 통과", () => {
  const raw = roll(META, USER, EXEC, EXEC_OUT, USER, AGENT);
  assert.equal(decideNoEvidence(claimInput("아까 돌려보니 통과했으니 마무리합니다."), raw).block, false);
});
test("증거가드(codex): '아까' 주장인데 세션 전체 실행 0 → 차단(조작)", () => {
  assert.equal(decideNoEvidence(claimInput("아까 돌려보니 통과했습니다."), roll(META, USER, AGENT)).block, true);
});
test("증거가드(codex): 알 수 없는 봉투 type 혼입 → 통과(fail-open)", () => {
  const raw = roll(META, USER, L("mystery_event", { x: 1 }), AGENT);
  assert.equal(decideNoEvidence(claimInput(CLAIM), raw).block, false);
});
test("증거가드(codex): 알려진 봉투 + 미열거 payload.type(신형 도구 기록) → 통과(오차단 봉쇄)", () => {
  const newTool = L("response_item", { type: "unified_exec_call", call_id: "u1" });
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(META, USER, newTool, AGENT)).block, false);
});
test("증거가드(codex): 첫 유효 라인이 session_meta 아니면 통과(fail-open)", () => {
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(USER, AGENT)).block, false);
});
test("증거가드(codex): 턴 경계 마커 없으면 통과(fail-open)", () => {
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(META, AGENT)).block, false);
});
test("증거가드(codex): transcript 없음/빈 문자열 → 통과", () => {
  assert.equal(decideNoEvidence(claimInput(CLAIM), null).block, false);
  assert.equal(decideNoEvidence(claimInput(CLAIM), "").block, false);
});
test("증거가드(codex): patch_apply_end(declined)는 증거 아님·completed는 증거", () => {
  const declined = L("event_msg", { type: "patch_apply_end", call_id: "p1", status: "declined", success: false, stdout: "", stderr: "" });
  const done = L("event_msg", { type: "patch_apply_end", call_id: "p2", status: "completed", success: true, stdout: "ok", stderr: "" });
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(META, USER, declined, AGENT)).block, true, "declined만으론 빈손");
  assert.equal(decideNoEvidence(claimInput(CLAIM), roll(META, USER, done, AGENT)).block, false);
});
test("증거가드(codex): stop_hook_active면 무조건 통과(재진입 가드)", () => {
  assert.equal(decideNoEvidence({ last_assistant_message: CLAIM, stop_hook_active: true }, roll(META, USER, AGENT)).block, false);
});
test("증거가드 wiring(CLI): transcript_path의 rollout을 읽어 차단 JSON을 출력한다", () => {
  const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "finish-work-codex.mjs");
  const dir = mkdtempSync(join(tmpdir(), "codexroll-"));
  const tpath = join(dir, "rollout-2026-07-06T01-00-00-0196a7e2-1111-2222-3333-444444444444.jsonl");
  writeFileSync(tpath, roll(META, USER, AGENT));
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ last_assistant_message: CLAIM, stop_hook_active: false, transcript_path: tpath }),
    encoding: "utf8",
  });
  assert.match(r.stdout || "", /"decision":"block"/, "CLI가 rollout을 읽어 증거가드 차단");
  writeFileSync(tpath, roll(META, USER, EXEC, EXEC_OUT, AGENT));
  const r2 = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ last_assistant_message: CLAIM, stop_hook_active: false, transcript_path: tpath }),
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r2.stdout || "", "", "증거 있으면 통과");
});
