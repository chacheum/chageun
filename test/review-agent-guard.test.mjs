import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
const require = createRequire(import.meta.url);
const core = require(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "pretooluse-core.js"));
const { isReviewAgent, reviewAgentBlock, reasonFor } = core;
const MEM = join(os.homedir(), ".claude", "agent-memory");

test("isReviewAgent: 네임스페이스 무관 매칭(리브랜드 안전)", () => {
  for (const y of ["chageun:pr-reviewer", "honclwd:pr-reviewer", "pr-reviewer", "chageun:plan-validator", "plan-validator"])
    assert.equal(isReviewAgent(y), true, y);
  for (const n of ["chageun:code-implementer", "code-implementer", "general-purpose", undefined, null, "", "pr-reviewer-x", "x-plan-validator-y"])
    assert.equal(isReviewAgent(n), false, String(n));
});

test("Write: agent-memory 밖 차단, 안 허용", () => {
  const W = (fp) => reviewAgentBlock("chageun:pr-reviewer", "Write", { file_path: fp });
  assert.equal(W(join(MEM, "chageun-pr-reviewer", "notes.md")), null);           // 안 → 허용
  assert.equal(W("/home/x/proj/src/a.js"), "ra-write");                          // 프로젝트 파일
  assert.equal(W(join(os.homedir(), ".claude", "settings.json")), "ra-write");   // 설정
  assert.equal(W(join(os.homedir(), ".claude", "agent-memory-evil", "x")), "ra-write"); // 형제 폴더
  assert.equal(W(join(MEM, "..", "escape.md")), "ra-write");                     // .. 이탈
  assert.equal(W("~/.claude/agent-memory/chageun-pr-reviewer/n.md"), null);      // ~ 확장
  assert.equal(W(""), "ra-write");                                               // 빈 경로
  assert.equal(W("relative/notes.md"), "ra-write");                              // 상대경로
  assert.equal(reviewAgentBlock("chageun:plan-validator", "Edit", { file_path: "/proj/plan.md" }), "ra-write");
});

test("Bash: git 읽기만 허용, 나머지·리다이렉션·치환 차단", () => {
  const B = (c) => reviewAgentBlock("chageun:pr-reviewer", "Bash", { command: c });
  for (const ok of ["git diff", "git status", "git log --oneline", "git show HEAD",
                    "git ls-files --others --exclude-standard", "git diff --stat",
                    "git diff HEAD | head -50", "git -C /r diff", "git --no-pager log"])
    assert.equal(B(ok), null, "허용이어야: " + ok);
  for (const bad of ["git checkout main", "git reset --hard", "git stash", "git apply p.diff",
                     "git cherry-pick x", "git merge b", "git commit -m x", "git push",
                     "git -c core.pager=!sh log", "npm test", "node -e 'x'", "npx prettier --write .",
                     "echo x > f", "git diff > out.txt", "rm f", "mv a b", "sed -i s/a/b/ f",
                     "cat $(rm x)", "PAGER=cat git log",
                     "git diff & npm test", "sort -o out.txt in", "uniq in out", "git worktree add w"])
    assert.equal(B(bad), "ra-bash", "차단이어야: " + bad);
});

test("비리뷰 에이전트는 판정 안 함(호출부 가드) — reviewAgentBlock은 리뷰 전제", () => {
  // 함수 자체는 agentType을 안 보지만, 배선이 isReviewAgent로 가드하므로 여기선 매칭만 확인.
  assert.equal(isReviewAgent("chageun:code-implementer"), false);
});

test("REASONS 3키가 행동 지시형으로 존재", () => {
  for (const k of ["ra-write", "ra-bash", "ra-error"]) {
    const msg = reasonFor(k);
    assert.ok(msg && msg !== "차단: 되돌리기 어려운 고위험 명령입니다.", k + " 문구 부재");
    assert.ok(/발견으로 보고|Read\/Grep|계속/.test(msg), k + " 행동지시 아님");
  }
});
