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

// 거부 사유 문장의 **단일 원본**(계획서 §3). 검사가 이 글자를 문다 - 문장을 고치면 검사가 먼저 빨개진다.
const MSG = {
  noBackup: "백업 설정이 없습니다. `.chageun/unattended.json` 에 이 모양으로 적으세요: " +
    '`{"sandbox":{"dbUrl":"postgres://…@localhost:5432/<DB이름>"},"backup":{"mode":"docker-exec",' +
    '"container":"<DB 컨테이너 이름>","tool":"pg_dump","user":"postgres","database":"<DB이름>"}}`' +
    ' (이 프로젝트에 DB 가 정말 없으면 backup 을 `{"mode":"none","why":"<확인한 이유>"}` 로)',
  badMode: "backup.mode 는 docker-exec 또는 none 만 됩니다",
  noneWhy: "backup.mode 가 none 이면 why 에 사람이 확인한 이유를 적으세요",
  noneConflict: "sandbox.dbUrl 을 적고 backup 을 none 으로 둘 수 없습니다" +
    "(DB 가 있다는 선언과 없다는 선언이 부딪힙니다)",
  noContainer: "backup.container 에 DB 컨테이너 이름을 적으세요",
  onlyPg: "지금 판은 도커 컨테이너 안의 Postgres(pg_dump)만 지원합니다. " +
    "다른 데이터베이스나 도커 밖 Postgres 는 아직 무인을 켤 수 없습니다(다음 판)",
  badName: "container·user·database 는 영문·숫자·밑줄로 시작하고 마침표·붙임표·밑줄만 쓸 수 있습니다",
  noDbUrl: "backup.mode 가 docker-exec 이면 sandbox.dbUrl 에 밤이 쓸 DB 주소를 적으세요" +
    "(백업 대상이 맞는지 대조합니다)",
  dbMismatch: "백업할 DB 이름과 밤이 쓸 DB 이름이 다릅니다",
  badDbUrl: "sandbox.dbUrl 에서 DB 이름을 못 읽었습니다. " +
    "`postgres://<계정>:<비밀번호>@<호스트>:<포트>/<DB이름>` 모양으로 적으세요",
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
  for (const k of ["container", "user", "database"]) {
    const v = backup[k];
    if (v === undefined || v === null || v === "") continue;
    if (!isName(v)) { reasons.push(MSG.badName); break; }
  }

  if (backup.mode === "none") {
    // 3-3
    if (!filled(backup.why)) reasons.push(MSG.noneWhy);
    if (sandbox.dbUrl) reasons.push(MSG.noneConflict);
  } else {
    // 3-4
    if (!backup.container) reasons.push(MSG.noContainer);
    if (backup.tool !== "pg_dump") reasons.push(MSG.onlyPg);
    // 3-6: dbUrl 이 있어야 3-7 대조가 **항상** 돈다(조건부 대조는 2회차 blocker 였다).
    if (!sandbox.dbUrl) reasons.push(MSG.noDbUrl);
    else {
      const name = dbNameFromUrl(sandbox.dbUrl);
      // 3-7b: 못 읽었으면 건너뛰지 않고 사유를 낸다(조용한 통과 금지).
      if (name === null) reasons.push(MSG.badDbUrl);
      // 3-7: 어긋나면 백업은 성공하고 아침 되살리기가 손대지도 않은 DB 를 지운다.
      else if (name !== backup.database) reasons.push(MSG.dbMismatch);
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
 * 부르기 전에 backupReasons 가 초록이어야 한다(허용목록 밖 도구면 여기서 던진다).
 */
export function dumpArgv(config) {
  const backup = ((config && config.backup) || {});
  const spec = TOOLS[backup.tool];
  if (!spec) throw new Error(`허용되지 않은 백업 도구: ${backup.tool}`);
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
  if (error) return "도커를 못 돌렸다(권한·경로 확인)";
  if (signal != null) {
    const ms = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    // 🛑 "10분" 을 고정으로 적으면 손잡이를 30분으로 준 사람이 원인을 못 찾는다 - 적용된 값을 적는다.
    return `시간 초과: ${Math.round(ms / 60000)}분 안에 안 끝났다(backup.timeoutMs 로 늘릴 수 있다)`;
  }
  if (status === 127) return "그 이미지에 pg_dump 도구가 없다";
  if (size === 0) return "덤프가 한 바이트도 안 나왔다(컨테이너·계정 확인)";
  if (status !== 0) return "중간에 끊겼다(부분 덤프라 되살리기에 못 쓴다)";
  if (!text.includes(marker)) return "완료 표식이 없다(잘렸을 수 있다)";
  // 🛑 이 칸이 fail-closed 를 보증한다 - 위 어디에도 안 맞는데 통과 조건에 미달한 모양.
  return `알 수 없는 이유로 실패(종료코드 ${status})`;
}
