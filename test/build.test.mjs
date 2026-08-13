import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaude } from "../build/adapters/claude.mjs";
import { tmpDir } from "./support-tmpdir.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("buildClaude는 plugin.json·hooks·콘텐츠를 생성", () => {
  const out = join(tmpDir("bc-"), "claude");
  buildClaude(SRC, out);
  assert.ok(existsSync(join(out, ".claude-plugin/plugin.json")));
  assert.ok(existsSync(join(out, ".claude-plugin/marketplace.json")));
  assert.ok(existsSync(join(out, "hooks/hooks.json")));
  assert.ok(existsSync(join(out, "hooks/activate.js")));
  assert.ok(existsSync(join(out, "hooks/posttooluse.js")), "G7 PostToolUse redaction hook");
  assert.ok(existsSync(join(out, "hooks/secret-scan-core.js")), "G7 shared secret-scan core");
  assert.match(readFileSync(join(out, "hooks/hooks.json"), "utf8"), /PostToolUse[\s\S]*posttooluse\.js/, "hooks.json wires PostToolUse → posttooluse.js");
  assert.ok(existsSync(join(out, "rules/operating-rules.md")));
  // 골든과 **독립**인 축(fresh build를 직접 본다). golden↔dist 대조만 남으면, 복사 목록에서 파일이
  // 빠졌을 때 문서화된 절차대로 골든을 재생성하는 순간 경보가 같이 사라진다 — 게이트 에이전트가
  // 통째로 빠진 배포물도 전 테스트 초록이 된다(v0.49.0 pr-reviewer medium).
  for (const a of ["plan-validator", "pr-reviewer", "code-implementer", "deep-implementer", "supervisor"])
    assert.ok(existsSync(join(out, "agents", a + ".md")), "게이트/일꾼/감독 에이전트 누락: " + a);
  assert.ok(existsSync(join(out, "hooks/finish-work.js")), "Stop 훅 누락");
  assert.ok(existsSync(join(out, "hooks/pretooluse.js")), "PreToolUse 하드블록 누락");
  // 🛑 이 한 줄이 **유일한 그물**이다(v0.65.0 F-29). pretooluse.js 의 최상위 require 는 **모듈 로드
  //   시점**에 던지고, 그 예외는 stdin 핸들러 밖이라 파일 안의 어떤 try/catch 도 못 잡는다 —
  //   매니페스트 복사 목록에서 이 파일이 빠지면 **PreToolUse 하드 차단 전부**(force-push · rm -rf ·
  //   deploy · env-encoder · gate-skip · 서브에이전트 차단 · 색 · 컴포넌트 · 무인 park)가 한꺼번에
  //   꺼진다. **소스에서는 초록, 배포판에서만 죽는다.** 골든 트리 비교도 못 잡는다(매니페스트에
  //   없으면 dist 와 골든에 둘 다 없어 비교가 초록이다).
  assert.ok(existsSync(join(out, "hooks/tool-ledger-core.js")), "F-29 층3 코어 누락 — 배포판에서 pretooluse.js 가 로드 시점에 죽는다");
  for (const s of ["referencing", "product-map", "design-system", "monitoring", "security-scan"])
    assert.ok(existsSync(join(out, "skills", s, "SKILL.md")), s);
  assert.ok(existsSync(join(out, "skills/retrospect/SKILL.md")));
  assert.ok(existsSync(join(out, "skills/retrospect/retrospect-scan.mjs")));
  // 스킬이 본문에서 부르는 스크립트는 빌드가 함께 옮겨야 한다(안 옮기면 스킬이 없는 파일을 부른다).
  assert.ok(existsSync(join(out, "skills/product-map/table-to-yaml.mjs")));
  assert.ok(existsSync(join(out, "skills/statusboard/SKILL.md")));
  assert.ok(existsSync(join(out, "skills/statusboard/board-core.mjs")));
  assert.ok(existsSync(join(out, "skills/statusboard/board-server.mjs")));
  // hooks.json은 Claude env var를 그대로 유지
  assert.match(readFileSync(join(out, "hooks/hooks.json"), "utf8"), /CLAUDE_PLUGIN_ROOT/);
});

// 🛑 손목록 의존을 끝내는 칸. 위 `existsSync` 줄들은 **사람이 한 줄씩 적은 목록**이라,
//    매니페스트 등재를 잊은 사람은 그 목록에도 안 적는다 — 그러면 검사도 안 잡는다.
//    골든 대조도 못 잡는다(빠진 파일은 dist 에도 골든에도 없어 "일치"가 된다).
//    그래서 **양방향 집합 비교**로 바꾸고, 그 목록을 루프로 돌며 dist 도착까지 본다.
//    ⚠ `hooks.claude.json` 은 대상이 아니다(빌드가 `hooks/hooks.json` 으로 바꿔 낸다).
test("components.hooks ↔ src/hooks/*.js 가 양방향으로 같고 전부 dist 에 도착한다", () => {
  const out = join(tmpDir("bc-hooks-"), "claude");
  buildClaude(SRC, out);
  const m = JSON.parse(readFileSync(join(SRC, "manifest.src.json"), "utf8"));
  const listed = [...m.components.hooks].sort();
  const actual = readdirSync(join(SRC, "hooks")).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(listed, actual,
    "매니페스트 등재와 실제 훅 파일이 어긋난다 — 빠진 파일은 배포판에만 없어 남의 컴퓨터에서만 죽는다");
  for (const f of listed) assert.ok(existsSync(join(out, "hooks", f)), "dist 에 안 실림: " + f);
});

// 🛑 같은 칸을 스킬에도 뚫는다(M8 · v0.66.0 에 스킬 2개가 새로 등재되는 지금이 가장 싸다).
//    `skills` 는 훅과 달리 **매니페스트 목록이 아니라 폴더를 통째로** 복사한다(copyTree) — 등재를
//    잊어도 배포물에는 실려서 "등재 = 그냥 문서"라는 착각이 남고, 개수 단언(13→15)만으로는
//    **이름이 어긋나는 경우**를 못 잡는다.
//    NOTICE 도착 단언을 같은 칸에 둔 이유: `test/dist-committed.test.mjs` 는 같은 src 로 갓 빌드한
//    것과 비교하므로 **복사에서 빠진 파일은 양쪽에 똑같이 없어 "일치"가 된다** — 그 축으로는 못 잡는다.
//    귀속 표시가 배포물에서 빠지면 MIT 동봉 의무가 조용히 깨진다.
test("components.skills ↔ src/skills/* 가 양방향으로 같고 전부 dist 에 도착한다", () => {
  const out = join(tmpDir("bc-skills-"), "claude");
  buildClaude(SRC, out);
  const m = JSON.parse(readFileSync(join(SRC, "manifest.src.json"), "utf8"));
  const listed = [...m.components.skills].sort();
  const actual = readdirSync(join(SRC, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(listed, actual,
    "매니페스트 등재와 실제 스킬 폴더가 어긋난다 — 등재 없이도 복사는 되므로 이 어긋남은 배포물이 아니라 문서에서 드러난다");
  for (const s of listed) assert.ok(existsSync(join(out, "skills", s, "SKILL.md")), "dist 에 안 실림: " + s);
  // 🛑 NOTICE 도착 단언은 `debugging` 한 곳에 하드코딩돼 있었다(v0.66.0). 그러면 **새 NOTICE 가
  //    배포물에서 빠져도 잡는 칸이 없다** - 위 `existsSync` 손목록과 똑같은 함정이다(이 파일 :50 주석).
  //    그래서 목록을 손으로 적지 않고 `src/skills/*/NOTICE` 존재로 뽑아 루프로 돈다.
  const noticed = listed.filter((s) => existsSync(join(SRC, "skills", s, "NOTICE")));
  assert.ok(noticed.length > 0,
    "NOTICE 를 가진 스킬이 하나도 없다 — 귀속 표시가 통째로 사라졌거나 이 검사가 엉뚱한 곳을 본다");
  for (const s of noticed)
    assert.ok(existsSync(join(out, "skills", s, "NOTICE")),
      `귀속 표시(NOTICE)가 배포물에 안 실렸다: ${s} — MIT 동봉 의무가 조용히 깨진다(골든·dist 대조로는 못 잡는 축)`);
});
