// Cross-compile standalone binaries for every supported platform, bake in the
// version + commit, and emit SHA256SUMS. Run by CI on a tag (scripts pass
// CLOCKED_IN_VERSION / CLOCKED_IN_COMMIT); falls back to git locally.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "dist/release");
const entry = resolve(root, "src/cli.tsx");
const stub = resolve(import.meta.dir, "stub-empty.js");

const pkgVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const gitHead = () => {
  const p = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
  return p.success ? p.stdout.toString().trim() : "";
};
const version = process.env.CLOCKED_IN_VERSION || `v${pkgVersion}`;
const commit = process.env.CLOCKED_IN_COMMIT || gitHead() || "dev";

// asset name ↔ bun --compile target. NOTE: @resvg/resvg-js is a per-platform
// native addon, so a target MUST be built on a host of that platform (its
// prebuilt is only installed there). CI uses a matrix of native runners and
// passes CLOCKED_IN_TARGET/CLOCKED_IN_ASSET to build exactly one. With neither
// set we build all four locally — a convenience that only produces a working
// binary for the host's own platform; the others are for smoke-checking layout.
const ALL_TARGETS = [
  ["clocked-in-linux-x64", "bun-linux-x64"],
  ["clocked-in-linux-arm64", "bun-linux-arm64"],
  ["clocked-in-darwin-x64", "bun-darwin-x64"],
  ["clocked-in-darwin-arm64", "bun-darwin-arm64"],
] as const;
const oneAsset = process.env.CLOCKED_IN_ASSET;
const oneTarget = process.env.CLOCKED_IN_TARGET;
const TARGETS: readonly (readonly [string, string])[] =
  oneAsset && oneTarget ? [[oneAsset, oneTarget]] : ALL_TARGETS;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`Building ${version} (${commit.slice(0, 12)}) → ${outDir}`);
const sums: string[] = [];
for (const [asset, target] of TARGETS) {
  const outfile = resolve(outDir, asset);
  const r = await Bun.build({
    entrypoints: [entry],
    compile: { target: target as "bun-linux-x64", outfile }, // validated bun --compile target string
    minify: true,
    define: {
      "process.env.CLOCKED_IN_VERSION": JSON.stringify(version),
      "process.env.CLOCKED_IN_COMMIT": JSON.stringify(commit),
    },
    plugins: [
      {
        name: "stub-devtools",
        setup(b) {
          b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: stub }));
        },
      },
    ],
  });
  if (!r.success) {
    for (const l of r.logs) console.error(String(l));
    process.exit(1);
  }
  const hash = createHash("sha256").update(readFileSync(outfile)).digest("hex");
  sums.push(`${hash}  ${asset}`);
  console.log(`✓ ${asset}  ${hash.slice(0, 16)}…`);
}

writeFileSync(resolve(outDir, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`✓ SHA256SUMS (${sums.length} binaries)`);
