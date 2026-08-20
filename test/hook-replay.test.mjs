// test/hook-replay.test.mjs — 실기록 전수 재생으로 **오차단 0**을 건다(F-29 · v0.65.0).
//
// 왜 이 검사가 있나: 이 저장소의 **최대 실패 양식은 오차단**이다(한 가드가 정상 작업을 217번 막은
//   전례가 있다). v0.65.0 은 PreToolUse 매처를 `""`(모든 도구)로 넓혀 **그동안 훅이 아예 안 돌던
//   호출 940건**을 새로 훅 아래로 들인다. 그 940건이 전부 그대로 지나가는지를 기록으로 못박는다.
//
// ⚠ 이 재생이 답하지 **않는** 질문 하나: "매처가 실제로 그 도구에서 훅을 부르는가"는 훅에 직접
//   먹여서는 못 잰다(재생은 매처를 안 거친다). 재생은 **판정이 옳은가**를 재고, 매처 발동은 따로
//   잰다. 둘을 섞어 읽으면 **아무것도 안 잰 초록**이 나온다.
//
// ⚠ 픽스처의 값은 전부 합성이다(경로는 `/repo/…`, 문자열은 `"…"`). 남긴 것은 **도구 이름과 입력의
//   칸 구조**뿐이다. 그 치환이 안전한 이유: 이 훅에서 **값을 보는 판정은 실제로 있지만**(Bash 는
//   명령 문자열을, Edit·Write 계열은 경로와 내용을 읽는다) **이 집합에는 그 도구가 하나도 없다** —
//   셋 다 옛 매처에 이미 잡혀 있어 애초에 이 집합 밖이다.
//   🛑 **`Bash` 나 `Edit` 를 이 픽스처에 넣게 되는 날, 값 치환은 검사를 조용히 무의미하게 만든다.**
//   그때는 치환을 넓히지 말고 그 도구를 **따로 손으로 만든 픽스처**로 다룬다.
//
// 무인 칸 네 개((가)·(나)·(다)·(라))는 test/hook-net.test.mjs 에 **나란히** 있다 — 네 칸을 한 자리에
//   모으라는 것이 그 요구라, 이 파일이 아니라 그쪽 한 곳에 뒀다. 여기서는 전수 재생만 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./support-tmpdir.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "src", "hooks", "pretooluse.js");
const FX = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "hook-replay-calls.json"), "utf8"));
const BASE = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "hook-replay-baseline.json"), "utf8"));

const CLEAN_ENV = { ...process.env };
for (const k of Object.keys(CLEAN_ENV)) if (k.startsWith("CHAGEUN_")) delete CLEAN_ENV[k];

// 전수 재생. 총계를 **반드시 함께 돌려준다** — 이 저장소 교훈: **잘린 측정은 조용히 틀린다.**
//   총계가 없으면 재생이 도중에 끊겨도 "차단 0건"이 초록으로 나온다.
function replay(env, cwd) {
  const byTool = {};
  let replayed = 0, exit0 = 0, exit2 = 0, other = 0;
  const t0 = Date.now();
  for (const call of FX.calls) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(call), env, cwd, encoding: "utf8" });
    replayed++;
    const t = (byTool[call.tool_name] ||= { calls: 0, exit0: 0, exit2: 0 });
    t.calls++;
    if (r.status === 0) { exit0++; t.exit0++; } else if (r.status === 2) { exit2++; t.exit2++; } else other++;
  }
  return { byTool, replayed, exit0, exit2, other, wall: Date.now() - t0 };
}

let attended = null;   // 아래 두 칸이 나눠 쓴다(재생이 무거워 한 번만 돈다).

test("F-29 오차단 0(유인): 실기록 전수 재생에서 차단이 한 건도 없다", () => {
  attended = replay(CLEAN_ENV, tmpDir("replay-"));
  // 총계부터 센다. 재생 수가 픽스처 수와 정확히 같아야 나머지 수치가 뜻을 갖는다.
  assert.equal(FX.calls.length, FX.total, "픽스처 자기 총계가 안 맞는다");
  assert.equal(attended.replayed, FX.calls.length,
    `재생이 도중에 끊겼다: 픽스처 ${FX.calls.length} · 재생 ${attended.replayed}`);
  assert.equal(attended.other, 0, "0도 2도 아닌 종료코드가 나왔다(훅이 비정상 종료)");
  assert.equal(attended.exit2, 0,
    "오차단이 생겼다. 이 축이 넓힌 범위에서 정상 작업이 막히면 다음 두 축의 작업 자체가 막힌다");
  assert.equal(attended.exit0, FX.calls.length);
});

test("F-29 기준선 대조(유인): 옛 훅과 도구별 개수·분포가 같다", () => {
  // 🛑 기준선을 **말로만** 두지 않는다. 지금까지의 실측은 전부 옛 코드로 잰 값이고 새 코드에는
  //   층이 더 붙었다. 그래서 옛 훅 재생 결과를 파일로 커밋해 두고 여기서 대조한다.
  //   기준선을 다시 만들려면 옛 트리를 뽑아 같은 픽스처를 먹이면 된다(baseline.ref 가 그 커밋).
  assert.ok(attended, "앞 칸이 먼저 돌아야 한다");
  assert.equal(BASE.fixtures, FX.calls.length, "기준선과 픽스처가 다른 세대다 — 기준선을 다시 만들라");
  assert.equal(BASE.exit2, 0, "옛 훅에서도 차단 0건이었다는 것이 이 대조의 전제다");
  assert.deepEqual(
    Object.fromEntries(Object.entries(attended.byTool).map(([k, v]) => [k, v.calls])),
    Object.fromEntries(Object.entries(BASE.byTool).map(([k, v]) => [k, v.calls])),
    "도구별 재생 수가 옛 훅과 다르다");
  assert.deepEqual(
    Object.fromEntries(Object.entries(attended.byTool).map(([k, v]) => [k, v.exit2])),
    Object.fromEntries(Object.entries(BASE.byTool).map(([k, v]) => [k, v.exit2])),
    "도구별 차단 수가 옛 훅과 다르다");
});

test("F-29 무인 동작이 v0.65.0 전과 같다: 전수 재생 차단 0 · 예산도 안 먹는다", () => {
  // 결정 3번(사용자 · 2026-08-11): 무인 범위는 안 넓힌다. 목표가 "오차단 0"이 아니라
  //   **"v0.65.0 전과 동작이 같다"** 인 자리다.
  const dir = tmpDir("replay-unatt-");
  mkdirSync(join(dir, ".chageun"), { recursive: true });
  writeFileSync(join(dir, ".chageun", "token"), JSON.stringify({ nonce: "abc123" }));
  const env = { ...CLEAN_ENV, CHAGEUN_UNATTENDED: "1", CHAGEUN_UNATTENDED_TOKEN: "abc123", CHAGEUN_ROOT: dir };
  const r = replay(env, dir);
  assert.equal(r.replayed, FX.calls.length, "재생이 도중에 끊겼다");
  assert.equal(r.other, 0);
  assert.equal(r.exit2, 0, "무인이 넓힌 범위에서 새로 막기 시작하면 사용자 결정과 어긋난다");
  // 예산 소진 속도. 넓힌 범위의 호출은 §0.5 를 아예 안 지나므로 상태 파일이 **생기지도 않는다** =
  //   세는 호출 수가 v0.65.0 전(훅이 안 돌던 때)과 정확히 같다.
  assert.equal(existsSync(join(dir, ".chageun", "runtime.json")), false,
    "넓힌 범위 호출이 무인 예산을 먹기 시작했다 — 무인 세션이 전보다 빨리 멈춘다");
});

// 이 칸이 지키는 것은 **속도가 아니라 동작 규율**이다: "층3 은 흔한 경로에서 파일도 트랜스크립트도
//   안 읽는다"(아래 단언 주석). 그 규율을 재는 칸이 이것 말고 없다 — 빼면 아무도 안 본다.
// ⚠ 한동안 `CHAGEUN_PERF=1` 로만 켜지게 뒀는데, 그 스위치를 켜는 자리가 **저장소 어디에도 없었다**
//   (`.github/workflows/ci.yml` 은 `npm test` 에 그 스위치를 안 붙이고, 그 이름은 이 파일 안에만 있었다).
//   조건부 skip 은 "가끔 돈다"가 아니라 **한 번도 안 돈다**였다. 그래서 기본 실행으로 되돌린다.
// ▶ 문턱을 2초에서 4초로 올린 근거(숫자는 실측):
//   1. 지금 이 저장소의 실측은 세션당 1.5~1.7초다(판마다 흔들린다). 문턱 2초면 여유가 15~25%뿐이라, 옆에서 다른
//      작업이 돌면 코드를 한 글자도 안 바꾸고 빨개진다(같은 커밋 세 판 중 한 판이 빨갰다).
//   2. 이 칸이 잡으려는 회귀는 그런 몇 %짜리가 아니다: 층3 이 트랜스크립트를 읽기 시작하면
//      호출당 400ms대가 붙는다(`src/hooks/pretooluse.js` §4.5 주석의 실측) = **현재값의 9배**.
//   3. 4초면 기계 부하(수십 %)에는 둔감하고, 잡아야 할 회귀(9배)는 3배 여유로 문다.
//   4. 그 대신 **이 칸의 탐지 바닥은 호출당 약 +70ms** 다: 세션당 34.8건(픽스처 940건 ÷ 27세션)이라
//      문턱 4초는 호출당 115ms 이고 지금 실측이 40ms대다. **그보다 작은 읽기는 못 잡는다** —
//      그 급은 이 칸이 아니라 눈으로 코드를 봐야 한다("층3 은 흔한 경로에서 파일도 트랜스크립트도
//      안 읽는다"는 아래 단언 주석의 절대형은 이 바닥 위에서만 재진다).
//   🛑 값나가는 곳은 흔들리는 빨간불 자체가 아니라 **다음 번**이다: 이 저장소는 "전 칸 초록"을 안전
//   신호로 쓰는데, 혼자 흔들리는 칸이 섞여 있으면 빨간불을 "또 그거겠지" 하고 다시 돌리는 버릇이
//   붙는다. 그 버릇이 붙은 뒤 **가끔만 빨개지는 진짜 결함**이 들어오면 똑같이 넘어간다.
//   문턱을 넉넉히 잡는 것은 그 버릇을 안 만들면서 규율은 계속 재기 위한 값이다.

test("F-29 비용: 재생 벽시계 ÷ 세션 수가 4초 미만", () => {
  // 넘으면 층3 의 비용 규율(파일도 트랜스크립트도 안 읽는다)이 깨진 것이다.
  // 앞 칸이 이미 쟀으면 그 값을 쓰고, 이 칸만 골라 돌렸으면 여기서 잰다 — "앞 칸이 먼저 돌아야
  //   한다"는 순서 의존을 없앤다. 순서에 기대면 칸을 골라 돌릴 때 성능이 멀쩡한데도 빨개진다.
  const m = attended ?? replay(CLEAN_ENV, tmpDir("replay-perf-"));
  const perSession = m.wall / FX.sessions / 1000;
  assert.ok(perSession < 4,
    `세션당 ${perSession.toFixed(2)}초 — 층3 이 흔한 경로에서 파일이나 트랜스크립트를 읽고 있지 않은지 보라`);
  console.log(`  [비용] ${FX.calls.length}건 ${(m.wall / 1000).toFixed(1)}초 `
    + `= ${(m.wall / m.replayed).toFixed(1)}ms/건 · 세션당 ${perSession.toFixed(2)}초`);
});
