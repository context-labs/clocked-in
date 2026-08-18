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

// asset name ↔ bun --compile target
const TARGETS = [
  ["clocked-in-linux-x64", "bun-linux-x64"],
  ["clocked-in-linux-arm64", "bun-linux-arm64"],
  ["clocked-in-darwin-x64", "bun-darwin-x64"],
  ["clocked-in-darwin-arm64", "bun-darwin-arm64"],
] as const;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`Building ${version} (${commit.slice(0, 12)}) → ${outDir}`);
const sums: string[] = [];
for (const [asset, target] of TARGETS) {
  const outfile = resolve(outDir, asset);
  const r = await Bun.build({
    entrypoints: [entry],
    compile: { target, outfile },
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
