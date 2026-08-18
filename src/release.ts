import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assetName, COMMIT, isCompiledBinary, REPO, VERSION } from "./version.ts";

export const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

type Release = { tag: string; assets: Map<string, string> }; // name -> browser_download_url

async function fetchLatestRelease(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { "User-Agent": "clocked-in", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} — could not fetch the latest release.`);
  const json = (await res.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  return {
    tag: json.tag_name,
    assets: new Map(json.assets.map((a) => [a.name, a.browser_download_url])),
  };
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": "clocked-in" }, redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Is `latest` a strictly newer release than `current`? Refuses to treat an
// unparseable or older/equal tag as an upgrade, so `update` can never silently
// downgrade (GitHub's "latest" is most-recently-published, not highest version).
export function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => {
    const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])] as const, pre: m[4] } : null;
  };
  const c = parse(current);
  const l = parse(latest);
  if (!c || !l) return false; // unknown format → never auto-replace
  for (let i = 0; i < 3; i++) if (l.nums[i] !== c.nums[i]) return l.nums[i]! > c.nums[i]!;
  return Boolean(c.pre && !l.pre); // same X.Y.Z: a final release beats a prerelease
}

// SHA256SUMS is the standard `<hex>  <filename>` format (two spaces).
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}

/** `clocked-in version` — full provenance so a user can verify what they run. */
export function printVersion(): void {
  const asset = assetName();
  console.log(`clocked-in ${VERSION}`);
  console.log(`  commit:   ${COMMIT}`);
  console.log(`  source:   https://github.com/${REPO}/tree/${COMMIT}`);
  console.log(`  platform: ${process.platform}/${process.arch}${asset ? ` (${asset})` : ""}`);
  if (isCompiledBinary()) {
    const hash = sha256(readFileSync(process.execPath));
    console.log(`  this binary sha256:`);
    console.log(`    ${hash}`);
    console.log(`  verify it matches the published checksum for ${asset}:`);
    console.log(`    https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS`);
  } else {
    console.log(`  (running under bun from source/npm — not a released binary)`);
  }
}

/** `clocked-in update` — download the latest release, verify its checksum, replace self. */
export async function runUpdate(): Promise<void> {
  if (!isCompiledBinary()) {
    console.log("update applies to the standalone binary only. You're running under bun —");
    console.log(
      "update with your installer instead (e.g. `git pull` or `bun install -g github:" +
        REPO +
        "#main`).",
    );
    return;
  }
  const asset = assetName();
  if (!asset) throw new Error(`unsupported platform: ${process.platform}/${process.arch}`);

  console.log("Checking for the latest release…");
  const rel = await fetchLatestRelease();
  if (!isNewer(VERSION, rel.tag)) {
    console.log(`You're on ${VERSION}; latest published is ${rel.tag}. Nothing to update.`);
    return;
  }
  const binUrl = rel.assets.get(asset);
  const sumsUrl = rel.assets.get("SHA256SUMS");
  if (!binUrl || !sumsUrl) throw new Error(`release ${rel.tag} has no asset for ${asset}.`);

  console.log(`Updating ${VERSION} → ${rel.tag} (${asset})…`);
  const [bin, sumsBuf] = await Promise.all([download(binUrl), download(sumsUrl)]);
  const expected = parseSums(sumsBuf.toString("utf8")).get(asset);
  const actual = sha256(bin);
  if (!expected) throw new Error(`SHA256SUMS has no entry for ${asset}.`);
  if (expected !== actual)
    throw new Error(
      `checksum mismatch for ${asset}!\n  expected ${expected}\n  got      ${actual}\nAborting — the download does not match the published checksum.`,
    );
  console.log(`✓ checksum verified: ${actual}`);

  // Atomic replace: write beside the current binary, then rename over it.
  const dst = process.execPath;
  const tmp = join(dirname(dst), `.clocked-in.update.${process.pid}`);
  try {
    writeFileSync(tmp, bin);
    chmodSync(tmp, 0o755);
    renameSync(tmp, dst);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EACCES" || err.code === "EPERM") {
      throw new Error(
        `no permission to replace ${dst}. Re-run with sudo, or reinstall:\n  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh`,
      );
    }
    throw e;
  }
  console.log(`✓ updated to ${rel.tag}. Run \`clocked-in version\` to confirm.`);
}
