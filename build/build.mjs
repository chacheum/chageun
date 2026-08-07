import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaude } from "./adapters/claude.mjs";
import { listTree } from "./lib/fsutil.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

buildClaude(SRC, join(DIST, "claude"));
console.log(`빌드 완료: dist/claude (${listTree(join(DIST,"claude")).length}개)`);
