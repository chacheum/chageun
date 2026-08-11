// chageun tool-ledger-core — 층3: **목록 밖 도구는 막지 않는다. 대신 조용하지 않다**(v0.65.0 F-29).
//
// 왜 있나: v0.65.0 이 PreToolUse 매처를 `""`(모든 도구)로 넓혔다. 그래도 **판정**은 여전히 차근이
//   아는 도구에만 걸린다 — 새 도구가 나온 날 차근의 안전 잠금은 그 도구를 못 본다. 이 층은 그
//   사실을 **사람에게 알리는 것**까지만 한다.
// 🛑 **모르는 도구를 차단하지 않는다.** 판올림마다 사용자 작업이 멈추기 때문이다. 이 파일은
//   어떤 경로에서도 차단 사유를 내지 않는다(반환값은 알림 재료뿐).
// 🛑 **비용 규율: 파일도 트랜스크립트도 안 읽는다.** 메모리 안 집합 조회 한 번뿐이다. 결정 1번
//   (2026-08-11 · 파일을 안 만든다)이라 이 층에는 디스크 접근이 **아예 없다.** 이 규율이 깨지면
//   매처를 넓힌 비용 판단(세션당 약 1.6초)이 통째로 무너진다.
// 순수 모듈(fs·외부 호출 없음).

// ── 씨앗 목록 = 화이트리스트(금지 목록이 아니다) ─────────────────────────────
// **출처는 하나다: 설치본 `sdk-tools.d.ts` 의 `*Input` 선언**(v0.65.0 시점 Claude Code 2.1.228 · 44개).
//   실기록 census 는 **빠진 것이 있나 눈으로 대조하는 용도로만** 썼고, 거기 있는 이름을 옮겨 담지
//   않았다. census 에는 이 컴퓨터에만 있는 MCP 도구 이름이 섞여 있어, 그대로 담으면 **공개
//   플러그인에 남의 컴퓨터 도구 이름이 박힌다**(아래 MCP 항 참조).
//
// 선언에서 그대로 못 가져온 자리 셋 — 전부 사유를 적는다.
//   (가) **스키마 이름 ≠ 도구 이름**: 선언은 `FileEditInput`·`FileReadInput`·`FileWriteInput` 인데
//        훅에 실제로 오는 이름은 `Edit`·`Read`·`Write` 다(census 실측: Edit 1,554 · Read 617 ·
//        Write 248 · 반대로 `FileEdit` 류는 0건). 그래서 그 셋만 이름을 바꿔 담고, **원래
//        스키마 이름은 안 담는다** — 언젠가 런타임이 `FileEdit` 로 내보내기 시작하면 그날
//        차근의 편집 판정(EDIT_TOOLS_RE·색·컴포넌트 가드)이 통째로 조용히 꺼지므로, 그때는
//        **알림이 뜨는 편이 맞다.**
//   (나) **선언이 안 따라온 하네스 도구**: 아래 5개는 대조 기록에 실제로 있는데 선언에 없다
//        (SendMessage 109 · Skill 58 · ToolSearch 38 · ListAgents 15 · SendUserFile 4).
//        계획서가 정한 갈래 그대로 — `mcp__` 가 아니면서 선언에 없으면 손으로 담고 사유를 적는다.
//   (다) **차근 자신의 코드가 이미 일급으로 다루는 이름**: `Task`(spawnIntent 의 스폰 이름) ·
//        `MultiEdit`(EDIT_TOOLS_RE 의 편집 이름). 선언에도 대조 기록에도 없지만, 차근이 그 이름에
//        판정을 걸어 두고 같은 이름을 "처음 보는 도구"라고 알리면 **자기모순**이고 헛알림이다.
//        판정 근거는 취향이 아니라 소스다(`grep -n "Task\|MultiEdit" src/hooks/pretooluse*.js`).
//
// ⚠ **MCP 도구는 처음부터 이 목록 밖이다.** 이름이 사용자마다 다르고 언제든 늘어나 씨앗이
//   원리적으로 못 따라간다. 그래서 이 목록은 "차근이 아는 도구 전부"가 아니라
//   **"이 하네스가 v0.65.0 시점에 내는 이름"** 이다. 남의 컴퓨터에 붙은 MCP 도구는 목록 밖이고,
//   그 사실이 아래 스폰꼴 열쇠에서 `code`·`script` 를 뺀 이유이기도 하다.
const KNOWN_TOOLS = new Set([
  // (가)·선언 그대로 44개(FileEdit·FileRead·FileWrite 는 Edit·Read·Write 로)
  "Agent", "Artifact", "AskUserQuestion", "Bash", "ClaudeDesign", "CronCreate", "CronDelete",
  "CronList", "Edit", "EnterPlanMode", "EnterWorktree", "ExitPlanMode", "ExitWorktree", "Glob",
  "Grep", "ListMcpResources", "Mcp", "Monitor", "NotebookEdit", "Projects", "ProposeGoal",
  "ProposeSkills", "PushNotification", "REPL", "Read", "ReadMcpResource", "ReadMcpResourceDir",
  "RefreshMcpTools", "RemoteTrigger", "ReportFindings", "ScheduleWakeup", "SendFeedback",
  "ShowOnboardingRolePicker", "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop",
  "TaskUpdate", "TodoWrite", "WebFetch", "WebSearch", "Workflow", "Write",
  // (나)·선언이 안 따라온 하네스 도구 5개(대조 기록에서 실제로 봤다)
  "SendMessage", "Skill", "ToolSearch", "ListAgents", "SendUserFile",
  // (다)·차근 자신의 코드가 일급으로 다루는 이름 2개
  "Task", "MultiEdit",
]);

// 스폰꼴 열쇠. 이 다섯은 **"에이전트를 띄우는 꼴"에만 나오는 칸**이다
//   (`scriptPath`·`resumeFromRunId` 는 WorkflowInput 전용).
// 🛑 **`code`·`script` 는 일부러 뺐다.** 둘은 도구 입력에서 매우 흔한 칸 이름이고, MCP 도구 이름은
//   사용자마다 달라 씨앗이 원리적으로 못 따라간다. 코드를 돌리는 MCP 도구를 붙인 사용자는
//   **호출할 때마다** "처음 보는 도구입니다"를 맞는데, 결정 1번(파일 안 만듦) 때문에 상태가 없고
//   훅은 호출마다 새 프로세스라 **소음이 나기 시작하면 끌 방법이 설계상 없다.**
//   "6,706건 중 1건"이라는 빈도는 **한 저장소 29세션 census** 이고 차근은 공개 플러그인이라,
//   그 숫자를 남의 컴퓨터의 소음 근거로 쓸 수 없다.
//   **이 하네스에서 잃는 것은 없다**: Workflow·REPL 은 층2 가 **이름으로** opaque 로 잡는다.
//   남는 한계는 "`code` 칸을 든, 이름이 처음 보는 도구는 알림 없이 지나간다" 하나다(정직한 한계).
// 🛑 안 고른 대안: "`mcp__` 로 시작하는 이름을 알림에서 뺀다" — 씨앗 밖일 가능성이 **가장 높은**
//   부류를 통째로 눈감는 것이라 이 층이 겨눈 자리를 놓친다.
const SPAWN_SHAPE_KEYS = ["subagent_type", "agentType", "agent_type", "scriptPath", "resumeFromRunId"];

// 반환: null(아는 도구) | { name, spawnShaped }.
//   spawnShaped=false 여도 null 이 아니다 — 알릴지 말지는 호출자가 정한다(지금 배선은 스폰꼴만 알린다).
function unknownToolNotice(toolName, toolInput) {
  const name = String(toolName || "");
  if (!name || KNOWN_TOOLS.has(name)) return null;
  const inp = toolInput && typeof toolInput === "object" ? toolInput : {};
  const spawnShaped = SPAWN_SHAPE_KEYS.some((k) => inp[k] !== undefined && inp[k] !== null && inp[k] !== "");
  return { name, spawnShaped };
}

// 알림 문구. **통로가 하나뿐이라 문구가 행동을 지정한다.**
//   쓸 수 있는 자리는 `hookSpecificOutput.additionalContext` 하나다 — stderr 는 이 훅 계약에서
//   **exit 2 일 때만** 전달되고 exit 2 는 차단이라 이 층에서는 금지다. 즉 알림은 **Claude 를 거쳐야**
//   사용자에게 닿고, 그건 보장이 아니다(이 저장소는 "모델이 알아서 하겠지"에 기대다 0회 발동을
//   겪은 전례가 있다). 그래서 문구가 다음 행동을 못박는다.
// ⚠ 정직: 이 층이 재는 것은 **알림이 나갔는가**이지 사람이 읽었는가가 아니다.
function unknownToolMessage(name) {
  return "차근 알림: 차근이 처음 보는 도구 `" + String(name) + "` 가 쓰였습니다. "
    + "차근의 안전 잠금(게이트 스폰 차단·신선도·계획 규모·모델 강등)은 이 도구를 판정하지 못합니다. "
    + "막지는 않았습니다. **지금 사용자에게 한 줄로 알리세요.**";
}

module.exports = { KNOWN_TOOLS, SPAWN_SHAPE_KEYS, unknownToolNotice, unknownToolMessage };
