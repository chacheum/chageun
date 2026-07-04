# 차근 계측(out-of-band metrics)

안전 훅이 실제로 몇 번, 어떻게 동작하는지 증거를 남긴다. **훅의 판정·출력·exit는 절대 바꾸지 않는다** — `log()`는 어떤 실패도 삼키고(`require`도 방어적으로 감쌈), 계측이 훅을 막지 않는다.

## 저장 위치
`~/.claude/chageun/metrics/YYYY-MM.jsonl` (월별, append-only, JSON 한 줄/이벤트).
env `CHAGEUN_METRICS_DIR`로 경로 오버라이드(테스트용).

## 공통 필드
`ts`(ISO8601) · `ev`(이벤트명) · `sid`(세션 id, 가능할 때).

## 이벤트
| ev | 훅 | 필드 | 의미 |
|----|----|------|------|
| `hook_block` | pretooluse | reason, unattended, tool, snippet(≤160자), sid | PreToolUse가 도구를 차단 |
| `escape_used` | pretooluse | hatch(ALLOW_DEPLOY\|SKIP_GATE), tool, snippet?, sid | 탈출구로 차단을 통과시킴(사각지대 가시화) |
| `gate` | finish-work | agent, verdict, tuid, sid | 게이트 실행+판정. verdict: pr-reviewer=`APPROVE`/`REQUEST_CHANGES`/`BLOCK`, plan-validator=`GO`/`NO-GO`/`CONDITIONAL`, 앵커 없으면 `unknown`. 최종 "PR 권고:"/"진행 권고:"/"최종 권고:" 줄에만 앵커(본문 오탐 방지). 백그라운드 게이트는 tool_result가 "실행 중" 스텁이라 판정이 없으므로 완료 통지 `<task-notification>`의 `<result>`를 tool-use-id로 조인해 판정을 복원한다(unknown ~30%→~8%) |
| `stop_block` | finish-work | reason(promise\|noEvidence), sid | Stop 훅이 "말만 하고 끝"을 되돌림 |
| `session_usage` | finish-work | input, output, cache_read, cache_creation, sid | 세션 누적 토큰(Stop마다 스냅샷). 스트리밍으로 같은 `message.id`가 부분값→최종값으로 여러 줄 기록되므로 id별 각 필드 최댓값만 합산한다(단순 합산 시 output ~2.6배 과대집계) |
| `skill_load` | finish-work | finishCheck, specGate, runVerify, edited, uiEdited, planned(bool), sid | 지연로드 절차 스킬이 세션에 로드됐는지 + **미발동률 분모**. `edited`(파일 편집함)=finish-check 분모, `uiEdited`(프런트엔드 확장자 편집)=run-verify 분모, `planned`(brainstorming/writing-plans)=spec-gate 분모. 미발동률 = (스킬 false AND 분모 true) / (분모 true) |

## 분석 시 주의(MVP 한계)
- **중복은 분석에서 제거:** finish-work는 Stop마다 transcript 전체를 재스캔하므로 `gate`·`session_usage`·`skill_load`가 세션당 여러 번 쌓인다. `gate`는 `tuid`로 dedup, `session_usage`는 `sid`별 마지막(또는 최댓값) 행, **`skill_load`는 `sid`별 마지막 행(불리언 OR)** 을 취한다(안 그러면 Stop 많은 세션이 과대 반영돼 미발동률 왜곡). (안전 훅 심장부에 상태파일 커플링을 넣지 않으려는 의도적 선택 — 중복 제거를 훅이 아니라 분석으로 미룸.)
- **Codex 미계측:** Codex는 PreToolUse 훅이 없어 `hook_block`/`escape_used` 불가. `finish-work-codex.mjs`도 이번 MVP에서 미계측(다음 배치).
- **severity 카운트 미추출:** `gate`는 판정(APPROVE/GO/…)만 남긴다. "blocker N·high M"은 아직 안 뽑음(리포트 텍스트 파싱 필요 — 다음 단계).
- **escape_used(SKIP_GATE)의 의미:** `isPrCreate && SKIP env 설정`이면 pr-reviewer가 실제로 돌았어도 매번 남는다 — "탈출구를 실제로 썼다"기보다 "스킵 env가 켜져 있었다"에 가깝다. 분석 시 유의.
- **session_usage(토큰) — message.id로 dedup됨:** 훅이 `message.id`별 각 필드 최댓값만 합산한다(스트리밍 부분값 중복 제거). id가 없는 usage는 dedup 불가라 그대로 더한다. 세션간 스냅샷 중복(Stop마다)은 위 "중복 제거"대로 `sid`별 최댓값 행을 취한다.
- **task-notification 조인의 자기참조 한계:** 게이트 결과문 안에 문자열 `</task-notification>`가 그대로 인용되면(예: 이 스키마 코드를 리뷰하는 도그푸딩 세션) 비탐욕 정규식이 블록을 거기서 잘라 verdict가 `unknown`으로 떨어질 수 있다. 결과는 보수적 방향(오판 아님)이라 방치. 
- **미발동 분모(edited/uiEdited/planned)는 근사치:** 메인 세션 transcript 기준이라 서브에이전트(code-implementer)가 대신 편집한 세션은 `edited`로 안 잡힐 수 있다. `uiEdited`는 확장자 매칭 1줄이라 프레임워크 밖 UI(비표준 확장자)는 놓친다. `planned`는 brainstorming/writing-plans 로드 여부 — 스킵하고 바로 스펙 쓴 세션은 분모에서 빠진다. 절대율보다 추세로 읽는다.
- **PII:** `hook_block.snippet`은 차단된 명령 160자로 시크릿이 섞일 수 있으나 **로컬 홈에만** 저장, 외부 전송 없음.

## out-of-band 보장의 경계(중요)
`log()`의 try/catch는 **throw는 잡지만 hang(무한 대기)은 못 잡는다**. 정상 경로(`$HOME` 아래)에서 `mkdirSync`/`appendFileSync`는 즉시 성공하거나 즉시 throw한다. 다만 일부 커널(예: WSL2)에서 `/proc` 같은 특수 경로에 `mkdirSync(..., {recursive:true})`가 **hang**하는 사례가 있어, `CHAGEUN_METRICS_DIR`를 그런 경로로 지정하면 훅이 멈출 수 있다. 그래서 테스트의 "불량 경로"는 `/proc` 대신 **파일 하위 경로**(ENOTDIR로 즉시 throw)를 쓴다. 실제 저장 경로는 항상 `$HOME` 아래이므로 이 위험에 노출되지 않는다.
