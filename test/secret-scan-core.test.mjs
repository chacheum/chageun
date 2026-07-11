import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { isSecret, parseEnv, collectSecrets } = require("../src/hooks/secret-scan-core.js");

test("isSecret: length branch (>=12, no whitespace)", () => {
  assert.equal(isSecret("X", "sk-1234abcd9999"), true);
  assert.equal(isSecret("X", "short"), false);
  assert.equal(isSecret("X", "has a space here!!!"), false);
});
test("isSecret: URL only secret with userinfo", () => {
  assert.equal(isSecret("DB_URL", "postgres://localhost:5432/app"), false);
  assert.equal(isSecret("DB_URL", "postgres://user:pass@host:5432/app"), true);
});
test("isSecret: name branch requires >=6", () => {
  assert.equal(isSecret("API_KEY", "abc123"), true);
  assert.equal(isSecret("PASSWORD", "abc"), false); // <6, accepted FN
  assert.equal(isSecret("PORT", "abc123"), false);  // name not secret-ish
});
test("isSecret: denylist + digit floor", () => {
  assert.equal(isSecret("AUTH_ENABLED", "true"), false);
  assert.equal(isSecret("MODE", "production"), false);
  assert.equal(isSecret("PORT", "3000"), false);
  assert.equal(isSecret("SECRET_NUM", "12345"), false); // digits <6
});
test("isSecret: FP guard — long non-secret values are NOT masked (F3a)", () => {
  assert.equal(isSecret("ADMIN_EMAIL", "admin@company.com"), false);   // email
  assert.equal(isSecret("BUILD_PATH", "/usr/local/app/dist"), false);  // path
  assert.equal(isSecret("PUBLIC_URL", "https://myapp.example.com"), false); // URL, no userinfo
  assert.equal(isSecret("HOST", "database.internal.corp"), false);     // dotted host (letters only)
  assert.equal(isSecret("APP", "my-frontend-service"), false);         // kebab word, letters only
  // real tokens still caught:
  assert.equal(isSecret("SESSION", "aB3xK9pQ7mL2wZ8t"), true);         // unnamed, mixed case → token
  assert.equal(isSecret("X", "sk-1234abcd9999"), true);                // unnamed, letter+digit → token
});
test("parseEnv: export, quotes, first =, comments, CRLF", () => {
  const c = 'export API_KEY="sk-abc=xyz123456" # note\r\nPORT=3000\r\n# comment\r\nBAD LINE\r\nPWD=\'p@ss w0rd\'';
  const got = parseEnv(c);
  assert.deepEqual(got.find(x=>x.key==="API_KEY"), {key:"API_KEY", value:"sk-abc=xyz123456"});
  assert.deepEqual(got.find(x=>x.key==="PORT"), {key:"PORT", value:"3000"});
  assert.deepEqual(got.find(x=>x.key==="PWD"), {key:"PWD", value:"p@ss w0rd"});
  assert.equal(got.find(x=>x.key==="BAD"), undefined);
});

test("collectSecrets: depth-2 glob, example excluded, node_modules skipped", () => {
  const d = mkdtempSync(join(tmpdir(), "g7-"));
  writeFileSync(join(d, ".env"), "API_KEY=sk-root12345678\nPORT=3000\n");
  writeFileSync(join(d, ".env.example"), "API_KEY=your-key-here-xxxxx\n");
  mkdirSync(join(d, "apps", "web"), { recursive: true });
  writeFileSync(join(d, "apps", "web", ".env"), "TOKEN=tok-web987654321\n");
  mkdirSync(join(d, "node_modules", "x"), { recursive: true });
  writeFileSync(join(d, "node_modules", "x", ".env"), "SECRET=should-not-appear-xx\n");
  const s = collectSecrets(d);
  const vals = s.map(x => x.value);
  assert.ok(vals.includes("sk-root12345678"));
  assert.ok(vals.includes("tok-web987654321"));      // depth-2
  assert.ok(!vals.includes("your-key-here-xxxxx"));   // .env.example excluded
  assert.ok(!vals.includes("should-not-appear-xx"));  // node_modules skipped
  assert.ok(!vals.includes("3000"));                  // not a secret
});
