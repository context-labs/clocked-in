// Version + provenance. VERSION/COMMIT are baked in at release-build time via
// Bun.build `define` (see scripts/build-release.ts); in dev they fall back so
// the CLI still runs from source.
export const VERSION: string = process.env.CLOCKED_IN_VERSION || "0.1.0";
export const COMMIT: string = process.env.CLOCKED_IN_COMMIT || "dev";
export const REPO = "context-labs/clocked-in";

/** True when running as a `bun build --compile` standalone binary (not under `bun`). */
export function isCompiledBinary(): boolean {
  return !process.execPath.endsWith("/bun") && !process.execPath.endsWith("\\bun.exe");
}

/** bun --compile target ↔ release asset name for the current platform. */
export function assetName(platform = process.platform, arch = process.arch): string | null {
  const os = platform === "linux" ? "linux" : platform === "darwin" ? "darwin" : null;
  const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  return os && cpu ? `clocked-in-${os}-${cpu}` : null;
}
