// Bundle the CLI into a single file so distribution never hits duplicate-React
// (Ink's reconciler + our components must share one React instance). Native
// modules stay external — they can't be bundled and are real runtime deps.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outfile = resolve(import.meta.dir, "../dist/cli.js");

const stub = resolve(import.meta.dir, "stub-empty.js");

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "../src/cli.tsx")],
  outdir: resolve(import.meta.dir, "../dist"),
  target: "bun",
  // bun:sqlite is a builtin; resvg is a native addon — keep them external.
  external: ["@resvg/resvg-js"],
  // react-devtools-core is a dev-only import inside Ink (used only when DEV=true)
  // but sits in the module graph. Stub it so prod never needs the package.
  plugins: [
    {
      name: "stub-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: stub }));
      },
    },
  ],
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Shebang must be line 1 (bun's `banner` lands after its own preamble), so prepend.
const SHEBANG = "#!/usr/bin/env bun\n";
const code = readFileSync(outfile, "utf8");
if (!code.startsWith(SHEBANG)) writeFileSync(outfile, SHEBANG + code);
chmodSync(outfile, 0o755);
console.log(`✓ built ${outfile}`);
