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

module.exports = { isSecret, parseEnv };
