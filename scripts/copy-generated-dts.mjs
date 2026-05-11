#!/usr/bin/env node
// Copy declaration-only files from src/component/_generated/ into
// dist/component/_generated/. tsc treats *.d.ts inputs as type-only and does
// not re-emit them, so dataModel.d.ts and our hand-authored component.d.ts
// would otherwise be missing from the published tarball.

import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "component", "_generated");
const dstDir = join(here, "..", "dist", "component", "_generated");

await mkdir(dstDir, { recursive: true });
const entries = await readdir(srcDir);
const copied = [];
for (const name of entries) {
  if (!name.endsWith(".d.ts")) continue;
  await copyFile(join(srcDir, name), join(dstDir, name));
  copied.push(name);
}

if (copied.length === 0) {
  console.error(
    "copy-generated-dts: no .d.ts files found in",
    srcDir,
    "— did codegen run?",
  );
  process.exit(1);
}
console.log("copy-generated-dts: copied", copied.join(", "));
