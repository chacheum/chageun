// 무인 시작 전 검사: 샌드박스 살아있나 + 위험(시크릿/외부/유료키) 없나. 순수 evaluate + main(부수효과).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCAL_HOST = /(^|@|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;
const SECRET_ENV = /(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIALS|_KEY)$/i;
const PAID_VALUE = /\bsk_live_|\bsk-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|private_key|BEGIN [A-Z ]*PRIVATE KEY/; // stripe live·openai·aws·gcp 등
// scheme://[user]:pass@host — 자격증명 박힌 연결문자열. host가 로컬이 아니면 위험.
const URL_WITH_CREDS = /[a-z][a-z0-9+.-]*:\/\/[^/\s@]*:[^/\s@]+@/i;

export function evaluate(config, isAlive, env) {
  const reasons = [];
  const sb = (config && config.sandbox) || null;
  if (!sb || (!sb.container && !sb.dbUrl)) {
    reasons.push("샌드박스 미정의 — .chageun/unattended.json에 sandbox.container 또는 sandbox.dbUrl 필요");
  } else {
    if (sb.container && !isAlive(sb.container)) reasons.push(`샌드박스 container 응답 없음: ${sb.container}`);
    if (sb.dbUrl && !LOCAL_HOST.test(sb.dbUrl)) reasons.push(`dbUrl이 localhost/일회용 아님(운영 위험): ${sb.dbUrl}`);
  }
  for (const [k, v] of Object.entries(env || {})) {
    const val = String(v);
    if (SECRET_ENV.test(k) || PAID_VALUE.test(val)) reasons.push(`위험 환경변수(시크릿/키) 감지 — 무인 부적합: ${k}`);
    else if (URL_WITH_CREDS.test(val) && !LOCAL_HOST.test(val)) reasons.push(`외부 호스트 자격증명 URL 감지 — 무인 부적합: ${k}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function main() {
  let config = {};
  try { config = JSON.parse(readFileSync(".chageun/unattended.json", "utf8")); } catch (_) { /* 미설정 → evaluate가 거부 */ }
  const isAlive = (name) => {
    try { return execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true"; }
    catch (_) { return false; }
  };
  const r = evaluate(config, isAlive, process.env);
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
