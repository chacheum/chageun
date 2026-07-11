// chageun G7 secret-scan core — shared pure logic (Claude PostToolUse redaction + Claude/Codex Stop backstop).
// Single source of truth for detection so both platforms stay identical. Values held in memory only; never logged/transmitted.
"use strict";

const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|AUTH|CREDENTIAL|PRIVATE|APIKEY/i;
const DENYLIST = new Set(["true","false","yes","no","on","off","dev","prod","test","local","none","null","debug","production","development"]);

// length/entropy branch: a token-like value under ANY key. Tightened (F3a) so paths,
// emails, and low-entropy config don't get redacted everywhere. Residual FP (long
// hyphenated app-names-with-digits, long hex) documented in spec §5.
function looksLikeToken(v) {
  if (v.length < 12 || /\s/.test(v)) return false;
  if (v.includes("@")) return false;                                  // email-ish
  if (/^[~.\/]/.test(v) || /^[A-Za-z]:[\\\/]/.test(v)) return false;  // filesystem path
  if ((v.match(/\//g) || []).length >= 3) return false;               // path-like
  const hasLower = /[a-z]/.test(v), hasUpper = /[A-Z]/.test(v), hasDigit = /[0-9]/.test(v);
  // letter+digit OR mixed-case → token-like. Excludes dotted hostnames / kebab words (letters only).
  return (hasDigit && (hasLower || hasUpper)) || (hasLower && hasUpper);
}
function isSecret(key, value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length < 3) return false;
  if (DENYLIST.has(v.toLowerCase())) return false;
  if (/^\d+$/.test(v) && v.length < 6) return false;
  if (SECRET_NAME_RE.test(String(key)) && v.length >= 6) return true; // named secret first (incl. path-token URLs, N4)
  if (v.includes("://")) return /:\/\/[^/\s@]+@/.test(v);             // unnamed URL: only userinfo is secret
  return looksLikeToken(v);                                            // unnamed high-entropy token
}

function parseEnv(content) {
  const out = [];
  const text = String(content).replace(/\r\n/g, "\n").replace(/^﻿/, "");
  for (const raw of text.split("\n")) {
    try {
      let line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("export ")) line = line.slice(7).trim();
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let val = line.slice(eq + 1).trim();
      const q = val[0];
      if ((q === '"' || q === "'") && val.indexOf(q, 1) > 0) {
        // quoted value: take content up to the first matching close quote; trailing inline comment ignored.
        val = val.slice(1, val.indexOf(q, 1));
      } else {
        const h = val.indexOf(" #");
        if (h >= 0) val = val.slice(0, h).trim();
      }
      out.push({ key, value: val });
    } catch (_) { /* per-line isolation */ }
  }
  return out;
}

const fs = require("fs");
const path = require("path");
const MAX_FILE = 256 * 1024, MAX_SECRETS = 200, MAX_FILES = 20;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const EXAMPLE_RE = /\.(example|sample|template|dist)$/i;

function envFiles(cwd) {
  const found = [];
  (function walk(dir, depth) {
    if (found.length >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (found.length >= MAX_FILES) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 2 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(full, depth + 1);
      } else if (e.isFile() && (e.name === ".env" || e.name.startsWith(".env.")) && !EXAMPLE_RE.test(e.name)) {
        found.push(full);
      }
    }
  })(cwd, 0);
  return found;
}

function collectSecrets(cwd) {
  const secrets = [];
  for (const f of envFiles(cwd)) {
    try {
      const st = fs.statSync(f);
      if (!st.isFile() || st.size > MAX_FILE) continue;
      for (const { key, value } of parseEnv(fs.readFileSync(f, "utf8"))) {
        if (isSecret(key, value)) secrets.push({ key, value });
      }
    } catch (_) { /* per-file isolation */ }
  }
  secrets.sort((a, b) => b.value.length - a.value.length);
  return secrets.slice(0, MAX_SECRETS);
}

function redact(text, secrets) {
  if (typeof text !== "string" || !text || !Array.isArray(secrets) || !secrets.length) {
    return { text, count: 0 };
  }
  let out = text, count = 0;
  const sorted = [...secrets].sort((a, b) => b.value.length - a.value.length);
  for (const { key, value } of sorted) {
    if (!value || out.indexOf(value) === -1) continue;
    const marker = `«chageun G7: secret redacted (${key}) — report name/existence only; do not reconstruct; to place a secret into config use shell (cp/sed) without printing»`;
    out = out.split(value).join(marker);
    count++;
  }
  return { text: out, count };
}

// strip whitespace, backticks, quotes, and zero-width chars (U+200B ZWSP .. U+200D ZWJ, U+FEFF BOM)
// so a value re-quoted with cosmetic spacing/backticks is still caught.
function normalize(s) {
  return String(s).replace(/[\s`'"​-‍﻿]/g, "");
}
function findLeaks(text, secrets) {
  if (typeof text !== "string" || !text || !Array.isArray(secrets)) return [];
  const nText = normalize(text);
  const hits = [];
  for (const { key, value } of secrets) {
    if (!value || value.length < 6) continue;
    const b64 = Buffer.from(value).toString("base64");
    if (text.includes(value) || nText.includes(normalize(value)) || text.includes(b64)) {
      hits.push(key);
    }
  }
  return hits;
}

module.exports = { isSecret, parseEnv, collectSecrets, redact, findLeaks };
