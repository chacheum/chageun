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
