# 차근 운영 규칙 — Codex 적응 보충

> 이 문서는 Codex 세션 시작 시 `operating-rules.md`에 **자동으로 덧붙여집니다.**
> 원본 운영 규칙의 모든 내용은 그대로 유효하며, 아래는 Codex 환경에서 다르게 읽어야 할 항목만 기술합니다.

## 모델 이름 변환

`operating-rules.md`에 등장하는 모델 이름을 Codex에서는 다음과 같이 읽습니다:

| 운영 규칙의 표기 | Codex에서의 의미 |
|---|---|
| **Opus** | 강한 모델 (reasoning effort: high) |
| **Sonnet** | 빠른 모델 (reasoning effort: 기본/낮음) |

## 도구 호출 변환

운영 규칙의 "Agent tool 호출" · "서브에이전트 띄우기"는 Codex에서 `spawn_agent`로 실행합니다.
`spawn_agent` 사용에는 **`[features] multi_agent=true`** 가 필요합니다.

상세 도구 매핑은 `codex/codex-tools.md`를 참조하세요.

## 스킬 로드 지시 변환

운영 규칙의 **"반드시 Skill 도구로 `chageun:○○`를 로드한 뒤 진행"** 류 지시(spec-gate·run-verify·finish-check·routing 등 절차 스킬 전부)는 Codex에서 **"운영 규칙 뒤에 인라인된 해당 스킬 본문을 그 시점에 따른다"**로 읽습니다 — Codex엔 Skill 도구가 없고 해당 스킬 본문들이 이미 이 세션에 첨부돼 있습니다. "로드 없이 골격만으로 마치지 않는다"는 강제는 동일하게 유효합니다(본문 절차를 건너뛰지 않음).

## 기계 훅 (승인 후 작동 — 얇은 2차 그물)

Codex에도 기계 훅이 있다: PreToolUse 하드블록(강제 push·위험 삭제·파괴적 SQL·배포 차단)과 Stop 가드(작업 약속 미이행·증거 없는 실행 주장 차단). **단 훅 승인(`/hooks`) 후에만 작동하며**, Codex 훅은 일부 셸 경로를 가로채지 못하는 guardrail이다 — **텍스트 멈춤 규칙이 여전히 1차 방어**고 훅은 2차 그물이다. 스킬갭 가드(끝 점검·실구동·비전문가 요약)와 plan/routing 리마인더는 Claude 전용(Codex는 스킬이 인라인이라 해당 없음).

## 실제 구동 검증 도구 (run/verify 대체)

실제 구동 검증의 **절차와 Codex 도구 매핑 모두** 이 세션에 인라인된 `run-verify` 스킬 본문(운영 규칙 뒤 첨부, `## 도구 (플랫폼별)` 절)을 따릅니다 — 여기서 중복 기술하지 않습니다(단일 원본=스킬 본문). **테스트 환경·운영 쓰기 hard-block은 플랫폼 무관으로 그대로**(격리 환경 없으면 보류·운영 시도 금지).

## 게이트 에이전트 실행

운영 규칙의 검증 게이트(plan-validator · pr-reviewer · code-implementer)는 Codex에서 다음 방식으로 실행합니다:

- **인라인 우선 (기본):** `[features] multi_agent=true` 없이도 동작. 메인 에이전트가 게이트 시점에 `codex/gate-agents.md`의 해당 에이전트 지시문을 **직접 따라** 검증을 수행합니다.
- **선택적 분리:** `multi_agent=true`가 활성화된 경우 `spawn_agent`로 독립 에이전트를 띄워 신선한 컨텍스트로 실행할 수 있습니다.

각 에이전트의 지시문 전문과 호출 방법은 `codex/gate-agents.md`를 참조하세요.

## Superpowers 스킬 (소프트 의존)

운영 규칙이 Superpowers 스킬(brainstorming · writing-plans · systematic-debugging 등)을 참조하는 경우:

- Superpowers가 **설치돼 있으면**: 그 스킬을 그대로 사용합니다.
- Superpowers가 **없으면**: 차근 운영 규칙의 지시문만으로 진행합니다. 스킬을 찾지 못한다고 워크플로를 중단하지 않습니다(자동 설치를 시도하지도 않습니다).

## instructions file

Codex에서 프로젝트 수준 지시 파일은 프로젝트 루트 `AGENTS.md`입니다.
운영 규칙이 `CLAUDE.md`를 언급하는 경우 `AGENTS.md`로 읽습니다.
