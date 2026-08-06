"use strict";

const fs = require("node:fs");
const { join, relative } = require("node:path");
const { spawnSync } = require("node:child_process");
const core = require("./component-boundary-core.cjs");

const DESIGN_DOC = "docs/design-system.md";
const CONFIG_CODES = new Set([
  "component-marker-mismatch",
  "registered-source-unavailable",
  "registry-path-outside-root",
  "variant-decision-mismatch",
  "unlinked-variant-decision",
]);

function print(code, detail) {
  process.stderr.write(`[component-boundary] ${code}${detail ? `: ${detail}` : ""}\n`);
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, output: (result.stdout || "") + (result.stderr || "") };
  return { ok: true, output: result.stdout || "" };
}

function gitText(revision, file) {
  const object = revision === ":" ? `:${file}` : `${revision}:${file}`;
  const result = git(["show", object]);
  return result.ok ? result.output : null;
}

function fileText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function filesBelow(root) {
  const output = [];
  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) output.push(relative(root, full).replaceAll("\\", "/"));
    }
  }
  visit(root);
  return output;
}

function usage() {
  print("usage", "node scripts/check-component-boundaries.cjs [--all | --range <base> <head>]");
  return 2;
}

function gitSnapshot(kind, base, head) {
  if (kind === "staged") {
    const changed = git(["diff", "--cached", "--name-only", "--diff-filter=AMD", "--no-renames"]);
    if (!changed.ok) return { error: changed.output };
    return {
      files: changed.output.split(/\r?\n/).filter(Boolean),
      before: (file) => gitText("HEAD", file),
      after: (file) => gitText(":", file),
    };
  }
  const changed = git(["diff", "--name-only", "--diff-filter=AMD", "--no-renames", base, head]);
  if (!changed.ok) return { error: changed.output };
  return {
    files: changed.output.split(/\r?\n/).filter(Boolean),
    before: (file) => gitText(base, file),
    after: (file) => gitText(head, file),
  };
}

function allSnapshot() {
  return {
    files: filesBelow(process.cwd()),
    before: () => null,
    after: (file) => fileText(file),
  };
}

function parseConfig(text, label, messages) {
  if (text === null) return null;
  try {
    return core.parseDesignConfig(text);
  } catch (error) {
    messages.push(["configuration-error", `${label}: ${error.message}`]);
    return undefined;
  }
}

function parseRegistry(snapshot, config, label, messages) {
  if (!config?.enabled) return null;
  const text = snapshot(config.registryPath);
  if (text === null) {
    messages.push(["registry-missing", `${label}: ${config.registryPath}`]);
    return undefined;
  }
  try {
    return core.parseRegistry(text);
  } catch (error) {
    messages.push(["registry-invalid", `${label}: ${error.message}`]);
    return undefined;
  }
}

function readKnownSources(snapshot, registry, messages) {
  const sources = {};
  for (const component of Object.values(registry.components)) {
    const source = snapshot(component.path);
    if (source === null) messages.push(["registered-source-unavailable", component.path]);
    else sources[component.path] = source;
  }
  return sources;
}

function addEntries(entries, messages) {
  for (const entry of entries) {
    const code = entry.code || String(entry);
    messages.push([code, entry.detail || ""]);
  }
}

function resultExit(messages) {
  let code = 0;
  for (const [type, detail] of messages) {
    print(type, detail);
    if (CONFIG_CODES.has(type)
      || type === "configuration-error"
      || type === "registry-missing"
      || type === "registry-invalid"
      || type === "design-system-removed"
      || type === "design-system-disabled") code = 2;
    else if (code !== 2) code = 1;
  }
  return code;
}

function run(snapshot, all) {
  const messages = [];
  const beforeDoc = snapshot.before(DESIGN_DOC);
  const afterDoc = snapshot.after(DESIGN_DOC);
  const beforeConfig = parseConfig(beforeDoc, "before design document", messages);
  const afterConfig = parseConfig(afterDoc, "after design document", messages);
  if (beforeConfig === undefined || afterConfig === undefined) return resultExit(messages);

  if (beforeConfig?.enabled && afterDoc === null) {
    messages.push(["design-system-removed", DESIGN_DOC]);
    return resultExit(messages);
  }
  if (beforeConfig?.enabled && !afterConfig?.enabled) {
    messages.push(["design-system-disabled", DESIGN_DOC]);
    return resultExit(messages);
  }
  if (!afterConfig?.enabled) return 0;

  const beforeRegistry = parseRegistry(snapshot.before, beforeConfig, "before registry", messages);
  const afterRegistry = parseRegistry(snapshot.after, afterConfig, "after registry", messages);
  if (beforeRegistry === undefined || afterRegistry === undefined) return resultExit(messages);

  const boundary = core.validateRegistryBoundary({ config: afterConfig, registry: afterRegistry });
  addEntries([...boundary.violations, ...boundary.errors], messages);
  if (beforeRegistry) addEntries(core.registryChanges(beforeRegistry, afterRegistry).errors, messages);

  const knownSources = readKnownSources(snapshot.after, afterRegistry, messages);
  if (messages.length) return resultExit(messages);

  const sourceFiles = new Set(snapshot.files);
  const checkedComponents = new Set();
  const inspect = (file) => {
    if (file === DESIGN_DOC || file === afterConfig.registryPath) return;
    const after = snapshot.after(file);
    if (after === null) return;
    const role = core.pathRole(file, afterConfig);
    if (role === "page") {
      const result = core.validatePage({
        file,
        before: all ? null : snapshot.before(file),
        after,
        config: afterConfig,
        registry: afterRegistry,
        knownSources,
        mode: all ? "full" : "incremental",
      });
      addEntries([...result.violations, ...result.errors], messages);
    } else if (role === "component") {
      checkedComponents.add(file);
      const result = core.validateComponent({ file, after, config: afterConfig, registry: afterRegistry, knownSources });
      addEntries([...result.violations, ...result.errors], messages);
    }
  };

  for (const file of sourceFiles) inspect(file);
  const changes = beforeRegistry ? core.registryChanges(beforeRegistry, afterRegistry) : { addedComponents: Object.keys(afterRegistry.components) };
  for (const id of changes.addedComponents) {
    const file = afterRegistry.components[id].path;
    if (!checkedComponents.has(file)) inspect(file);
  }

  for (const [id, component] of Object.entries(afterRegistry.components)) {
    if (checkedComponents.has(component.path)) continue;
    const result = core.validateComponent({
      file: component.path,
      after: knownSources[component.path],
      config: afterConfig,
      registry: afterRegistry,
      knownSources,
    });
    checkedComponents.add(component.path);
    addEntries([...result.violations, ...result.errors], messages);
  }
  return resultExit(messages);
}

function main(argv) {
  let snapshot;
  let all = false;
  if (!argv.length) snapshot = gitSnapshot("staged");
  else if (argv.length === 1 && argv[0] === "--all") {
    snapshot = allSnapshot();
    all = true;
  } else if (argv.length === 3 && argv[0] === "--range") snapshot = gitSnapshot("range", argv[1], argv[2]);
  else return usage();
  if (snapshot.error) {
    print("git-error", snapshot.error.trim());
    return 2;
  }
  return run(snapshot, all);
}

process.exitCode = main(process.argv.slice(2));
