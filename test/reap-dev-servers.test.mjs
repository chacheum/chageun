import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isDevServer, isDevLauncher, isDeleted, selectReapable, MAX_KILL } = require("../src/hooks/reap-dev-servers-core.js");

const UID = 1000;
const del = (p) => p + " (deleted)";

test("isDevServer: recognizes next-server by comm and cmdline", () => {
  assert.equal(isDevServer("next-server", ""), true);
  assert.equal(isDevServer("node", "next-server (v16.2.4)"), true);
});

test("isDevServer: recognizes common node dev servers (token + subcommand)", () => {
  assert.equal(isDevServer("node", "node /app/node_modules/.bin/next dev"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/vite/bin/vite.js"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/webpack-dev-server/bin/webpack-dev-server.js"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/react-scripts/scripts/start.js"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/nuxt/bin/nuxt.mjs dev"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/.bin/astro dev"), true);
  assert.equal(isDevServer("node", "node /app/node_modules/.bin/ng serve"), true);
});

test("isDevServer: does NOT match one-off builds or unrelated node", () => {
  assert.equal(isDevServer("node", "node /app/node_modules/vite/bin/vite.js build"), false);
  assert.equal(isDevServer("node", "vite preview"), false);
  assert.equal(isDevServer("node", "node server.js"), false);
  assert.equal(isDevServer("claude", "claude"), false);
  assert.equal(isDevServer("node", ""), false);
});

// Fable5 audit: substring matching wrongly flagged these. Token+comm gate must reject them.
test("isDevServer: rejects Fable5 false-positives (substring surface closed)", () => {
  assert.equal(isDevServer("python3", "python3 /home/u/dev/next-gen-model/train.py"), false); // ML 학습
  assert.equal(isDevServer("tail", "tail -f /home/u/dev/next-app.log"), false);               // 로그 tail
  assert.equal(isDevServer("vim", "vim node_modules/next/dist/server/next-server.js"), false); // 편집 중 vim
  assert.equal(isDevServer("node", "node /home/u/dev/nextcloud-backup/sync.js"), false);       // 백업 데몬
  assert.equal(isDevServer("node", "node poll.js --url https://api.foo.ng --mode serve"), false); // .ng 도메인
  assert.equal(isDevServer("bash", "bash /home/u/dev/scripts/nightly.sh --next-run daily"), false); // 야간 배치
  assert.equal(isDevServer("node", "node /home/u/dev/app/build.js"), false);                   // /dev/ 경로 + node
});

test("isDevLauncher: only npm/yarn/pnpm run dev or nodemon", () => {
  assert.equal(isDevLauncher("npm run dev"), true);
  assert.equal(isDevLauncher("node /app/.bin/nodemon server.js"), true);
  assert.equal(isDevLauncher("node /srv/scheduler.js"), false);   // 범용 node 데몬
  assert.equal(isDevLauncher("npm run build"), false);
  assert.equal(isDevLauncher("yarn test"), false);
});

test("isDeleted: only true for the ' (deleted)' suffix", () => {
  assert.equal(isDeleted("/home/u/app/web (deleted)"), true);
  assert.equal(isDeleted("/home/u/app/web"), false);
  assert.equal(isDeleted("/home/u/deleted-things/web"), false); // 'deleted' in name, not suffix
  assert.equal(isDeleted(null), false);
});

test("selectReapable: reaps a dev server ONLY when its cwd is deleted", () => {
  const live = { pid: 100, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: "/app/web" };
  const stale = { pid: 200, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([live, stale], UID, { selfPid: 9 }), [200]);
});

test("selectReapable: reaps the deleted-cwd launcher parent (npm run dev)", () => {
  const parent = { pid: 300, ppid: 1, uid: UID, comm: "node", cmdline: "npm run dev", cwd: del("/app/web") };
  const child = { pid: 301, ppid: 300, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([parent, child], UID, { selfPid: 9 }), [300, 301]);
});

test("selectReapable: does NOT reap a generic node daemon parent (Fable5 finding 2)", () => {
  const parent = { pid: 300, ppid: 1, uid: UID, comm: "node", cmdline: "node /srv/scheduler.js", cwd: del("/tmp/x") };
  const child = { pid: 301, ppid: 300, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([parent, child], UID, { selfPid: 9 }), [301]); // only the child
});

test("selectReapable: does NOT reap a live parent even if child is stale", () => {
  const parent = { pid: 300, ppid: 1, uid: UID, comm: "node", cmdline: "npm run dev", cwd: "/app/web" };
  const child = { pid: 301, ppid: 300, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/web") };
  assert.deepEqual(selectReapable([parent, child], UID, { selfPid: 9 }), [301]);
});

test("selectReapable: never reaps self, pid<=1, or other users", () => {
  const self = { pid: 9, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app") };
  const init = { pid: 1, ppid: 0, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app") };
  const other = { pid: 500, ppid: 1, uid: 0, comm: "next-server", cmdline: "next-server", cwd: del("/app") };
  assert.deepEqual(selectReapable([self, init, other], UID, { selfPid: 9 }), []);
});

test("selectReapable: caps output at MAX_KILL", () => {
  const many = [];
  for (let i = 0; i < MAX_KILL + 20; i++) {
    many.push({ pid: 1000 + i, ppid: 1, uid: UID, comm: "next-server", cmdline: "next-server", cwd: del("/app/" + i) });
  }
  assert.equal(selectReapable(many, UID, { selfPid: 9 }).length, MAX_KILL);
});

test("selectReapable: tolerates junk input", () => {
  assert.deepEqual(selectReapable(null, UID, {}), []);
  assert.deepEqual(selectReapable([null, undefined, {}, { pid: "x" }], UID, {}), []);
});
