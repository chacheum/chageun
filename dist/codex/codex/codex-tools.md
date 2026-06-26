# 차근 × Codex 도구 매핑

차근의 스킬·규칙·에이전트 지시문은 "행위"로 서술되어 있습니다.
Codex CLI에서 그 행위가 어떤 도구로 실행되는지 아래 표로 대응합니다.

> **instructions file** — Codex에서 프로젝트 수준 지시 파일은 프로젝트 루트 `AGENTS.md`입니다.
> (Claude의 `CLAUDE.md`에 해당. 플러그인은 SessionStart 훅을 통해 additionalContext로 규칙을 주입합니다.)

## 행위 → Codex 도구 대응표

| 행위 | Codex 도구 | 비고 |
|---|---|---|
| 파일 읽기 | `shell` (cat, head) | `cat 파일경로` 또는 `head -n 50 파일경로` |
| 파일 생성·수정·삭제 | `apply_patch` | 통합 패치 형식으로 변경 적용 |
| 명령 실행 (빌드·테스트·린트 등) | `shell` | `npm test`, `git diff` 등 |
| 내용 검색 | `shell` (grep, rg) | `grep -rn "검색어" .` 또는 `rg "검색어"` |
| URL 가져오기 | `shell` (curl, wget) | `curl -s URL` |
| 웹 검색 | `web_search` | 전용 도구 — shell로 대체 불가 |
| 서브에이전트 띄우기 | `spawn_agent` | `wait_agent`(결과 대기) · `close_agent`(정리) 함께 사용. **`[features] multi_agent=true` 필요** |
| 할일 추적 | `update_plan` | 작업 계획의 항목별 상태 갱신 |

## Claude 도구명 → Codex 동등물

차근의 스킬·규칙·에이전트가 Claude 도구명을 직접 언급할 경우 아래로 읽습니다.

| Claude 언급 | Codex 동등 행위 |
|---|---|
| `Read` 도구 | `shell`(cat/head)로 파일 읽기 |
| `Edit` / `Write` 도구 | `apply_patch`로 변경 적용 |
| `Bash` / `Task` 도구 | `shell`로 명령 실행 |
| `Agent tool` / `서브에이전트 띄우기` | `spawn_agent`(+`wait_agent`/`close_agent`) |
| `TodoWrite` / 할일 관리 | `update_plan` |

## 서브에이전트 활성화 방법

`spawn_agent`를 쓰려면 Codex 설정에서 멀티에이전트 기능이 켜져 있어야 합니다:

```
[features]
multi_agent=true
```

활성화되지 않은 경우, 게이트 에이전트(plan-validator·pr-reviewer·code-implementer)는
메인 에이전트가 **인라인**으로 직접 수행합니다. (`codex/gate-agents.md` 참조)

## 샌드박스 모드 참고

Codex `codex exec`를 쓸 때 `--sandbox` 옵션으로 권한 범위를 지정합니다:
- `read-only` — 읽기만 (plan-validator, pr-reviewer에 적합)
- `workspace-write` — 쓰기 포함 (code-implementer에 적합)
- `danger-full-access` — 외부 네트워크 포함 (일반적으로 불필요)
