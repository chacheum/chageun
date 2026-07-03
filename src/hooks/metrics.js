// chageun metrics — out-of-band 계측 로그. 훅의 판정·출력·exit를 절대 바꾸지 않는다.
// log()는 어떤 인자·환경에서도 throw하지 않는다(전체 try/catch, 실패 시 조용히 무시).
// 개인/회사 정보를 능동적으로 수집하지 않음(hook_block snippet만 로컬 저장 — docs/metrics.md 참고).
const fs = require("fs");
const path = require("path");
const os = require("os");

function metricsDir() {
  return process.env.CHAGEUN_METRICS_DIR || path.join(os.homedir(), ".claude", "chageun", "metrics");
}

// 이벤트 한 줄을 월별 jsonl에 append. 실패는 삼킨다(계측이 안전 훅을 막지 않는다).
function log(ev, fields) {
  try {
    const now = new Date();
    const ym = now.toISOString().slice(0, 7); // YYYY-MM
    const dir = metricsDir();
    fs.mkdirSync(dir, { recursive: true });
    const row = JSON.stringify(Object.assign({ ts: now.toISOString(), ev }, fields || {})) + "\n";
    fs.appendFileSync(path.join(dir, ym + ".jsonl"), row);
  } catch (_) { /* out-of-band: 계측 실패 무시 */ }
}

module.exports = { log, metricsDir };
