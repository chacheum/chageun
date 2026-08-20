// test/unattended-1b1-config.test.mjs — 무인 백업 **설정**을 기계가 판정하는지 문다(1b-1판).
//
// 🛑 이 검사를 느슨하게 고치려면 계획서에 적고 사람 승인을 받는다.
//
// 🛑 무엇을 못 재나(정직 고지):
//   1. 실제 덤프를 한 벌도 안 뜬다. 도커를 한 번도 안 부른다 - 순수 함수에 값을 넣고 단언할 뿐이다.
//   2. 컨테이너 짝맞춤(backup.container 가 정말 sandbox.dbUrl 이 가리키는 그 DB 인가)은 안 잰다.
//      같은 이름의 DB 를 가진 다른 컨테이너를 적어도 여기서는 통과한다 - 1b-2 의 docker inspect 가 잰다.
//   3. backup.mode 가 "none" 이라는 말이 참인지도 안 잰다((가)5 참고) - 1b-2 의 docker exec which pg_dump 몫이다.
//   4. 런처가 실제로 백업을 부르는지도 안 잰다 - 이 판의 런처는 백업을 아예 안 부른다.
//
// 🛑 낱말 비교는 **대소문자를 구분하는 includes** 로만 한다. toLowerCase 나 /…/i 로 짜면
//    3-3a 의 "why 에" 가 3-8 의 "mismatchWhy 에" 에 걸려 엉뚱한 규칙을 재게 된다.
// 🛑 거부를 기대하는 칸은 **의도한 규칙 하나만 울도록 나머지 칸을 다 채우고** 사유 낱말까지 함께 문다.
//    판정(ok/거부)만 보면 허용목록·무늬 검사를 통째로 지워도 다른 규칙이 먼저 거부해 초록이 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { backupReasons, dumpArgv, verdict, dbNameFromUrl, hostFromUrl, TOOLS } from "../src/scripts/db-backup.mjs";
import { evaluate } from "../src/scripts/preflight.mjs";
import { tmpDir } from "./support-tmpdir.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const alive = () => true;
// 🛑 명백히 시험용인 글자만 쓴다(진짜처럼 보이는 비밀번호를 검사 파일에 적지 않는다).
//    아래 단언들은 실패 메시지에도 이 값을 안 찍는다 - 진짜/가짜를 가리는 일 자체가 누출 경로다.
const FAKE_PW = "pw-not-real-xyz";

// 기본 픽스처. 각 칸은 여기서 **한 칸만** 바꾼다(부르는 쪽마다 새 객체를 받아 서로 안 섞인다).
const OK = () => ({
  sandbox: { dbUrl: "postgres://localhost:5432/db" },
  backup: { mode: "docker-exec", container: "c", tool: "pg_dump", user: "postgres", database: "db" },
});

const rejects = (config, anchor, label) => {
  const rs = backupReasons(config);
  assert.ok(rs.length > 0, `${label}: 거부돼야 하는데 통과했다`);
  assert.ok(rs.some((x) => x.includes(anchor)),
    `${label}: 사유에 "${anchor}" 가 없다 — 실제 사유: ${rs.join(" | ") || "(없음)"}`);
};
const passes = (config, label) => {
  const rs = backupReasons(config);
  assert.deepEqual(rs, [], `${label}: 통과해야 하는데 거부됐다 — ${rs.join(" | ")}`);
};

// ───────────────────────── (가) 설정 판정 19칸 ─────────────────────────

test("(가)1 backup 칸이 없으면 거부하고, 무엇을 적어야 하는지 통째로 알려준다", () => {
  const c = { sandbox: { dbUrl: "postgres://localhost:5432/db" } };
  rejects(c, "백업 설정이 없습니다", "(가)1");
  // 🛑 부록 안내문이 아직 옛 모양이라, 이 문장이 사용자가 정답을 얻는 **유일한** 자리다.
  rejects(c, "이 모양으로 적으세요", "(가)1");
  const msg = backupReasons(c).join(" ");
  for (const key of ["sandbox", "dbUrl", "backup", "mode", "docker-exec", "container", "tool", "pg_dump", "user", "database", "none", "why"]) {
    assert.ok(msg.includes(key), `(가)1: 안내 문장에 필수 칸 이름 "${key}" 가 없다`);
  }
});

test("(가)2 mode 오타는 조용히 통과하지 않는다", () => {
  const c = OK(); c.backup.mode = "docker-exe";
  rejects(c, "backup.mode 는", "(가)2");
});

test('(가)3 dbUrl 을 적고 backup 을 none 으로 두면 거부(선언이 서로 부딪힌다)', () => {
  const c = { sandbox: OK().sandbox, backup: { mode: "none", why: "x" } };
  rejects(c, "부딪힙니다", "(가)3");
});

test("(가)4 mode 가 none 인데 why 가 없으면 거부", () => {
  rejects({ sandbox: { container: "c" }, backup: { mode: "none" } }, "none 이면 why 에", "(가)4");
});

test('(가)5 샌드박스를 컨테이너 이름으로만 적고 mode:none 이면 지금은 통과한다(열린 구멍)', () => {
  // 🛑 이 갈래는 "DB 없음"이 거짓말이어도 통과한다 - 막는 기계는 1b-2 의 docker exec which pg_dump 다.
  //    지금 닫으면 DB 가 정말 없는 프로젝트가 무인을 못 쓴다. 그래서 일부러 통과로 못박고 자백해 둔다.
  passes({ sandbox: { container: "c" }, backup: { mode: "none", why: "DB 없음" } }, "(가)5");
});

test("(가)6 docker-exec 인데 container 가 없으면 거부", () => {
  const c = OK(); delete c.backup.container;
  rejects(c, "DB 컨테이너 이름을", "(가)6");
});

test("(가)7 허용목록 밖 도구(bash)는 거부하고 '도커 안의 Postgres' 라는 조건까지 알려준다", () => {
  const c = OK(); c.backup.tool = "bash";
  rejects(c, "도커 컨테이너 안의", "(가)7");
});

test("(가)8 아직 안 재 본 DB 도구(mysqldump·sqlite3)도 거부", () => {
  for (const tool of ["mysqldump", "sqlite3"]) {
    const c = OK(); c.backup.tool = tool;
    rejects(c, "도커 컨테이너 안의", `(가)8 ${tool}`);
  }
});

test("(가)9 container 가 붙임표로 시작하면 거부(docker exec 이 옵션으로 먹는다)", () => {
  const c = OK(); c.backup.container = "--privileged";
  rejects(c, "밑줄로 시작하고", "(가)9");
});

test("(가)10 database·user 에 명령 조각을 넣으면 거부", () => {
  const a = OK(); a.backup.database = ".shell rm -rf /";
  rejects(a, "밑줄로 시작하고", "(가)10 database");
  const b = OK(); b.backup.user = "-h evil.example";
  rejects(b, "밑줄로 시작하고", "(가)10 user");
});

test("(가)11 docker-exec 인데 sandbox.dbUrl 이 없으면 거부(대조가 한 건도 안 돌게 된다)", () => {
  const c = OK(); c.sandbox = { container: "c" };
  rejects(c, "밤이 쓸 DB 주소를", "(가)11");
});

test("(가)12 백업할 DB 이름과 밤이 쓸 DB 이름이 다르면 거부", () => {
  const c = OK(); c.backup.database = "other";
  rejects(c, "밤이 쓸 DB 이름이 다릅니다", "(가)12");
});

test("(가)13 두 컨테이너 이름이 다른데 사유가 없으면 거부", () => {
  const c = OK();
  c.sandbox = { container: "a", dbUrl: "postgres://localhost:5432/db" };
  c.backup.container = "b";
  rejects(c, "mismatchWhy 에", "(가)13");
});

test("(가)14 두 컨테이너가 달라도 사람이 사유를 적었으면 통과", () => {
  const c = OK();
  c.sandbox = { container: "a", dbUrl: "postgres://localhost:5432/db" };
  c.backup.container = "b";
  c.backup.mismatchWhy = "DB 는 별도 컨테이너";
  passes(c, "(가)14");
});

test("(가)15 timeoutMs 는 형과 범위를 함께 잰다(글자·참거짓은 숫자로 안 읽는다)", () => {
  for (const bad of [30000, 7200000, "600000", true]) {
    const c = OK(); c.backup.timeoutMs = bad;
    rejects(c, "1분에서 60분", `(가)15 ${typeof bad} ${String(bad)}`);
  }
  const good = OK(); good.backup.timeoutMs = 900000;
  passes(good, "(가)15 900000");
  passes(OK(), "(가)15 칸 없음");
});

test("(가)16 dbUrl 에서 DB 이름을 못 읽으면 거부하고, 사유에 비밀번호를 안 남긴다", () => {
  for (const url of ["postgres://u:pw@localhost:5432/", "주소가 아닌 글자"]) {
    const c = OK(); c.sandbox = { dbUrl: url };
    rejects(c, "DB 이름을 못 읽었습니다", `(가)16 ${url}`);
    const joined = backupReasons(c).join(" ");
    assert.ok(!joined.includes("pw"), `(가)16: 사유에 비밀번호가 새어 나왔다 — ${joined}`);
  }
});

test("(가)17 user 칸을 빠뜨리면 거부(그 값이 나중에 docker 인자가 된다)", () => {
  const c = OK(); delete c.backup.user;
  rejects(c, "DB 계정 이름을", "(가)17");
});

test("(가)18 database 칸을 빠뜨리면 '없다'고 말한다 — '다르다'가 아니다", () => {
  const c = OK(); delete c.backup.database;
  rejects(c, "백업할 DB 이름을 적으세요", "(가)18");
  // 🛑 겹침 금지: 안 적은 사람에게 "밤이 쓸 DB 이름이 다릅니다"라고 말하면 없는 값을 고치러 간다.
  const rs = backupReasons(c);
  assert.ok(!rs.some((x) => x.includes("밤이 쓸 DB 이름이 다릅니다")),
    `(가)18: 안 적은 칸을 두고 "다릅니다"라고 말했다 — 실제 사유: ${rs.join(" | ")}`);
});

test("(가)19 tool 칸만 빠뜨린 사람에게 '지원 안 합니다'라고 말하지 않는다", () => {
  const c = OK(); delete c.backup.tool;
  rejects(c, "backup.tool 에", "(가)19");
  // 🛑 도커 안 Postgres 를 쓰는 사람이 한 칸을 빠뜨렸을 뿐인데 "다음 판을 기다리라"를 읽으면 포기한다.
  const rs = backupReasons(c);
  assert.ok(!rs.some((x) => x.includes("도커 컨테이너 안의")),
    `(가)19: 빈 칸에 "지원 안 합니다"를 붙였다 — 실제 사유: ${rs.join(" | ")}`);
});

// ───────────────────────── (나) 조립·결과 판정 15칸 ─────────────────────────

const MARKER = "-- PostgreSQL database dump complete";

test("(나)1 dumpArgv 는 코드가 조립한다(순서까지)", () => {
  assert.deepEqual(dumpArgv(OK()), ["exec", "c", "pg_dump", "-U", "postgres", "-d", "db"]);
});

test("(나)2 끝까지 간 덤프만 통과", () => {
  assert.equal(verdict({ status: 0, bytes: 120, tail: MARKER + "\n" }).ok, true);
});

test("(나)3 한 바이트도 안 나왔으면 종료코드 0 이어도 거부", () => {
  assert.equal(verdict({ status: 0, bytes: 0 }).ok, false);
});

test("(나)4 이미지에 도구가 없으면(127) 거부하고 무엇이 없는지 알려준다", () => {
  const r = verdict({ status: 127 });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("도구") || r.reason.includes("pg_dump"), `사유: ${r.reason}`);
});

test("(나)5 중간에 끊긴 부분 덤프는 거부", () => {
  const r = verdict({ status: 1, bytes: 9999 });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("끊겼"), `사유: ${r.reason}`);
});

test("(나)6 시간 초과 사유에는 **적용된** 값이 찍힌다", () => {
  const r = verdict({ signal: "SIGTERM", timeoutMs: 1800000 });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("30분"), `사유: ${r.reason}`);
});

test("(나)7 완료 표식이 없으면(잘린 덤프) 거부", () => {
  assert.equal(verdict({ status: 0, bytes: 9999, tail: "완료 표식 없는 꼬리" }).ok, false);
});

test("(나)8 되살리기 힌트에 ON_ERROR_STOP 이 있다(조용한 실패 방지)", () => {
  assert.ok(TOOLS.pg_dump.restoreFlags.join(" ").includes("ON_ERROR_STOP"),
    "psql 은 오류 221건을 내고도 종료코드 0 을 냈다 — 이 깃발이 없으면 되살리기 실패가 조용히 넘어간다");
  assert.equal(TOOLS.pg_dump.restore, "psql");
});

test("(나)9 어떤 사유 갈래에도 안 걸리는 모양도 거부(fail-closed)", () => {
  // 🛑 이 칸이 fail-closed 를 재는 **유일한** 칸이다. 사유 표 일곱 줄은 빈틈이 없어서,
  //    "표에 없는 종료코드"(옛 입력 {status:125,bytes:0})는 언제나 앞줄이 먼저 잡는다 - 그건 fail-closed 가 아니다.
  //    마지막 갈래에 닿는 유일한 길은 **어떤 규칙에도 안 걸리면서 통과 조건에는 미달하는** 모양이고,
  //    음수 바이트가 바로 그것이다: 사유 표는 `size === 0` 만 보고 통과 조건은 `size > 0` 을 본다.
  const r = verdict({ status: 0, bytes: -5, tail: MARKER + "\n" });
  assert.equal(r.ok, false, "통과 조건 다섯을 못 채웠는데 통과했다 — fail-closed 가 깨졌다");
  assert.ok(String(r.reason).includes("알 수 없는 이유로 실패"),
    `마지막 갈래(fail-closed 보증)에 안 닿았다 — 사유: ${r.reason}`);
});

test("(나)10 ENOENT 가 아닌 스폰 실패도 거부", () => {
  // 🛑 이 칸은 fail-closed 가 아니라 **ENOENT 아닌 스폰 실패** 갈래를 잰다(그 줄이 먼저 잡는다).
  const r = verdict({ error: { code: "EACCES" }, bytes: 0 });
  assert.equal(r.ok, false);
  assert.ok(String(r.reason).includes("도커를 못 돌렸다"),
    `ENOENT 아닌 스폰 실패 줄에 안 닿았다 — 사유: ${r.reason}`);
});

test("(나)11 설정에 인자 배열을 몰래 넣어도 argv 에 안 실린다", () => {
  const c = OK(); c.backup.args = ["--evil"];
  assert.ok(!dumpArgv(c).includes("--evil"), "사람이 준 인자가 그대로 실렸다");
});

test("(나)12 dbNameFromUrl 은 이름만 돌려주고 던지지 않는다", () => {
  const cases = [
    ["postgres://u:pw@localhost:5432/mydb", "mydb"],
    ["postgres://u:pw@localhost:5432/mydb?sslmode=require", "mydb"],
    ["postgres://u:pw@localhost:5432/mydb/", "mydb"],
    ["postgres://u:pw@localhost:5432/", null],
    ["주소가 아닌 글자", null],
  ];
  for (const [url, want] of cases) {
    let got;
    assert.doesNotThrow(() => { got = dbNameFromUrl(url); }, `던지면 안 된다: ${url}`);
    assert.equal(got, want, `입력: ${url}`);
    assert.ok(!String(got).includes("pw"), `반환값에 비밀번호가 새어 나왔다: ${got}`);
  }
});

test("(나)13 dumpArgv 는 스스로 이름 무늬를 다시 잰다(판정을 안 거치고 들어와도)", () => {
  // 🛑 주석("부르기 전에 backupReasons 가 초록이어야 한다")은 1b-2 의 다른 호출 경로를 못 막는다.
  for (const [k, bad] of [["container", "--privileged"], ["user", "-h evil.example"], ["database", ".shell rm -rf /"]]) {
    const c = OK(); c.backup[k] = bad;
    assert.throws(() => dumpArgv(c), `(나)13 ${k}: 규격 밖 이름인데 argv 가 조립됐다`);
  }
  assert.deepEqual(dumpArgv(OK()), ["exec", "c", "pg_dump", "-U", "postgres", "-d", "db"], "정상 설정은 그대로 조립돼야 한다");
});

test("(나)14 SIGKILL 로 죽은 것을 '시간 초과'라고 말하지 않는다", () => {
  const r = verdict({ signal: "SIGKILL", timeoutMs: 1800000 });
  assert.equal(r.ok, false);
  assert.ok(!r.reason.includes("시간 초과"),
    `메모리 부족(SIGKILL)인데 timeoutMs 만 늘리게 만든다 — 사유: ${r.reason}`);
  assert.ok(r.reason.includes("SIGKILL"), `어떤 신호였는지 안 알려준다 — 사유: ${r.reason}`);
  assert.ok(r.reason.includes("메모리"), `원인 힌트가 없다 — 사유: ${r.reason}`);
  // 우리가 보낸 신호(SIGTERM)일 때만 시간 초과다 — (나)6 과 짝이다.
  assert.ok(verdict({ signal: "SIGTERM", timeoutMs: 1800000 }).reason.includes("시간 초과"));
});

test("(나)15 hostFromUrl 은 호스트만 돌려주고 던지지 않는다(비밀번호를 안 담는다)", () => {
  const cases = [
    [`postgres://u:${FAKE_PW}@prod.example.com:5432/db`, "prod.example.com"],
    [`postgres://u:${FAKE_PW}@localhost:5432/db`, "localhost"],
    ["주소가 아닌 글자", null],
    ["", null],
  ];
  for (const [url, want] of cases) {
    let got;
    assert.doesNotThrow(() => { got = hostFromUrl(url); }, "던지면 안 된다(판정기가 그 자리에서 죽는다)");
    assert.equal(got, want, "호스트 이름만 돌려줘야 한다");
    // 🛑 실패 메시지에도 값을 안 찍는다 — 진짜인지 가짜인지 가리는 일 자체가 누출 경로다.
    assert.ok(!String(got).includes(FAKE_PW), "반환값에 비밀번호가 새어 나왔다");
    assert.ok(!String(got).includes("u:"), "반환값에 계정이 새어 나왔다");
    assert.ok(!String(got).includes("5432"), "반환값에 포트가 새어 나왔다");
  }
});

// ───────────────────────── (다) preflight 연동 5칸 ─────────────────────────

test("(다)1 샌드박스가 정상이어도 백업 칸이 없으면 무인이 거부된다", () => {
  const r = evaluate({ sandbox: { dbUrl: "postgres://localhost:5432/db" } }, alive, {});
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("백업 설정이 없습니다")), `사유: ${r.reasons.join(" | ")}`);
});

test("(다)2 샌드박스도 백업도 정상이면 통과", () => {
  assert.equal(evaluate(OK(), alive, {}).ok, true);
});

test("(다)3 🛑 안전 바닥 회귀: 백업이 정상이어도 샌드박스가 없으면 거부", () => {
  // 이 판이 preflight.mjs 의 "샌드박스 미정의면 거부" 갈래를 안 건드렸다는 증거.
  const r = evaluate({ backup: OK().backup }, alive, {});
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("샌드박스 미정의")), `사유: ${r.reasons.join(" | ")}`);
});

test("(다)4 설정 파일이 깨졌으면 '샌드박스 미정의'가 아니라 파일을 못 읽었다고 알린다", () => {
  const dir = tmpDir("broken-json-");
  mkdirSync(join(dir, ".chageun"), { recursive: true });
  writeFileSync(join(dir, ".chageun", "unattended.json"), "{ 이건 JSON 이 아니다");
  const script = join(ROOT, "src", "scripts", "chageun-unattended");
  // env 를 청소해 스폰: 이 기계의 *_KEY 등이 preflight 시크릿 스캔에 걸려 엉뚱하게 빨개지는 것 방지.
  const r = spawnSync("bash", [script, "--check"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 1, "깨진 설정이면 거부(exit 1)");
  assert.ok(out.includes("설정 파일을 읽지 못했습니다"), `출력: ${out}`);
  assert.ok(!out.includes("샌드박스 미정의"), `엉뚱한 데를 고치게 만드는 사유가 섞였다 — 출력: ${out}`);
});

test("(다)5 운영 dbUrl 거부 문구에 비밀번호가 안 나온다(호스트만)", () => {
  const c = OK(); c.sandbox = { dbUrl: `postgres://u:${FAKE_PW}@prod.example.com:5432/db` };
  const r = evaluate(c, alive, {});
  assert.equal(r.ok, false, "운영 주소인데 통과했다");
  const joined = r.reasons.join(" | ");
  // 🛑 값을 실패 메시지에도 안 찍는다.
  assert.ok(!joined.includes(FAKE_PW), "거부 문구에 비밀번호가 통째로 찍혔다");
  assert.ok(joined.includes("prod.example.com"), "무엇이 문제인지 알 수 있게 호스트는 보여야 한다");
  // 주소를 아예 못 읽는 갈래에서도 원본을 대신 찍지 않는다.
  const broken = OK(); broken.sandbox = { dbUrl: `이건 주소가 아니다 ${FAKE_PW}` };
  const rb = evaluate(broken, alive, {}).reasons.join(" | ");
  assert.ok(!rb.includes(FAKE_PW), "못 읽은 주소를 원본 그대로 찍었다");
  assert.ok(rb.includes("주소를 못 읽었습니다"), `못 읽었다는 말이 없다 — 사유: ${rb}`);
});

// ───────────────────────── (라) 견본 유출 방지·자백 3칸 ─────────────────────────

test("(라)1 src/scripts 에 견본 설정 JSON 이 없다(2026-08-17 사고 재현 방지)", () => {
  const files = readdirSync(join(ROOT, "src", "scripts")).filter((f) => f.endsWith(".json"));
  assert.deepEqual(files, [], `배포되는 자리에 설정 견본이 생겼다: ${files.join(", ")}`);
});

test("(라)2 db-backup.mjs 맨 위에 '못 재는 것' 자백이 그대로 있다", () => {
  const src = readFileSync(join(ROOT, "src", "scripts", "db-backup.mjs"), "utf8");
  assert.ok(src.includes("컨테이너 축은 아직 안 잰다"), "컨테이너 축 자백 줄이 사라졌다");
  assert.ok(src.includes("그 말이 참인지도 아직 안 잰다"), "mode:none 거짓말 자백 줄이 사라졌다");
});
test("(라)3 부록이 backup 칸을 함께 안내한다(문서와 기계가 다른 말을 하면 안 된다)", () => {
  // 🛑 이 판이 backup 칸을 필수로 만들었다. 부록이 옛 안내(샌드박스 두 칸)만 남으면
  //    그 글을 그대로 따라 적은 설정이 100% 거부된다.
  const apx = readFileSync(join(ROOT, "src", "rules", "unattended-appendix.md"), "utf8");
  const line = apx.split("\n").find((l) => l.includes("에 1회 설정"));
  assert.ok(line, "부록에서 설정 안내 줄을 못 찾았다");
  for (const key of ["backup", "mode", "container", "tool", "user", "database", "none"]) {
    assert.ok(line.includes(key), `부록 안내에 필수 칸 "${key}" 가 없다`);
  }
});
