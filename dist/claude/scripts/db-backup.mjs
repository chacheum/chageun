// 컨테이너 축은 아직 안 잰다 - 1b-2 의 docker inspect 가 잰다.
// backup.mode 가 none 이면 그 말이 참인지도 아직 안 잰다 - 1b-2 의 docker exec which pg_dump 가 잰다.
//
// 무인 백업 설정의 **순수부**. 이 파일은 도커를 한 번도 안 부른다 - 값을 넣으면 판정만 돌려준다.
// 실제로 덤프를 뜨는 일·런처 배선·자동 삭제는 1b-2 가 한다.
//
// 🛑 설계 근거(종료코드를 혼자 믿지 않는다): psql 이 오류 221건을 내고도 종료코드 0 을 냈다(2026-08-19 실측).
//    그래서 뜨는 쪽도 같은 잣대로 본다 - verdict 는 종료코드·신호·바이트 수·완료 표식을 **모두** 보고
//    통과 조건 다섯을 전부 만족할 때만 통과시킨다(나머지는 무조건 거부 = fail-closed).

/** 백업 도구 허용목록. 🛑 재 본 것만 연다 - 안 재 본 도구를 열면 "성공"이라 뜨는 빈 파일이 난다. */
export const TOOLS = {
  pg_dump: {
    restore: "psql",
    // 🛑 되살릴 때 ON_ERROR_STOP 이 없으면 psql 이 오류를 쏟고도 종료코드 0 을 낸다(위 실측).
    restoreFlags: ["-v", "ON_ERROR_STOP=1"],
    doneMarker: "-- PostgreSQL database dump complete",
    // 🛑 사람이 준 글자를 인자로 그대로 안 쓴다 - 코드가 조립한다.
    buildArgs: ({ user, database }) => ["-U", user, "-d", database],
  },
};

export const DEFAULT_TIMEOUT_MS = 600000; // 10분
const MIN_TIMEOUT_MS = 60000;             // 1분
const MAX_TIMEOUT_MS = 3600000;           // 60분

// 🛑 이름 무늬: `-` 로 시작하면 docker exec 이 그 글자를 **옵션으로** 먹는다. 자유 인자 칸은 아예 없다.
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const isName = (v) => typeof v === "string" && NAME_RE.test(v);
const filled = (v) => typeof v === "string" && v.trim() !== "";
// 칸이 **아예 비었나**(없음·null·빈 글자·공백만). !filled 와 다르다 - 값이 있는데 모양이 틀린 것
// (숫자·참거짓 등)은 여기서 "비었다"고 하지 않고 3-5 무늬 검사가 따로 잡는다(사유가 겹치지 않게).
const missing = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// 거부 사유 문장의 **단일 원본**(계획서 §3). 검사가 이 글자를 문다 - 문장을 고치면 검사가 먼저 빨개진다.
const MSG = {
  // 🛑 네 토막으로 줄바꿈한다(무엇이 문제 / 이렇게 적으세요 / 비밀번호는 안 적어도 된다 /
  //    DB 가 정말 없다면). 한 줄로 300자를 쏟으면 좁은 터미널에서 뭉개져, 정답을 알려주려고
  //    길게 적은 문장이 오히려 안 읽힌다.
  //    🛑 검사가 무는 낱말("백업 설정이 없습니다"·"이 모양으로 적으세요")은 줄바꿈을 걸치면 안 된다.
  // 🛑 견본에 계정·비밀번호를 넣지 않는다(안내가 시키는 대로 적으면 비밀번호가 사용자 저장소의
  //    `.chageun/unattended.json` 에 평문으로 남고 다음 커밋에 이력으로 들어간다 - 지워도 이력에 남는다).
  //    이 판이 dbUrl 에서 읽는 것은 **DB 이름 하나뿐**이라 애초에 필요가 없다(dbNameFromUrl).
  //    🛑 판정은 안 바꾼다 - 이미 계정·비밀번호를 적어 둔 주소도 그대로 통과한다(안내만 바꾼 것이다).
  noBackup: "백업 설정이 없습니다(`.chageun/unattended.json` 의 backup 칸).\n" +
    "이 모양으로 적으세요: " +
    '`{"sandbox":{"dbUrl":"postgres://localhost:5432/<DB이름>"},"backup":{"mode":"docker-exec",' +
    '"container":"<DB 컨테이너 이름>","tool":"pg_dump","user":"postgres","database":"<DB이름>"}}`\n' +
    "비밀번호는 이 파일에 안 적어도 됩니다(여기서는 DB 이름만 읽습니다).\n" +
    'DB 가 정말 없는 프로젝트면 backup 을 `{"mode":"none","why":"<확인한 이유>"}` 로 적으세요.',
  badMode: "backup.mode 는 docker-exec 또는 none 만 됩니다",
  noneWhy: "backup.mode 가 none 이면 why 에 사람이 확인한 이유를 적으세요",
  noneConflict: "sandbox.dbUrl 을 적고 backup 을 none 으로 둘 수 없습니다" +
    "(DB 가 있다는 선언과 없다는 선언이 부딪힙니다)",
  noContainer: "backup.container 에 DB 컨테이너 이름을 적으세요",
  noUser: "backup.user 에 DB 계정 이름을 적으세요(도커 안에서 백업을 돌릴 계정)",
  noDatabase: "backup.database 에 백업할 DB 이름을 적으세요",
  // 🛑 칸을 **빠뜨린** 사람과 **안 되는 도구를 적은** 사람은 다른 말을 들어야 한다 -
  //    앞사람은 한 칸만 채우면 되는데 "지원 안 합니다"를 읽으면 그냥 포기한다.
  noTool: "backup.tool 에 pg_dump 라고 적으세요",
  onlyPg: "지금 판은 도커 컨테이너 안의 Postgres(pg_dump)만 지원합니다. " +
    "다른 데이터베이스나 도커 밖 Postgres 는 아직 무인을 켤 수 없습니다(다음 판)",
  badName: "container·user·database 는 영문·숫자·밑줄로 시작하고 마침표·붙임표·밑줄만 쓸 수 있습니다",
  noDbUrl: "backup.mode 가 docker-exec 이면 sandbox.dbUrl 에 밤이 쓸 DB 주소를 적으세요" +
    "(백업 대상이 맞는지 대조합니다)",
  dbMismatch: "백업할 DB 이름과 밤이 쓸 DB 이름이 다릅니다",
  // 🛑 noBackup 과 같은 이유로 견본에서 계정·비밀번호를 뺐다 - 안 써도 되는 값을 적으라고 시키면
  //    그 값이 저장소 이력에 남는다. 계정·비밀번호를 붙여 적은 주소도 판정은 그대로 통과한다.
  badDbUrl: "sandbox.dbUrl 에서 DB 이름을 못 읽었습니다. " +
    "`postgres://<호스트>:<포트>/<DB이름>` 모양으로 적으세요" +
    "(계정·비밀번호는 선택입니다 - 여기서는 DB 이름만 읽습니다)",
  containerMismatch: "backup.container 와 sandbox.container 가 다릅니다. 정말 다르면 mismatchWhy 에 이유를 적으세요",
  badTimeout: "backup.timeoutMs 는 1분에서 60분 사이여야 합니다",
};

/**
 * sandbox.dbUrl 에서 **DB 이름만** 뽑는다.
 * 🛑 어떤 입력에도 예외를 밖으로 안 던진다 - 이 함수가 던지면 무인이 판정도 못 하고 그 자리에서 죽는다.
 * 🛑 돌려주는 것은 DB 이름 하나뿐이다 - 원본 주소에는 비밀번호가 들어 있어 어디에도 안 남긴다.
 * 못 얻으면 null(주소가 깨졌거나 이름 칸이 비었을 때). null 은 조용한 통과가 아니라 §3 3-7b 사유가 된다.
 */
export function dbNameFromUrl(url) {
  let path;
  try {
    path = new URL(String(url)).pathname; // "/mydb" · "/mydb/" · "/" (쿼리스트링은 pathname 에 안 들어온다)
  } catch (_) {
    return null;
  }
  const name = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return name === "" ? null : name;
}

/**
 * dbUrl 에서 **호스트 이름만** 뽑는다 - 계정·비밀번호·포트·경로는 어디에도 안 담는다.
 * 🛑 dbNameFromUrl 과 같은 계약이다: 어떤 입력에도 예외를 밖으로 안 던지고, 못 읽으면 null.
 * 왜 있나: 거부 문구에 주소를 통째로 찍으면 그 안의 **비밀번호가 화면·로그에 그대로 남는다**.
 */
export function hostFromUrl(url) {
  let host;
  try {
    host = new URL(String(url)).hostname; // hostname 은 계정·비밀번호·포트를 안 담는다
  } catch (_) {
    return null;
  }
  return host === "" ? null : host;
}

/**
 * 설정 파일(.chageun/unattended.json) 모양·짝맞춤을 잰다. 🛑 도커를 안 부른다.
 * 거부 사유 배열을 돌려준다(빈 배열 = 통과).
 */
export function backupReasons(config) {
  const reasons = [];
  const cfg = (config && typeof config === "object") ? config : {};
  const sandbox = (cfg.sandbox && typeof cfg.sandbox === "object") ? cfg.sandbox : {};
  const backup = cfg.backup;

  // 3-1: 칸 자체가 없으면 여기서 끝낸다 - 뒤 규칙을 더 울려 봐야 "무엇을 적어야 하나"만 흐려진다.
  if (!backup || typeof backup !== "object") return [MSG.noBackup];
  // 3-2: 오타가 조용히 통과하면 안 된다. 모드를 모르면 뒤 규칙의 뜻도 안 정해지므로 여기서 끝낸다.
  if (backup.mode !== "docker-exec" && backup.mode !== "none") return [MSG.badMode];

  // 3-5: **값이 있을 때만** 무늬를 잰다(필수 여부는 3-4 가 따로 정한다).
  // 🛑 건너뛰기 잣대는 아래 3-4 가 쓰는 것과 **같은 missing()** 이어야 한다. `v === ""` 만 보면
  //    공백만 든 값("   ")이 3-4 의 "안 적었다"와 3-5 의 "무늬가 틀렸다"에 **둘 다** 걸려,
  //    사유가 겹치지 않게 하려던 위 규약이 그 자리에서 깨진다.
  for (const k of ["container", "user", "database"]) {
    const v = backup[k];
    if (missing(v)) continue;
    if (!isName(v)) { reasons.push(MSG.badName); break; }
  }

  if (backup.mode === "none") {
    // 3-3
    if (!filled(backup.why)) reasons.push(MSG.noneWhy);
    if (sandbox.dbUrl) reasons.push(MSG.noneConflict);
  } else {
    // 3-4: 네 칸이 다 있어야 한다. 🛑 user·database 는 나중에 docker 인자가 되는 자리인데,
    //      "값이 있을 때만" 재는 3-5 무늬 검사는 **안 적은 칸**을 그냥 건너뛴다(존재는 여기서 잰다).
    if (missing(backup.container)) reasons.push(MSG.noContainer);
    if (missing(backup.user)) reasons.push(MSG.noUser);
    if (missing(backup.database)) reasons.push(MSG.noDatabase);
    if (missing(backup.tool)) reasons.push(MSG.noTool);
    else if (backup.tool !== "pg_dump") reasons.push(MSG.onlyPg);
    // 3-6: dbUrl 이 있어야 3-7 대조가 **항상** 돈다(조건부 대조는 2회차 blocker 였다).
    if (!sandbox.dbUrl) reasons.push(MSG.noDbUrl);
    else {
      const name = dbNameFromUrl(sandbox.dbUrl);
      // 3-7b: 못 읽었으면 건너뛰지 않고 사유를 낸다(조용한 통과 금지).
      if (name === null) reasons.push(MSG.badDbUrl);
      // 3-7: 어긋나면 백업은 성공하고 아침 되살리기가 손대지도 않은 DB 를 지운다.
      //      🛑 database 를 **안 적은** 사람에게 "다릅니다"라고 말하지 않는다 - 그 갈래의 사유는
      //      noDatabase 하나뿐이다(두 사유가 함께 나오면 무엇을 고쳐야 할지 흐려진다).
      else if (!missing(backup.database) && name !== backup.database) reasons.push(MSG.dbMismatch);
    }
  }

  // 3-8: 두 칸이 **둘 다 있고** 다를 때만. 막지 않고 사람 사유를 남기게 한다.
  if (backup.container && sandbox.container && backup.container !== sandbox.container
    && !filled(backup.mismatchWhy)) reasons.push(MSG.containerMismatch);

  // 3-9: 🛑 범위만 재면 글자 "600000" 이 숫자로 바뀌어 통과하고 true 는 1 로 읽힌다 - 형까지 본다.
  const t = backup.timeoutMs;
  if (t !== undefined && t !== null) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < MIN_TIMEOUT_MS || t > MAX_TIMEOUT_MS) {
      reasons.push(MSG.badTimeout);
    }
  }
  return reasons;
}

/**
 * docker 에 넘길 인자를 **코드가** 조립한다. 🛑 사람이 준 인자 배열은 쓰지 않는다.
 * 부르기 전에 backupReasons 가 초록이어야 하지만 **그것에 기대지 않는다** - 도구 허용목록도
 * 이름 무늬도 여기서 다시 재고, 어긋나면 던진다(주석이 아니라 기계로 막는다).
 */
export function dumpArgv(config) {
  const backup = ((config && config.backup) || {});
  // 🛑 `TOOLS[backup.tool]` 이 truthy 인지만 보면 안 된다 - `constructor`·`toString` 같은
  //    **프로토타입 키**가 truthy 라 허용목록을 그대로 지나가고, 그 뒤 알아볼 수 없는 내부 오류로
  //    죽는다(결과는 여전히 거부지만 사람이 읽고 고칠 수 있는 말이 아니다). 제 칸에 있는 키만 연다.
  if (!Object.prototype.hasOwnProperty.call(TOOLS, backup.tool)) {
    throw new Error(`허용되지 않은 백업 도구: ${backup.tool}`);
  }
  const spec = TOOLS[backup.tool];
  // 🛑 이름이 `-` 로 시작하면 docker 가 그것을 **옵션으로** 먹는다. 다른 경로(1b-2)가 판정을
  //    안 거치고 여기로 들어올 수 있으므로 3-5 와 같은 잣대를 이 자리에서 다시 잰다.
  //    🛑 사유에 값을 안 찍는다 - 그 값 자체가 명령 조각일 수 있다.
  for (const k of ["container", "user", "database"]) {
    if (!isName(backup[k])) throw new Error(`백업 설정 이름이 규격 밖이다: backup.${k}`);
  }
  return ["exec", backup.container, backup.tool, ...spec.buildArgs(backup)];
}

/**
 * 뜬 결과를 본다. 🛑 통과 조건 다섯을 **모두** 만족할 때만 ok 이고 나머지는 무조건 거부(fail-closed).
 * 사유 표는 사람에게 무엇을 고칠지 알려줄 뿐 **판정을 안 바꾼다** - 사유를 못 붙인 모양도 거부다.
 */
export function verdict({ status, signal, error, bytes, tail, timeoutMs } = {}) {
  const marker = TOOLS.pg_dump.doneMarker; // 지금 허용된 도구가 하나뿐이다(1b-2 에서 tool 별로 갈린다).
  const size = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  const text = typeof tail === "string" ? tail : "";
  const ok = error == null && signal == null && status === 0 && size > 0 && text.includes(marker);
  if (ok) return { ok: true, reason: "" };
  return { ok: false, reason: failReason({ status, signal, error, size, text, timeoutMs, marker }) };
}

function failReason({ status, signal, error, size, text, timeoutMs, marker }) {
  if (error && error.code === "ENOENT") return "도커를 못 찾았다(docker 가 깔려 있는지 확인)";
  // 🛑 신호를 뭉뚱그려 "시간 초과"라고 적으면, 메모리 부족으로 커널이 죽인(SIGKILL) 사람이
  //    timeoutMs 만 계속 늘리며 원인을 영영 못 찾는다. **우리가 보낸 신호일 때만** 시간 초과다.
  // 🛑 그런데 spawnSync 의 timeout 은 `error.code = "ETIMEDOUT"` 과 `signal = "SIGTERM"` 을
  //    **함께** 채운다(2026-08-20 실측: spawnSync("sleep",["5"],{timeout:300})). 그래서 `if (error)`
  //    를 먼저 반환하면 이 갈래에 **영영 안 닿고**, 진짜 시간 초과가 "도커를 못 돌렸다"로 나와
  //    사람이 권한·경로를 뒤진다. 두 신호 중 하나만 봐도 시간 초과로 받는다.
  //    (SIGKILL 갈래는 아래에 그대로 살아 있다 - 우리가 안 보낸 신호는 여기서 안 잡힌다.)
  const timedOut = (error && error.code === "ETIMEDOUT") || (error == null && signal === "SIGTERM");
  if (timedOut) {
    const ms = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    // 🛑 "10분" 을 고정으로 적으면 손잡이를 30분으로 준 사람이 원인을 못 찾는다 - 적용된 값을 적는다.
    return `시간 초과: ${Math.round(ms / 60000)}분 안에 안 끝났다(backup.timeoutMs 로 늘릴 수 있다)`;
  }
  if (error) return "도커를 못 돌렸다(권한·경로 확인)";
  if (signal != null) return `밖에서 강제 종료됐다(신호 ${signal}) - 메모리가 모자라 커널이 죽였을 수 있다`;
  // 🛑 이 사유에는 pg_dump 가 박혀 있다 - 1b-2 가 도구를 늘리면 이 줄도 tool 이름을 받아 적어야 한다.
  if (status === 127) return "그 이미지에 pg_dump 도구가 없다";
  if (size === 0) return "덤프가 한 바이트도 안 나왔다(컨테이너·계정 확인)";
  if (status !== 0) return "중간에 끊겼다(부분 덤프라 되살리기에 못 쓴다)";
  if (!text.includes(marker)) return "완료 표식이 없다(잘렸을 수 있다)";
  // 🛑 이 칸이 fail-closed 를 보증한다 - 위 어디에도 안 맞는데 통과 조건에 미달한 모양.
  return `알 수 없는 이유로 실패(종료코드 ${status})`;
}
