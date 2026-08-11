// chageun pretooluse — PreToolUse 하드 차단 훅(Claude 전용).
// "말로 된 브레이크"를 기계 브레이크로: 되돌리기 불가능한 소수 고위험 패턴만 결정론적으로 막는다.
// 얇은 그물이지 만능 아님 — 확실히 파괴적인 경우만 차단(오탐 회피). 매치 시 exit 2 + stderr 사유.
// 예외·불확실은 안전 통과(exit 0). 외부 호출 없음. 개인/회사 정보 없음.
// 순수 패턴 판정은 core, 부수효과(env 탈출구·transcript 읽기)는 이 래퍼에 둔다.
// NOTE: 순수 판정은 pretooluse-core.js가 갖고, 이 래퍼에만 있는 것들(agent_type 분기·transcript
// 리마인더·디자인 색 백스톱)은 부수효과가 필요해 여기 둔다.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { block, reasonFor, isPrCreate, isPush, hasPrReviewer, planReminderNeeded, routingReminderNeeded, designRegistryReminderNeeded, isUiTarget, unattendedBlock, reasonForUnattended, budgetStep, isGitCommit, BUDGET, isReviewAgent, reviewAgentBlock, gateModelBlock, subagentGateSpawn, approvedDesignVariant, planScaleBlock, approvedBigPlan, spawnIntent, LEGACY_UNATTENDED_SCOPE } = require("./pretooluse-core.js");
const { isDesignScanTarget, parseAllowColors, scanColors, violationsForEdit, readDesignDoc } = require("./design-scan-core.js");
const componentBoundary = require("../skills/design-system/component-boundary-core.cjs");

// P1 리마인더 대상 도구(코드 수정류).
const EDIT_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
// P1 리마인더 전용 transcript 리더 — needle 조기 탈출(plan 없는 세션의 매 편집 파싱 비용 회피).
// 주의: prReviewerRan(게이트 생략 감지)은 이 헬퍼를 쓰지 않는다 — "pr-reviewer"에 "plan"이 없어
// 조기 탈출을 공유하면 gate-skip이 회귀한다(게이트 CONDITIONAL 조건). 부재·예외는 null(리마인더 침묵).
function readTranscriptIfMentions(transcriptPath, needle) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const raw = fs.readFileSync(transcriptPath, "utf8");
    if (raw.indexOf(needle) === -1) return null;
    const objs = [];
    for (const ln of raw.split("\n")) {
      const s = ln.trim(); if (!s) continue;
      try { objs.push(JSON.parse(s)); } catch (_) { /* skip */ }
    }
    return objs;
  } catch (_) { return null; }
}

// v0.42: 서브에이전트면 사람 전용 탈출구를 안내하지 않는다(켤 수도 없고, 그 승인은 사람 판단이다).
// input.agent_type은 서브에이전트에만 있다(메인 세션은 없음 → 기존 문구 그대로).
let IS_SUBAGENT = false;
function deny(reasonKey, unattended, detail) {
  const base = unattended ? reasonForUnattended(reasonKey) : reasonFor(reasonKey, IS_SUBAGENT);
  // detail(예: 실제 위반 색 토큰 목록)이 있으면 정적 사유 뒤에 덧붙인다.
  process.stderr.write(detail ? base.replace(/\n?$/, "") + " (위반: " + detail + ")\n" : base);
  process.exit(2); // PreToolUse: exit 2 = 도구 호출 차단, stderr를 Claude에 전달
}

// 제어파일(.chageun/STOP·token) 위치를 한 곳에 못 박는다 — 세션이 하위폴더·전용 worktree로
// 옮겨 다녀도 "사람이 STOP을 두는 곳"과 "훅이 찾는 곳"이 갈라지지 않게. cwd는 신뢰 안 함.
// 1순위: 런처가 준 CHAGEUN_ROOT(env는 cd로 안 바뀜). 2순위: cwd에서 위로 올라가며 .chageun 탐색
// (STOP을 더 잘 찾는 안전 방향). 못 찾으면 cwd(그러면 통과표 부재 → fail-closed park).
function ctlRoot() {
  const fromEnv = process.env.CHAGEUN_ROOT;
  if (fromEnv) return fromEnv;
  let dir = process.cwd();
  for (let i = 0; i < 64; i++) {
    try { if (fs.existsSync(path.join(dir, ".chageun"))) return dir; } catch (_) { /* 계속 */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
function ctlPath(name) { return path.join(ctlRoot(), ".chageun", name); }
function stopRequested() { try { return fs.existsSync(ctlPath("STOP")); } catch (_) { return true; } } // 읽기 예외도 안전측
function validPreflightToken() {
  try {
    const want = process.env.CHAGEUN_UNATTENDED_TOKEN;
    if (!want) return false;
    const data = JSON.parse(fs.readFileSync(ctlPath("token"), "utf8"));
    return typeof data.nonce === "string" && data.nonce.length > 0 && data.nonce === want;
  } catch (_) { return false; } // 부재·파싱실패 = 무효(fail-closed)
}

// 예산 상태 읽기: "부재(go가 지움=새 시작) / 정상 / 손상(리셋 금지)"을 구분.
function readRuntime() {
  const p = ctlPath("runtime.json");
  if (!fs.existsSync(p)) return { absent: true };
  try {
    const state = JSON.parse(fs.readFileSync(p, "utf8"));
    // 파싱은 됐어도 스키마가 틀리면(null·숫자·startedAt 없음) 손상으로 취급 — 조용히 리셋 금지.
    if (!state || typeof state.startedAt !== "number") return { corrupt: true };
    return { state };
  } catch (_) { return { corrupt: true }; }
}
// 원자적 쓰기(temp+rename) — 동시 서브에이전트 읽기가 잘린 파일을 보지 않게(POSIX rename 원자적).
function writeRuntime(s) {
  try {
    const p = ctlPath("runtime.json"), tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, p);
  } catch (_) { /* 무시 */ }
}

// transcript를 읽어 pr-reviewer 실행 흔적 확인. 못 읽으면 fail-open(true) — 훅 오류로 정상작업 안 막음.
function prReviewerRan(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return true; // fail-open(no-op)
    const objs = [];
    for (const ln of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
      const s = ln.trim(); if (!s) continue;
      try { objs.push(JSON.parse(s)); } catch (_) { /* skip */ }
    }
    return hasPrReviewer(objs);
  } catch (_) { return true; } // 어떤 예외든 fail-open
}

// ── 공용 component 경계(Claude 편집 시점 hard block) ────────────────────────
const COMPONENT_EDIT_RE = /^(Write|Edit|MultiEdit)$/;
function boundaryIssue(code, detail) { return detail ? { code, detail } : { code }; }
function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; }
}
function normalizedRelative(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}
function boundaryDocumentPath(root) {
  return path.resolve(root, process.env.DESIGN_COMPONENT_DOC || "docs/design-system.md");
}
function appendBoundary(entries, target, result) {
  for (const entry of entries) target.push(entry.code ? entry : boundaryIssue(String(entry)));
  if (result) {
    appendBoundary(result.violations || [], target);
    appendBoundary(result.errors || [], target);
  }
}
function parseBoundaryConfig(text, label, entries) {
  try { return componentBoundary.parseDesignConfig(text || ""); }
  catch (error) {
    entries.push(boundaryIssue("configuration-error", `${label}: ${error.message}`));
    return null;
  }
}
function parseBoundaryRegistry(text, label, entries) {
  if (text === null) {
    entries.push(boundaryIssue("registry-missing", label));
    return null;
  }
  try { return componentBoundary.parseRegistry(text); }
  catch (error) {
    entries.push(boundaryIssue("registry-invalid", `${label}: ${error.message}`));
    return null;
  }
}

// 이 함수는 filesystem을 읽되, 수정 대상 파일은 tool input으로 계산한 after text로 덮어쓴다.
// 색 검사와 달리 component 경계에는 lint ignore나 환경변수 우회가 없다.
function runComponentBoundaryChannel(input, context) {
  const name = input.tool_name;
  const tool = input.tool_input || {};
  if (!COMPONENT_EDIT_RE.test(String(name || ""))) return [];
  const root = path.resolve(input.cwd || process.cwd());
  const entries = [];
  const document = boundaryDocumentPath(root);
  if (typeof tool.file_path !== "string" || !tool.file_path) {
    const config = parseBoundaryConfig(readText(document), "before design document", entries);
    if (entries.length) return entries;
    return config?.enabled ? [boundaryIssue("edit-input-invalid", "file_path")] : [];
  }
  const target = path.resolve(root, tool.file_path);
  const beforeTarget = readText(target);
  const beforeDocument = target === document ? beforeTarget : readText(document);

  // 비채택 프로젝트에는 component 경계가 도구 입력 형식까지 관여하지 않는다.
  // 다만 규칙 문서 자체를 바꾸는 경우에는 before/after 양쪽을 계산해 해제를 막는다.
  let beforeConfig = null;
  if (target !== document) {
    beforeConfig = parseBoundaryConfig(beforeDocument, "before design document", entries);
    if (entries.length || !beforeConfig?.enabled) return entries;
  }
  const applied = componentBoundary.applyToolEdit(tool, beforeTarget || "");
  appendBoundary(applied.errors, entries);
  if (entries.length) return entries;

  const afterDocument = target === document ? applied.after : beforeDocument;
  if (target === document) beforeConfig = parseBoundaryConfig(beforeDocument, "before design document", entries);
  const afterConfig = parseBoundaryConfig(afterDocument, "after design document", entries);
  if (entries.length || !afterConfig) return entries;
  if (beforeConfig?.enabled && !afterConfig.enabled) {
    entries.push(boundaryIssue("design-system-disabled", "docs/design-system.md"));
    return entries;
  }
  if (!afterConfig.enabled) return entries; // 디자인 시스템 미채택 프로젝트는 무영향

  const registryFile = path.resolve(root, afterConfig.registryPath);
  const beforeRegistryFile = beforeConfig?.enabled ? path.resolve(root, beforeConfig.registryPath) : null;
  const beforeRegistryText = beforeRegistryFile === target ? beforeTarget : (beforeRegistryFile ? readText(beforeRegistryFile) : null);
  const afterRegistryText = registryFile === target ? applied.after : readText(registryFile);
  const beforeRegistry = beforeConfig?.enabled
    ? parseBoundaryRegistry(beforeRegistryText, "before registry", entries)
    : null;
  const afterRegistry = parseBoundaryRegistry(afterRegistryText, "after registry", entries);
  if (entries.length || !afterRegistry) return entries;

  appendBoundary(componentBoundary.validateRegistryBoundary({ config: afterConfig, registry: afterRegistry }).errors, entries);
  const changes = beforeRegistry
    ? componentBoundary.registryChanges(beforeRegistry, afterRegistry)
    : { addedComponents: Object.keys(afterRegistry.components), addedVariants: [], addedDecisions: [], errors: [] };
  appendBoundary(changes.errors, entries);

  // 기존 component에 새 변형을 붙일 때만, 바로 앞 AskUserQuestion의 실제 두 번째 선택과 ID를 묶는다.
  if (!entries.length && changes.addedVariants.length) {
    const transcript = readTranscriptIfMentions(context.transcript_path, "chageun-design-variant:") || [];
    for (const { component, variant } of changes.addedVariants) {
      const decisions = changes.addedDecisions.filter((decision) => decision.component === component && decision.variant === variant);
      if (decisions.length !== 1) continue; // registryChanges가 mismatch로 이미 막는다.
      const approval = approvedDesignVariant(transcript, component, variant);
      if (!approval.approved || decisions[0].approvalToolUseId !== approval.toolUseId) {
        entries.push(boundaryIssue("variant-approval-missing", `${component}:${variant}`));
      }
    }
  }
  if (entries.length) return entries;

  const relativeTarget = normalizedRelative(root, target);
  const knownSources = {};
  for (const component of Object.values(afterRegistry.components)) {
    const sourceFile = path.resolve(root, component.path);
    const source = sourceFile === target ? applied.after : readText(sourceFile);
    if (source !== null) knownSources[component.path] = source;
  }

  // registry-first 직후에만 아직 없는 source를 후보 비교에서 제외한다. 프로젝트 검사기의
  // 최종 snapshot 검사는 이 인자를 주지 않아 source 부재를 계속 실패로 처리한다.
  const pendingSourcePaths = new Set(changes.addedComponents
    .map((id) => afterRegistry.components[id].path)
    .filter((file) => typeof knownSources[file] !== "string"));
  const checked = new Set();
  const inspectComponent = (file, source = knownSources[file]) => {
    if (checked.has(file) || typeof source !== "string") return;
    checked.add(file);
    appendBoundary([], entries, componentBoundary.validateComponent({
      file,
      after: source,
      config: afterConfig,
      registry: afterRegistry,
      knownSources,
      pendingSourcePaths,
    }));
  };
  const role = componentBoundary.pathRole(relativeTarget, afterConfig);
  if (role === "page") {
    appendBoundary([], entries, componentBoundary.validatePage({
      file: relativeTarget,
      before: beforeTarget,
      after: applied.after,
      config: afterConfig,
      registry: afterRegistry,
      knownSources,
      mode: beforeTarget === null ? "full" : "incremental",
    }));
  } else if (role === "component" && relativeTarget !== afterConfig.registryPath) {
    inspectComponent(relativeTarget, applied.after);
  }

  // registry-first는 source가 아직 없으면 허용한다. 이미 있는 source를 새 registry entry로 편입하면
  // marker와 구조를 지금 검사해 이름만 바꾼 복사를 숨기지 못하게 한다.
  for (const id of changes.addedComponents) inspectComponent(afterRegistry.components[id].path);
  // 레지스트리를 고치면 이미 등록된 source도 새 ID·변형과 맞는지 그 자리에서 확인한다.
  // source가 아직 없는 새 항목은 registry-first 생성 순서를 위해 위 inspectComponent가 건너뛴다.
  if (relativeTarget === afterConfig.registryPath) {
    for (const component of Object.values(afterRegistry.components)) inspectComponent(component.path);
  }
  return entries;
}

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  const UNATTENDED = process.env.CHAGEUN_UNATTENDED === "1";
  // 🛑 `name` 선언을 try **밖**으로 올린다(v0.65.0 F-29). 파일 끝 무인 fail-closed catch 가 이 값을
  //   봐야 하는데, try 안 선언이면 그 자리에서 ReferenceError 가 나고 catch 안에서 난 예외는 아무도
  //   안 잡아 훅이 비정상 종료한다 — **무인 park 이 통과로 뒤집힌다.** 대입 자리는 아래 그대로 두고
  //   형도 안 바꾼다(소비자들은 이미 String(name||"") 로 감싸 쓴다).
  let name;
  try {
    const input = JSON.parse(raw);
    name = input.tool_name;
    const ti = input.tool_input || {};
    IS_SUBAGENT = !!input.agent_type;   // v0.42: 사람 전용 탈출구 안내를 서브에이전트에 주지 않기 위함
    // v0.65.0 F-29: 스폰 판정은 **한 곳**에서 한 번만 낸다(사본 금지 · pretooluse-core.js spawnIntent).
    //   null | { kind:"opaque"|"readable", via:"name"|"shape", agentType }. 순수 판정이라 여기서 미리 내도 싸다.
    const spawn = spawnIntent(name, ti);

    // v0.65.0 F-29(결정 3번 · **사용자**가 정했다 2026-08-11): **무인 범위는 안 넓힌다.**
    //   뜻은 딱 하나다 — 그물을 넓혀 무인에 **새로 도달하게 된** 차단만 무인에서 안 켠다.
    //   🛑 **기존에 이미 무인에서 돌던 차단을 끄라는 뜻이 아니다.** 그래서 무인 **전용** 판정
    //   네 곳(§0 STOP·통과표 · §0.5 예산·워치독 · §2 unattendedBlock·u-pr · 파일 끝 바깥 catch)만
    //   옛 매처 집합 안에서 돈다. 세는 호출 수가 그대로라 **무인 예산 소진 속도가 v0.65.0 전과
    //   정확히 같다.**
    //   🛑 **그 밖의 판정은 넓힌 범위 그대로다**(리뷰 격리 · base block · 게이트 모델 · 계획 규모 ·
    //   게이트 스폰 · **불투명 통로 차단** · 신선도 · 색 · 컴포넌트 · 리마인더). 여기까지 좁히면
    //   **무인이 유인보다 헐거워진다** — 무인 서브에이전트만 Workflow 를 자유롭게 쓰게 되어
    //   결정 4번과 정면으로 어긋난다. **무인은 유인보다 느슨해질 수 없다**는 것이 이 저장소의 규율이다.
    //   🛑 그래서 무인 갈래를 **함수 머리에서 통째로 조기 종료**하는 모양으로 짜지 말 것.
    //   그렇게 짜도 (가)·(나) 칸과 965건 재생이 전부 초록이라, 그 실수만 잡는 칸을 따로 뒀다:
    //   test/hook-net.test.mjs 의 무인 (다).
    const UNATTENDED_SCOPED = UNATTENDED && LEGACY_UNATTENDED_SCOPE.test(String(name || ""));

    // 0-pre) 리뷰 에이전트 격리(Claude 서브에이전트 한정 — 순수 문자열·fail-closed).
    //   transcript·fs 접근 없이 훅 초반에 판정. 판정 예외 시 안전측 차단(ra-error). agent_type은
    //   서브에이전트에만 있음(메인 세션은 없음 → 무영향). deny는 항상 ra-* 문구라 UNATTENDED 무관 false.
    //   파싱 실패 시엔 이 분기 전에 바깥 catch로 빠져 유인 fail-open(메인 배려 — 스펙 §최대위험).
    if (isReviewAgent(input.agent_type)) {
      let raHit;
      try { raHit = reviewAgentBlock(input.agent_type, name, ti); } catch (_) { raHit = "ra-error"; }
      if (raHit) return deny(raHit, false);
    }

    // 0) 무인 게이트: 정지 요청 or preflight 통과표 없음 → park(fail-closed).
    //    v0.65.0: **옛 집합만.** 넓힌 범위에서 돌면 무인 세션이 전보다 자주 멈춘다(사용자가 거부한 방향).
    if (UNATTENDED_SCOPED) {
      if (stopRequested()) return deny("u-stop", true);
      if (!validPreflightToken()) return deny("u-no-preflight", true);
    }

    // 0.5) 무인 예산·워치독: 매 호출 카운트+시각 검사. 초과/헛돎 → park. commit은 진전.
    //    v0.65.0: **옛 집합만** — 세는 호출 수가 그대로라 소진 속도가 v0.65.0 전과 정확히 같다.
    if (UNATTENDED_SCOPED) {
      const rt = readRuntime();
      if (rt.corrupt) return deny("u-error", true); // 손상 시 시계 리셋 대신 안전 park
      const { state, reason } = budgetStep(rt.state || null, Date.now(), isGitCommit(name, ti), BUDGET);
      writeRuntime(state);
      if (reason) return deny(reason, true);
    }

    // 1) base 패턴 차단. 무인 모드는 배포 탈출구(CHAGEUN_ALLOW_DEPLOY)를 무시.
    const hit = block(name, ti);
    if (hit === "deploy") {
      if (UNATTENDED || process.env.CHAGEUN_ALLOW_DEPLOY !== "1") return deny("deploy", UNATTENDED);
      // ALLOW_DEPLOY=1(유인)이면 배포 통과.
    } else if (hit) {
      return deny(hit, UNATTENDED);
    }

    // 1.5) 게이트 모델 런타임 강등 차단(v0.42). frontmatter 검사는 정적이라 Task 호출의 `model`
    //   덮어쓰기를 못 본다(실측: 게이트를 frontmatter보다 낮은 티어로 강등해 띄운 세션이 있었다).
    //   ⚠ v0.44.0에서 게이트 기본이 fable→opus로 내려갔다. 그래서 위 실측 사례("opus로 띄움")는
    //   이제 강등이 아니라 **기본 동작**이다. 지금 강등은 sonnet·haiku 쪽이다.
    //   탈출구: 기본 티어 모델이 없는 환경이 락아웃되면 게이트를 아예 안 부르게 돼 안전이 오히려 후퇴한다.
    //   무인 모드는 다른 탈출구와 같은 원칙으로 이 탈출구를 무시한다(무인 중 심판 강등 금지).
    {
      const gm = gateModelBlock(name, ti);
      if (gm && (UNATTENDED || process.env.CHAGEUN_ALLOW_GATE_MODEL !== "1")) return deny(gm, false);
    }

    // stdout JSON 은 이 훅에서 **한 번만** 쓴다. §1.6 진단과 §4~4.6 리마인더가 이 깃발을 공유한다.
    let reminderEmitted = false;

    // 1.6) 계획 규모 가드(v0.53.0). plan-validator.md 의 같은 축은 **보고**만 하고 안 멈춰서
    //   실측 사고를 못 막았다(차단 시점 4,020줄 · 10회 넘는 재검증 · 나흘간 코드 0줄).
    //   ⚠ 이 가드가 **왜** 멈추는지(예측기가 아니라 동의 관문)와 그 정직 고지(차단이 효과였는지
    //     처방 문구가 효과였는지는 안 갈렸다)는 pretooluse-core.js 의 `planScaleBlock` 위 주석이
    //     단일 출처다. 여기 요약만 읽고 프레임을 판단하지 말 것.
    //   탈출구를 환경변수로 안 둔 이유: 그건 세션 도중 못 켜서 오차단 시 회복이 세션 재시작뿐이다
    //   (pretooluse-core.js 의 REASONS["deploy"]·REASONS["gate-skip"] 문구가 같은 사실을 이미 못박아 뒀다).
    //   무인 모드는 승인 통로를 무시한다(사람이 승인할 수 없는 자리 · 실패 모드는 park).
    //   ⚠ 자체 try/catch 를 둔다. 바깥 catch(stdin 'end' 핸들러 끝)는 유인 모드에서 **아무 말 없이
    //     exit 0** 이라, 판정에 버그가 들어가면 가드가 꺼진 줄 모른 채 몇 주가 지난다
    //     (pr-reviewer 1회차 medium). 여기서는 통과시키되 stderr 한 줄로 꺼졌음을 남긴다.
    //   **크기 한 축만** 본다. 회차 축은 만들지 않기로 확정됐다(2026-08-09 · 되살릴 계획 없음 —
    //   사유는 pretooluse-core.js planScaleBlock 주석).
    {
      // ⚠ try 는 이 절 **전체**를 감싼다. 3회차까지는 planScaleBlock 호출만 감쌌는데, 그 아래
      //   승인 확인·차단문 조립에서 던지면 파일 맨 끝 바깥 catch 로 가 유인 모드에서 **아무 말 없이
      //   exit 0** 이었다 — 바로 이 절이 막으려던 그 경로다(4회차 low). deny 는 process.exit 이라
      //   try 안에서도 그대로 빠져나간다.
      try {
      // ⚠ 트랜스크립트는 여기서 **읽지 않는다.** 3회차에 기계 회차 계수를 먹이려고 이 자리에서
      //   무조건 읽었는데, §1.6은 모든 도구 호출에서 도는 자리라 `git status` 한 번에도 세션 기록
      //   전체(수천 레코드)를 파싱했다. needle 조기 탈출은 "plan-validator"가 차근 세션에 늘 있어
      //   안 걸린다. 긴 세션에서 훅 timeout 을 넘기면 **하드 차단 전부가 조용히 꺼진다**.
      //   승인 확인용 읽기는 아래에서 **차단이 실제로 걸렸을 때만** 한다.
        const cwdBase = input.cwd || process.cwd();
        const hits = planScaleBlock(name, ti, {
          // `~/…` 는 셸이 아니라 우리가 편다 — path.resolve 는 `<cwd>/~/…` 로 만들어 읽기가 실패하고,
          //   실패는 후보 탈락이라 **가드가 조용히 꺼진다**(3회차 low · 한글 경로와 같은 실패 종류).
          readFile: (rel) => fs.readFileSync(
            /^~\//.test(rel) ? path.join(os.homedir(), rel.slice(2)) : path.resolve(cwdBase, rel), "utf8"),
        });
        // 승인 키·형식 안내는 **사람만** 쓸 수 있다. 무인과 서브에이전트는 그 화면을 못 띄우므로
        //   켤 수 없는 스위치를 안내하지 않는다(왕복만 늘린다 — 이 파일 위쪽 배포 문구의 실측 교훈).
        const humanCanApprove = !UNATTENDED && !IS_SUBAGENT;
        if (hits && hits.length) {
          const approvals = humanCanApprove
            ? (readTranscriptIfMentions(input.transcript_path, "chageun-big-plan:") || []) : [];
          for (const hit of hits) {
            const verdict = humanCanApprove ? approvedBigPlan(approvals, hit.detail) : { approved: false };
            if (verdict.approved) continue;
            // 승인 질문은 **있었는데** 인정 못 한 경우를 구분해 알려준다. 같은 차단문만 다시 내면
            //   무엇이 틀렸는지 알 길이 없어 같은 실패를 반복한다(2회차 high).
            //   ⚠ "형식 오류"와 "사용자가 안 눌렀다"를 갈라야 한다 — 사용자가 첫 번째(거절)를 눌렀는데
            //   형식 오류라고 안내하면 모델이 같은 질문을 다시 띄운다. 사람의 "아니오"가 기계 오류로
            //   포장돼 재촉으로 바뀐다(3회차 medium).
            const tried = humanCanApprove && approvals.some((r) => {
              const c2 = (r && (r.message || r).content) || [];   // 괄호 위치 = 코어와 동일(null 안전)
              return Array.isArray(c2) && c2.some((b) => b && b.type === "tool_use"
                && b.name === "AskUserQuestion" && JSON.stringify(b.input || {}).includes(hit.detail));
            });
            const why = !tried ? ""
              : verdict.wellFormed
                ? " ⚠ 이 키가 든 승인 질문은 형식이 맞는데 **두 번째 선택지가 눌리지 않았습니다** —"
                  + " 사용자가 거절했거나 아직 답하지 않은 것입니다. **거절이면 다시 묻지 말고 일을 쪼개세요.**"
                : " ⚠ 이 키가 든 승인 질문은 찾았지만 **형식이 안 맞아 인정되지 않았습니다** —"
                  + " 차단문의 형식 요건을 확인하세요.";
            return deny(hit.key, UNATTENDED,
              humanCanApprove ? hit.detail + " · " + hit.measured + why : hit.measured);
          }
        }
      } catch (e) {
        // 무인은 이 파일의 관례대로 **fail-closed** — 판정 불확실 = park(바깥 catch와 같은 원칙).
        //   사람이 없는 자리에서 "큰 계획은 무조건 멈춤"이 조용히 꺼지면 안 된다(2회차 medium).
        if (UNATTENDED) return deny("u-error", true);
        // ⚠ 유인 모드는 exit 0 으로 통과시킨다. 그런데 이 훅 계약에서 **stderr 가 Claude 에게 가는 길은
        //   exit 2 뿐**이라(이 파일 deny 주석), stderr 한 줄만 남기면 "가드가 꺼졌다"는 사실이
        //   아무에게도 안 닿는다 — 이 절이 막으려던 상태 그대로다(5회차 medium). 리마인더와 같은
        //   stdout 통로로 보낸다. stderr 는 사람이 훅을 직접 돌릴 때를 위해 함께 남긴다.
        const msg = "[chageun] 계획 규모 가드가 판정에 실패해 이번 호출은 통과시킵니다: "
          + (e && e.message ? e.message : e);
        process.stderr.write(msg + "\n");
        try {
          process.stdout.write(JSON.stringify({ hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: msg + " — 큰 계획서가 검사 없이 통과했을 수 있습니다. 사용자에게 알리세요.",
          } }));
          reminderEmitted = true;
        } catch (_) { /* 진단 실패가 차단 사유가 되지는 않는다 */ }
      }
    }

    // 1.7) 서브에이전트의 게이트 스폰 차단(v0.64.0 H-2). 재료는 1.5와 같지만(Task/Agent + subagent_type)
    //   **자리는 계획 규모 가드(1.6) 뒤**다. 앞에 두면 서브에이전트의 plan-validator 호출이 여기서
    //   먼저 끊겨 1.6 의 서브에이전트 갈래(`humanCanApprove` 의 `!IS_SUBAGENT` · REASONS_SUBAGENT의
    //   "plan-size")가 통째로 도달 불가가 된다 — 그 층은 이 차단이 나중에 느슨해질 때를 위한 백스톱이라
    //   살려 둔다. 큰 계획을 든 호출은 1.6 이 이미 더 자세히(잰 줄 수까지) 세우고, 나머지 게이트 호출을
    //   여기서 세운다. 둘 다 "멈추고 본 세션에 BLOCKED 로 올려라"로 끝나 방향이 같다.
    //   탈출구 없음 — 켤 수 있는 사람이 이 자리에 없고(서브에이전트는 세션 환경변수를 못 만든다),
    //   열어야 할 정당한 경우는 "게이트는 본 세션이 띄운다"로 이미 덮인다.
    //   deny 의 두 번째 인자가 **항상 false** 인 이유는 0-pre(ra-*)와 같다: 이 문구는 무인이냐가 아니라
    //   서브에이전트라는 자리에서 나온 것이라, 무인 park 문구로 바꾸면 무엇이 왜 막혔는지가 사라진다.
    //   v0.65.0 F-29: 이 판정이 사유를 **두 가지**로 낸다(게이트 스폰 · 불투명 통로). 돌려받은 키를
    //   그대로 쓴다 — 예전처럼 키를 여기 박아 두면 새 사유를 더해도 문구가 안 갈려서, 막힌 쪽은
    //   무엇에 막혔는지 모른 채 엉뚱한 회복(게이트를 안 띄우면 되겠지)을 시도한다.
    {
      const sgs = subagentGateSpawn(input.agent_type, name, ti);
      if (sgs) return deny(sgs, false);
    }

    // 2) 무인 전용 추가 차단(push·배포프리뷰·DB쓰기·설치·경로·PR).
    //    v0.65.0: **옛 집합만** — "새로 도달한 차단"이 사는 자리가 여기다(u-mcp-write 등).
    //    표본 쌍으로 재는 이유: `mcp__…__create_branch` 는 옛 매처에 부분일치하고
    //    `mcp__…__create_file` 은 안 한다. **같은 규칙·다른 도달 여부**라, 예외가 규칙 단위가 아니라
    //    **도달 단위**로 잡혔다는 증거가 된다(무인 (가)·(나) 칸).
    if (UNATTENDED_SCOPED) {
      if (isPrCreate(name, ti)) return deny("u-pr", true);
      const uhit = unattendedBlock(name, ti, { worktreeRoot: ctlRoot(), criteriaPath: process.env.CHAGEUN_CRITERIA_FILE });
      if (uhit) return deny(uhit, true);
    }

    // 3) 게이트 생략 감지(P3: git push 포함 — 무인은 위 2)의 u-push가 선행 차단이라 유인 전용 확장):
    //    무인 모드는 SKIP 탈출구(CHAGEUN_SKIP_GATE_CHECK)를 무시.
    if (isPrCreate(name, ti) || isPush(name, ti)) {
      // v0.64.0 H-2: 서브에이전트는 **트랜스크립트와 무관하게 항상** 막는다. 전에는 "자기 기록에
      //   pr-reviewer 흔적이 없어서" 막혔는데, 그건 조건이라 흔적이 생기는 순간 풀린다(스스로 게이트를
      //   띄우거나, 게이트가 자기 기록에 남는 경로가 생기거나). 이 자리 문구는 이미 "push 와 PR 은 본
      //   세션이 합니다"라는 조건 없는 단정이니 기계도 조건 없이 만든다.
      //   사람용 탈출구(CHAGEUN_SKIP_GATE_CHECK)보다 앞에 둔다 — 그 스위치는 "게이트 검사를 건너뛴다"는
      //   뜻이지 "push 를 뒤에서 돌게 한다"는 뜻이 아니고, 사람은 본 세션에서 그대로 push 할 수 있다.
      //   v0.64.0 리뷰 2회차가 여기에 전용 회복 스위치(CHAGEUN_ALLOW_SUBAGENT_PUSH)를 넣었고,
      //   **3회차가 도로 뺐다.** 스위치를 켠 세션에서는 이 자리가 아래 신선도 검사로 떨어지는데,
      //   그 검사(prReviewerRan)는 게이트 호출이 **실제로 실행됐는지**(tool_result 의 is_error)를 안 본다.
      //   PreToolUse 가 막은 호출도 트랜스크립트에는 tool_use 로 남는다. 그래서 스위치를 켠 세션에서
      //   서브에이전트가 (a) 코드를 고치고 (b) 게이트를 부르려다 1.7 에 막히고 (c) 그 막힌 시도가
      //   "리뷰 흔적"이 되어 (d) push 가 통과한다 — 이 절이 막으려던 바로 그 사고가 되살아난다.
      //   회복 경로는 스위치가 아니라 **사람**이다(문구 끝 안내: 본 세션인데 이게 떴으면 사람에게 알린다).
      //   다시 넣으려면 hasPrReviewer 가 is_error 를 보게 하는 일이 **먼저**다.
      if (IS_SUBAGENT) return deny("gate-skip", UNATTENDED);
      if (UNATTENDED || process.env.CHAGEUN_SKIP_GATE_CHECK !== "1") {
        if (!prReviewerRan(input.transcript_path)) return deny("gate-skip", UNATTENDED);
      }
      // SKIP_GATE=1(유인)이면 게이트 검사 생략.
    }

    // 4.6) 색 하드코딩 백스톱(hard block, Claude 전용). docs/design-system.md 있는 프로젝트에서만.
    //    P3(soft 리마인더)와 별개 채널 = 기계 강제층: raw 색이 새 코드에 박히는 순간 그 편집을 차단(exit 2).
    //    검출은 tool_input의 content/new_string만(제약: 트리 스캔 없음). Edit/MultiEdit는 old엔 없고 new에
    //    생긴 색 토큰만(브라운필드 오탐 방지). Write는 신규 파일일 때만 검사(기존 파일 통짜 덮어쓰기는 v1 미차단
    //    = 정직한 열린 구멍 — old를 안 읽어 added 판정 불가). exit 2는 stderr 채널이라 §4 stdout 리마인더와
    //    충돌 없음(블록 시 리마인더 도달 전 종료). 무인·유인 모두 발동(색은 안전-park 사유는 아니나 회복
    //    가능+watchdog 바운드). 이 백스톱은 이 래퍼에만 배선. 자체 try/catch로 격리.
    if (EDIT_RE.test(String(name || "")) && isDesignScanTarget(ti.file_path || ti.notebook_path)
        && process.env.CHAGEUN_SKIP_DESIGN_LINT !== "1") {
      try {
        const cwd = input.cwd || process.cwd();
        const docText = readDesignDoc(cwd);
        if (docText != null) {
          const allow = parseAllowColors(docText);
          let viol = violationsForEdit(name, ti, allow);
          if (viol === null && String(name || "") === "Write") {
            // Write: old_string 없음 → 신규 파일(!existsSync)만 content 전체가 '새 색'으로 확실. 기존 파일은 skip.
            //   경로는 readDesignDoc과 같은 cwd 기준으로 resolve(상대경로 오판 방지 — 둘의 기준 통일).
            const abs = ti.file_path ? path.resolve(cwd, ti.file_path) : null;
            viol = (abs && !fs.existsSync(abs)) ? scanColors(ti.content, allow) : [];
          }
          if (viol && viol.length) {
            const tokens = [...new Set(viol.map((v) => v.token))].slice(0, 8).join(", ");
            return deny("design-color", false, tokens);
          }
        }
      } catch (_) { /* fail-open — 백스톱 오류가 정상 작업을 막지 않는다 */ }
    }

    // 4.8) 공용 component 경계(hard block, Claude 전용): 색 검사 뒤, soft 리마인더 전에 실행한다.
    // 색 정책의 기존 우회는 그대로 두되, component 경계는 어떤 lint ignore나 env로도 우회하지 않는다.
    if (COMPONENT_EDIT_RE.test(String(name || ""))) {
      let componentEntries;
      try { componentEntries = runComponentBoundaryChannel(input, input); }
      catch (error) { componentEntries = [boundaryIssue("component-boundary-error", error.message)]; }
      if (componentEntries.length) {
        const detail = [...new Set(componentEntries.map((entry) => `${entry.code}${entry.detail ? `:${entry.detail}` : ""}`))]
          .slice(0, 8).join(", ");
        return deny("component-boundary", false, detail);
      }
    }

    // 4) P1 리마인더(soft): plan 문서를 쓰고 plan-validator 없이 첫 코드 수정 시작 →
    //    차단 없이 리마인더 한 줄 주입(additionalContext). 자체 try/catch — 리마인더는 어떤
    //    경우에도 차단·park 사유가 되지 않는다(무인 fail-closed catch로 새지 않게).
    if (EDIT_RE.test(String(name || ""))) {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "plan");
        if (objs && planReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: 이번 세션에 plan 문서를 작성했는데 plan-validator 게이트를 아직 거치지 않았습니다. 규칙상 구현 시작 직전 plan-validator 호출이 필수입니다(코어 '검증 게이트'). 지금 게이트를 먼저 실행하세요.",
            },
          }));
          reminderEmitted = true;
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }

    // 4.7) 디자인 레지스트리 조회 리마인더(soft, Claude 전용): UI 파일 첫 수정인데 이번 세션에
    //    design-system 레지스트리 조회 흔적이 없으면 1회 주입. P1이 이미 주입했으면 침묵(JSON 단일 write).
    //    파싱 전 isUiTarget으로 걸러 비UI 편집은 전체 파싱 안 함(비용). 자체 try/catch로 격리(무인 fail-closed로 안 샘).
    if (!reminderEmitted && EDIT_RE.test(String(name || "")) && isUiTarget(ti.file_path || ti.notebook_path)) {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "");
        if (objs && designRegistryReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: UI 파일을 만들기 전 design-system 레지스트리(디자인 규칙·부품+변형 슬롯)를 아직 확인하지 않았습니다. 규칙상 새 화면·컴포넌트는 기존 토큰·변형을 재사용해야 합니다(코어 '디자인 시스템'). design-system 스킬을 로드하거나 docs/design-system.md를 확인해, 페이지 폭·모달 등은 새로 만들지 말고 기존 것을 쓰세요(규칙 파일이 없으면 시드).",
            },
          }));
          reminderEmitted = true;
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }

    // 4.5) routing 리마인더(soft, batch6): 구현 에이전트 첫 위임 직전 chageun:routing
    //    스킬 미로드 → 리마인더 1회 주입. P1과 동일하게 자체 try/catch로 격리(예외가 무인
    //    fail-closed catch로 새어 park가 되지 않게 — plan-validator medium 반영). needle 조기
    //    탈출은 못 쓴다(부재가 신호) — Agent 스폰은 드물어 전체 파싱 비용 수용.
    //    v0.65.0: 판정을 spawnIntent 로 옮겼다. **`readable` 일 때만** 이 절에 들어간다 —
    //    `spawnIntent !== null` 로 적으면 `Workflow` 호출에서도 여기 들어와 트랜스크립트 전체를
    //    파싱한다(실측 400ms대). 불투명 통로는 무엇을 띄우는지 못 읽으니 라우팅 판정이 성립하지 않는다.
    if (!reminderEmitted && spawn && spawn.kind === "readable") {
      try {
        const objs = readTranscriptIfMentions(input.transcript_path, "");
        if (objs && routingReminderNeeded(objs, name, ti)) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "차근 리마인더: 구현 에이전트에 위임하려는데 이번 세션에 chageun:routing 스킬을 아직 로드하지 않았습니다. 규칙상 서브에이전트 위임(병렬 포함) 전 로드가 필수입니다(코어 '모델·실행 라우팅'). 지금 Skill 도구로 로드해 라우팅 표·병렬 위임 규칙을 확인한 뒤 위임하세요.",
            },
          }));
        }
      } catch (_) { /* 리마인더 실패는 조용히 무시 */ }
    }
  } catch (_) {
    // 무인: 판정 중 예외 = 불확실 = 안전측(park). 유인: 기존대로 fail-open(사람이 백스톱).
    // 🛑 v0.65.0: 여기서 조건을 **뒤집어** 적는다. 그냥 `옛 집합.test(name)` 으로 쓰면
    //   **fail-closed 가 fail-open 으로 뒤집힌다** — 이 catch 가 잡는 **대표 경우가 입력 JSON
    //   파싱 실패**이고, 그때는 도구 이름이 아예 없다. 빈 이름은 옛 집합에 안 맞아 통과해 버리는데
    //   **지금은 park 하는 자리**다. 규칙 한 문장: **"도구 이름을 못 읽었으면 옛 집합에 있는 것으로 본다."**
    //   검사 = test/hook-net.test.mjs 의 무인 (라).
    if (UNATTENDED && (!name || LEGACY_UNATTENDED_SCOPE.test(String(name)))) {
      process.stderr.write(reasonForUnattended("u-error")); process.exit(2);
    }
  }
  process.exit(0);
});
