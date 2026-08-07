import { join } from "node:path";
import { readJson } from "./fsutil.mjs";

const REQUIRED = ["name", "version", "description", "license", "keywords", "dependencies", "components"];

export function loadManifest(srcDir) {
  const m = readJson(join(srcDir, "manifest.src.json"));
  for (const k of REQUIRED) {
    if (!(k in m)) throw new Error("manifest.src.json 필수 키 누락: " + k);
  }
  if (!m.dependencies.claude) throw new Error("dependencies.claude 누락");
  return m;
}

export function claudePluginJson(m) {
  return {
    name: m.name,
    description: m.description,
    version: m.version,
    license: m.license,
    dependencies: m.dependencies.claude,
    keywords: m.keywords,
  };
}
