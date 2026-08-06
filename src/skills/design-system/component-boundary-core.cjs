"use strict";

const { posix } = require("node:path");

const ID = /^[a-z][a-z0-9-]*$/;
const KINDS = new Set(["primitive", "layout", "composite"]);
const ROOT_LAYOUTS = new Set([
  "src/app/layout.tsx", "src/app/layout.jsx", "app/layout.tsx", "app/layout.jsx",
]);

function issue(code, detail) {
  return detail ? { code, detail } : { code };
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function validRelativePath(value, { glob = false } = {}) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").includes("..")) return false;
  if (!glob && /[{}*?\[\]]/.test(value)) return false;
  if (glob && (/[{}?\[\]]/.test(value) || /\*{3,}/.test(value))) return false;
  return true;
}

function frontmatter(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : "";
}

function listValue(lines, key) {
  const index = lines.findIndex((line) => new RegExp(`^${key}:\\s*(.*)$`).test(line));
  if (index === -1) return undefined;
  const inline = lines[index].replace(new RegExp(`^${key}:\\s*`), "").trim();
  if (inline) return [inline];
  const values = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const match = lines[cursor].match(/^\s+-\s+(.+)$/);
    if (!match) break;
    values.push(match[1].trim());
  }
  return values;
}

function scalarValue(lines, key) {
  const line = lines.find((candidate) => new RegExp(`^${key}:`).test(candidate));
  if (!line) return undefined;
  return line.replace(new RegExp(`^${key}:\\s*`), "").trim();
}

function parseDesignConfig(text) {
  const lines = frontmatter(text).split(/\r?\n/);
  const registryPath = scalarValue(lines, "component-registry-path");
  const roots = listValue(lines, "component-roots");
  const pagePatterns = listValue(lines, "page-patterns");
  const mentioned = [registryPath, roots, pagePatterns].some((value) => value !== undefined);
  if (!mentioned) return { enabled: false };
  if (!registryPath || !roots?.length || !pagePatterns?.length) {
    throw new Error("component-boundary-config-incomplete");
  }
  if (!validRelativePath(registryPath) || roots.some((root) => !validRelativePath(root)) || pagePatterns.some((pattern) => !validRelativePath(pattern, { glob: true }))) {
    throw new Error("component-boundary-config-invalid-path");
  }
  return {
    enabled: true,
    registryPath: normalizePath(registryPath),
    componentRoots: roots.map(normalizePath),
    pagePatterns: pagePatterns.map(normalizePath),
  };
}

function matchingBrace(text, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"') quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function directObjectKeys(raw, property) {
  const propertyMatch = new RegExp(`"${property}"\\s*:`).exec(raw);
  if (!propertyMatch) return [];
  const start = raw.indexOf("{", propertyMatch.index + propertyMatch[0].length);
  const end = matchingBrace(raw, start);
  if (start === -1 || end === -1) return [];
  const keys = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start + 1; index < end; index += 1) {
    const char = raw[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"') {
      const close = (() => {
        let cursor = index + 1;
        let stringEscaped = false;
        while (cursor < end) {
          if (stringEscaped) stringEscaped = false;
          else if (raw[cursor] === "\\") stringEscaped = true;
          else if (raw[cursor] === '"') return cursor;
          cursor += 1;
        }
        return -1;
      })();
      if (depth === 0 && close !== -1 && /^\s*:/.test(raw.slice(close + 1))) {
        keys.push(JSON.parse(raw.slice(index, close + 1)));
      }
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
  }
  return keys;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return object(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function validComponent(component) {
  if (!exactKeys(component, ["path", "kind", "family", "purpose", "variants"])) return false;
  if (!validRelativePath(component.path) || !KINDS.has(component.kind)) return false;
  if (typeof component.family !== "string" || !component.family.trim() || typeof component.purpose !== "string" || !component.purpose.trim()) return false;
  if (!object(component.variants) || !Object.keys(component.variants).length) return false;
  return Object.entries(component.variants).every(([id, variant]) => ID.test(id)
    && exactKeys(variant, ["purpose"])
    && typeof variant.purpose === "string"
    && Boolean(variant.purpose.trim()));
}

function validDecision(decision, components) {
  if (!exactKeys(decision, ["component", "variant", "choice", "reason", "approvalToolUseId"])) return false;
  if (!ID.test(decision.component) || !ID.test(decision.variant) || decision.choice !== "new-variant") return false;
  if (typeof decision.reason !== "string" || !decision.reason.trim() || typeof decision.approvalToolUseId !== "string" || !decision.approvalToolUseId.trim()) return false;
  return Boolean(components[decision.component]?.variants[decision.variant]);
}

function parseRegistry(text) {
  const raw = String(text || "");
  const keys = directObjectKeys(raw, "components");
  if (new Set(keys).size !== keys.length) throw new Error("duplicate-id");
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    throw new Error("registry-json-invalid");
  }
  if (!exactKeys(registry, ["version", "components", "decisions"]) || registry.version !== 1 || !object(registry.components) || !Array.isArray(registry.decisions)) {
    throw new Error("registry-schema-invalid");
  }
  const paths = new Set();
  const families = new Set();
  for (const [id, component] of Object.entries(registry.components)) {
    if (!ID.test(id) || !validComponent(component)) throw new Error("component-schema-invalid");
    if (paths.has(component.path)) throw new Error("duplicate-path");
    if (families.has(component.family)) throw new Error("duplicate-family");
    paths.add(component.path);
    families.add(component.family);
  }
  for (const decision of registry.decisions) {
    if (!validDecision(decision, registry.components)) throw new Error("decision-schema-invalid");
  }
  return registry;
}

function underRoot(path, root) {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root).replace(/\/$/, "");
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

function validateRegistryBoundary({ config, registry }) {
  const errors = [];
  if (!config?.enabled) return { violations: [], errors };
  for (const component of Object.values(registry.components)) {
    if (!config.componentRoots.some((root) => underRoot(component.path, root))) {
      errors.push(issue("registry-path-outside-root", component.path));
    }
  }
  return { violations: [], errors };
}

function globToRegExp(pattern) {
  let output = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        output += "(?:.*/)?";
        index += 2;
      } else {
        output += ".*";
        index += 1;
      }
    } else if (char === "*") output += "[^/]*";
    else output += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${output}$`);
}

function pathRole(file, config) {
  if (!config?.enabled) return "other";
  const normalized = normalizePath(file);
  if (config.pagePatterns.some((pattern) => globToRegExp(pattern).test(normalized))) return "page";
  if (config.componentRoots.some((root) => underRoot(normalized, root))) return "component";
  return "other";
}

function registryChanges(beforeRegistry, afterRegistry) {
  const addedComponents = Object.keys(afterRegistry.components)
    .filter((id) => !Object.hasOwn(beforeRegistry.components, id));
  const addedVariants = [];
  for (const [component, after] of Object.entries(afterRegistry.components)) {
    const before = beforeRegistry.components[component];
    if (!before) continue;
    for (const variant of Object.keys(after.variants)) {
      if (!Object.hasOwn(before.variants, variant)) addedVariants.push({ component, variant });
    }
  }
  const addedDecisions = afterRegistry.decisions.filter((decision) => !beforeRegistry.decisions.some((before) => JSON.stringify(before) === JSON.stringify(decision)));
  const errors = [];
  const expected = new Set(addedVariants.map(({ component, variant }) => `${component}:${variant}`));
  for (const key of expected) {
    const [component, variant] = key.split(":");
    const matches = addedDecisions.filter((decision) => decision.component === component && decision.variant === variant && decision.choice === "new-variant" && decision.approvalToolUseId);
    if (matches.length !== 1) errors.push(issue("variant-decision-mismatch", key));
  }
  for (const decision of addedDecisions) {
    const key = `${decision.component}:${decision.variant}`;
    if (!expected.has(key)) errors.push(issue("unlinked-variant-decision", key));
  }
  return { addedComponents, addedVariants, addedDecisions, errors };
}

function maskCode(text) {
  let output = "";
  let state = "code";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        output += "  "; index += 1; state = "line-comment";
      } else if (char === "/" && next === "*") {
        output += "  "; index += 1; state = "block-comment";
      } else if (["'", '"', "`"].includes(char)) {
        output += " "; state = char; escaped = false;
      } else output += char;
    } else if (state === "line-comment") {
      output += char === "\n" ? "\n" : " ";
      if (char === "\n") state = "code";
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  "; index += 1; state = "code";
      } else output += char === "\n" ? "\n" : " ";
    } else {
      output += char === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === state) state = "code";
    }
  }
  return output;
}

function blankPreservingLines(text) {
  return String(text || "").replace(/[^\r\n]/g, " ");
}

function maskHtmlComments(text) {
  return String(text || "").replace(/<!--[\s\S]*?-->/g, blankPreservingLines);
}

function maskSvelteMetadata(text) {
  return String(text || "").replace(/<svelte:head\b[^>]*>[\s\S]*?<\/svelte:head\s*>/gi, blankPreservingLines);
}

function codeCommentText(text) {
  const comments = [];
  let state = "code";
  let escaped = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        start = index + 2; index += 1; state = "line-comment";
      } else if (char === "/" && next === "*") {
        start = index + 2; index += 1; state = "block-comment";
      } else if (["'", '"', "`"].includes(char)) {
        state = char; escaped = false;
      }
    } else if (state === "line-comment") {
      if (char === "\n") {
        comments.push(text.slice(start, index));
        state = "code";
      }
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        comments.push(text.slice(start, index));
        index += 1; state = "code";
      }
    } else if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === state) state = "code";
  }
  if (state === "line-comment") comments.push(text.slice(start));
  return comments.join("\n");
}

function htmlCommentText(text) {
  return [...String(text || "").matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1]).join("\n");
}

function markerCommentText(source, file) {
  const raw = String(source || "");
  const areas = extractUiAreas(raw, file);
  // Vue component 표식처럼 <template> 바깥의 HTML 주석도 허용하되, JavaScript 문자열 안에
  // 우연히 적힌 marker 모양은 maskCode로 지운 뒤에만 HTML 주석을 찾는다.
  return [codeCommentText(areas.code), htmlCommentText(maskCode(raw))].filter(Boolean).join("\n");
}

function extractUiAreas(source, file) {
  const extension = normalizePath(file).split(".").pop();
  if (extension === "vue") {
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    const template = source.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i)?.[1] || "";
    return { markup: template, code: scripts.length ? scripts.join("\n") : source };
  }
  if (extension === "svelte") {
    const code = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
    const markup = source
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    return { markup, code };
  }
  if (extension === "astro") {
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    return { markup: source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""), code: frontmatter?.[1] || "" };
  }
  return { markup: source, code: source };
}

function attributeNames(raw) {
  const names = [];
  for (const match of raw.matchAll(/\s+([:@A-Za-z_][\w:.-]*)\b/g)) names.push(match[1]);
  return names;
}

function staticTokens(raw) {
  const tokens = [];
  for (const match of raw.matchAll(/\b(?:class|className|style)\s*=\s*(["'])(.*?)\1/g)) {
    tokens.push(...match[2].trim().split(/\s+/).filter(Boolean));
  }
  return tokens;
}

function importedFactories(code, masked) {
  const factories = new Set();
  for (const match of code.matchAll(/\bimport\s*{([^}]+)}\s*from\s*(["'])(react|vue)\2/g)) {
    if (masked[match.index] === " ") continue;
    for (const part of match[1].split(",")) {
      const named = part.trim().match(/^(createElement|h)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!named) continue;
      if ((match[3] === "react" && named[1] === "createElement") || (match[3] === "vue" && named[1] === "h")) {
        factories.add(named[2] || named[1]);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const factory of [...factories]) {
      const escaped = factory.replace(/[$]/g, "\\$");
      const expression = new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escaped}\\s*;?`, "g");
      for (const match of code.matchAll(expression)) {
        if (masked[match.index] !== " " && !factories.has(match[1])) {
          factories.add(match[1]);
          changed = true;
        }
      }
    }
  }
  return factories;
}

function importsForSource(code, masked) {
  const imports = new Map();
  const expression = /\bimport\s+([\s\S]*?)\s+from\s*(["'])([^"']+)\2\s*;?/g;
  for (const match of code.matchAll(expression)) {
    if (masked[match.index] === " ") continue;
    const binding = match[1].trim();
    const specifier = match[3];
    if (/^[A-Za-z_$][\w$]*$/.test(binding)) imports.set(binding, specifier);
    const named = binding.match(/^{\s*([\s\S]*?)\s*}$/);
    if (named) {
      for (const part of named[1].split(",")) {
        const item = part.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (item) imports.set(item[2] || item[1], specifier);
      }
    }
  }
  return imports;
}

function scanUi(source, file) {
  const areas = extractUiAreas(String(source || ""), file);
  const extension = normalizePath(file).split(".").pop();
  const markupForMask = extension === "svelte" ? maskSvelteMetadata(areas.markup) : areas.markup;
  const markupMask = maskCode(maskHtmlComments(markupForMask));
  const codeMask = maskCode(areas.code);
  const nativeTags = [];
  const customTags = [];
  const tagDetails = [];
  const tree = [];
  const stack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagExpression = /<\s*(\/)?\s*([A-Za-z][\w:.-]*)\b([^>]*)>/g;
  for (const match of areas.markup.matchAll(tagExpression)) {
    if (markupMask[match.index] !== "<") continue;
    const name = match[2];
    const lowerName = name.toLowerCase();
    if (match[1]) {
      const index = stack.lastIndexOf(name);
      if (index !== -1) stack.length = index;
      continue;
    }
    if (["template", "script", "style", "component"].includes(lowerName) || lowerName.startsWith("svelte:")) continue;
    const vueKebab = extension === "vue" && name === name.toLowerCase() && name.includes("-");
    const native = name === name.toLowerCase() && !vueKebab;
    const detail = { name, attrs: attributeNames(match[3]), tokens: staticTokens(match[3]) };
    tagDetails.push(detail);
    tree.push([...stack, name].join(">"));
    if (native) nativeTags.push(name);
    else customTags.push(name);
    if (!/\/\s*$/.test(match[3]) && !voidTags.has(lowerName)) stack.push(name);
  }
  const factories = importedFactories(areas.code, codeMask);
  const callees = ["React\\.createElement", ...[...factories].map((name) => name.replace(/[$]/g, "\\$"))];
  if (callees.length) {
    const callExpression = new RegExp(`\\b(?:${callees.join("|")})\\s*\\(\\s*(["'])([a-z][\\w:-]*)\\1`, "g");
    for (const match of areas.code.matchAll(callExpression)) {
      if (codeMask[match.index] !== " ") nativeTags.push(match[2]);
    }
  }
  const imports = importsForSource(areas.code, codeMask);
  const localComponents = new Set();
  for (const match of areas.code.matchAll(/\b(?:const|function|class)\s+([A-Z][\w$]*)\b/g)) {
    if (codeMask[match.index] !== " ") localComponents.add(match[1]);
  }
  return {
    nativeTags,
    customTags,
    imports,
    localComponents,
    fingerprint: {
      nativeTags: tagDetails.filter((tag) => tag.name === tag.name.toLowerCase()).map((tag) => tag.name),
      attrs: tagDetails.flatMap((tag) => tag.attrs),
      tokens: tagDetails.flatMap((tag) => tag.tokens),
      children: customTags,
      tree,
    },
    errors: [],
  };
}

function sourceWithoutExtension(path) {
  return normalizePath(path).replace(/\.[^.\/]+$/, "");
}

function resolveImport(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  return posix.normalize(posix.join(posix.dirname(normalizePath(file)), specifier));
}

function tagNameMatches(tag, local) {
  const normalize = (value) => value.replaceAll("-", "").toLowerCase();
  return normalize(tag) === normalize(local);
}

function markerResult(source, file, id, component) {
  const comments = markerCommentText(source, file);
  const components = [...comments.matchAll(/@design-component\s+([^\s*<>]+)/g)];
  const variants = [...comments.matchAll(/@design-variants\s+([a-z0-9][a-z0-9,\s-]*?)(?=\s*(?:-->|\*\/|$))/gm)];
  if (components.length !== 1 || variants.length !== 1 || components[0][1].trim() !== id) return issue("component-marker-mismatch");
  const listed = variants[0][1].split(",").map((value) => value.trim()).filter(Boolean);
  if (!listed.length || listed.some((variant) => !ID.test(variant))) return issue("component-marker-mismatch");
  const expected = Object.keys(component.variants).sort();
  if (new Set(listed).size !== listed.length || JSON.stringify([...listed].sort()) !== JSON.stringify(expected)) return issue("component-marker-mismatch");
  return null;
}

function registeredRecordForImport(file, specifier, registry) {
  const resolved = resolveImport(file, specifier);
  if (!resolved) return null;
  return Object.entries(registry.components).find(([, component]) => sourceWithoutExtension(component.path) === sourceWithoutExtension(resolved)) || null;
}

function pageFindings({ file, after, registry, knownSources = {} }) {
  const scan = scanUi(after, file);
  const findings = [];
  const isRootLayout = ROOT_LAYOUTS.has(normalizePath(file));
  for (const tag of scan.nativeTags) {
    if (isRootLayout && (tag === "html" || tag === "body")) continue;
    findings.push(issue("page-direct-ui", tag));
  }
  for (const tag of new Set(scan.customTags)) {
    const local = [...scan.localComponents].find((name) => tagNameMatches(tag, name));
    if (local) {
      findings.push(issue("page-local-component", tag));
      continue;
    }
    const imported = [...scan.imports.entries()].find(([name]) => tagNameMatches(tag, name));
    const record = imported && registeredRecordForImport(file, imported[1], registry);
    if (!record) {
      findings.push(issue("page-unregistered-component", tag));
      continue;
    }
    const [id, component] = record;
    if (!Object.hasOwn(knownSources, component.path)) {
      findings.push(issue("registered-source-unavailable", component.path));
      continue;
    }
    const marker = markerResult(knownSources[component.path], component.path, id, component);
    if (marker) findings.push(marker);
  }
  return { findings, errors: scan.errors.map((code) => issue(code)) };
}

function countFindings(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = `${entry.code}:${entry.detail || ""}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function validatePage({ file, before, after, config, registry, knownSources, mode = "full" }) {
  if (!config?.enabled || pathRole(file, config) !== "page") return { violations: [], errors: [] };
  const afterResult = pageFindings({ file, after, registry, knownSources });
  if (mode === "full" || before === null || before === undefined) return { violations: afterResult.findings, errors: afterResult.errors };
  const beforeResult = pageFindings({ file, after: before, registry, knownSources });
  const beforeCounts = countFindings(beforeResult.findings);
  const seen = new Map();
  const violations = afterResult.findings.filter((entry) => {
    const key = `${entry.code}:${entry.detail || ""}`;
    const current = (seen.get(key) || 0) + 1;
    seen.set(key, current);
    return current > (beforeCounts.get(key) || 0);
  });
  return { violations, errors: afterResult.errors };
}

function multisetEqual(left, right) {
  if (left.length !== right.length) return false;
  const counts = new Map();
  for (const value of left) counts.set(value, (counts.get(value) || 0) + 1);
  for (const value of right) {
    const next = (counts.get(value) || 0) - 1;
    if (next < 0) return false;
    counts.set(value, next);
  }
  return [...counts.values()].every((count) => count === 0);
}

function normalizePurpose(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function compareCandidates(candidates, current) {
  return candidates
    .filter((candidate) => candidate.id !== current.id)
    .map((candidate) => {
      if (candidate.family === current.family) return { ...candidate, signals: 3 };
      if (candidate.kind !== current.kind) return null;
      let signals = 0;
      if (normalizePurpose(candidate.purpose) === normalizePurpose(current.purpose)) signals += 1;
      if (multisetEqual(candidate.fingerprint.nativeTags, current.fingerprint.nativeTags)
        && multisetEqual(candidate.fingerprint.attrs, current.fingerprint.attrs)) signals += 1;
      if (candidate.fingerprint.children.length
        && JSON.stringify(candidate.fingerprint.children) === JSON.stringify(current.fingerprint.children)) signals += 1;
      return signals >= 2 ? { ...candidate, signals } : null;
    })
    .filter(Boolean)
    .sort((left, right) => (right.signals - left.signals) || left.id.localeCompare(right.id));
}

function plainDivWrapper(scan) {
  return scan.nativeTags.length === 1
    && scan.nativeTags[0] === "div"
    && scan.customTags.length === 0
    && scan.fingerprint.attrs.length === 0
    && scan.fingerprint.tokens.length === 0;
}

function componentFingerprint(scan, file, registry) {
  const children = scan.customTags.flatMap((tag) => {
    const imported = [...scan.imports.entries()].find(([name]) => tagNameMatches(tag, name));
    const record = imported && registeredRecordForImport(file, imported[1], registry);
    return record ? [record[0]] : [];
  });
  return { ...scan.fingerprint, children };
}

function validateComponent({ file, after, config, registry, knownSources = {}, pendingSourcePaths = new Set() }) {
  if (!config?.enabled || pathRole(file, config) !== "component") return { violations: [], errors: [] };
  const scan = scanUi(after, file);
  const entry = Object.entries(registry.components).find(([, component]) => component.path === normalizePath(file));
  if (!entry) {
    if (!scan.nativeTags.length && !scan.customTags.length || plainDivWrapper(scan)) return { violations: [], errors: scan.errors.map((code) => issue(code)) };
    return { violations: [issue("component-unregistered", file)], errors: scan.errors.map((code) => issue(code)) };
  }
  const [id, component] = entry;
  const marker = markerResult(after, file, id, component);
  if (marker) return { violations: [marker], errors: scan.errors.map((code) => issue(code)) };

  const current = { id, ...component, fingerprint: componentFingerprint(scan, file, registry) };
  const candidates = [];
  const errors = scan.errors.map((code) => issue(code));
  for (const [candidateId, candidate] of Object.entries(registry.components)) {
    if (candidateId === id) continue;
    const source = knownSources[candidate.path];
    if (typeof source !== "string") {
      if (!pendingSourcePaths.has(candidate.path)) errors.push(issue("registered-source-unavailable", candidate.path));
      continue;
    }
    const candidateMarker = markerResult(source, candidate.path, candidateId, candidate);
    if (candidateMarker) {
      errors.push(candidateMarker);
      continue;
    }
    candidates.push({
      id: candidateId,
      ...candidate,
      fingerprint: componentFingerprint(scanUi(source, candidate.path), candidate.path, registry),
    });
  }
  const duplicate = compareCandidates(candidates, current)
    .find((candidate) => JSON.stringify(candidate.fingerprint) === JSON.stringify(current.fingerprint));
  return { violations: duplicate ? [issue("component-duplicate-structure", duplicate.id)] : [], errors };
}

function applyOneEdit(before, edit) {
  if (!edit || typeof edit.old_string !== "string" || typeof edit.new_string !== "string") return { after: before, error: issue("edit-input-invalid") };
  const occurrences = before.split(edit.old_string).length - 1;
  if (!occurrences || (!edit.replace_all && occurrences !== 1)) return { after: before, error: issue("edit-source-mismatch") };
  return { after: edit.replace_all ? before.split(edit.old_string).join(edit.new_string) : before.replace(edit.old_string, edit.new_string), error: null };
}

function applyToolEdit(input, beforeText) {
  if (typeof input?.content === "string") return { after: input.content, errors: [] };
  const edits = Array.isArray(input?.edits) ? input.edits : [input];
  let after = String(beforeText || "");
  const errors = [];
  for (const edit of edits) {
    const result = applyOneEdit(after, edit);
    after = result.after;
    if (result.error) errors.push(result.error);
  }
  return { after, errors };
}

module.exports = {
  parseDesignConfig,
  parseRegistry,
  validateRegistryBoundary,
  pathRole,
  applyToolEdit,
  scanUi,
  validatePage,
  validateComponent,
  registryChanges,
  compareCandidates,
};
