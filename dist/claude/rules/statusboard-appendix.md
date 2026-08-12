## 상황판 `status.md` (상세: `chageun:statusboard`)

- §2는 기계가 쓴다. 사람 몫: 끝난 일 §5로, BLOCKED는 §1로, 끝 점검 때 §4·§5·§6.
- 사용자가 "했다" 하면 그 자리에서 §1에서 지운다.
- 페이지가 떠 있으면 답장 끝에 주소를 단다. 주소는 `board.json`에서 읽는다(포트 박지 않기).
- 고치기 전에 이번 세션 첫 `git check-ignore -q status.md` 한 번. 0이 아니면 `## 이미 있을 때`.
- 서버: `node {{BOARD_SERVER}}`
<!-- chageun:appendix:if-no-markers -->
- 기계 칸 표시가 없습니다: §2와 머리 칸이 자동으로 안 채워집니다. `## 이미 있을 때`로 표시 두 벌을 넣으세요.
