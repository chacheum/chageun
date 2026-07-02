import { rmSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, claudePluginJson } from "../lib/manifest.mjs";
import { copyTree, writeJson } from "../lib/fsutil.mjs";

export function buildClaude(srcDir, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const m = loadManifest(srcDir);

  // 매니페스트
  writeJson(join(outDir, ".claude-plugin", "plugin.json"), claudePluginJson(m));
  cpSync(join(srcDir, "marketplace.claude.json"), join(outDir, ".claude-plugin", "marketplace.json"));

  // 훅 (Claude 형식 그대로)
  mkdirSync(join(outDir, "hooks"), { recursive: true });
  cpSync(join(srcDir, "hooks", "hooks.claude.json"), join(outDir, "hooks", "hooks.json"));
  for (const f of m.components.hooks) cpSync(join(srcDir, "hooks", f), join(outDir, "hooks", f));

  // 콘텐츠 디렉터리
  for (const d of ["rules", "skills", "agents", "assets", "scripts"]) copyTree(join(srcDir, d), join(outDir, d));

  // 루트 파일
  cpSync(join(srcDir, "README.md"), join(outDir, "README.md"));
  cpSync(join(srcDir, "LICENSE"), join(outDir, "LICENSE"));
}
