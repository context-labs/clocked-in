import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression guard for the macOS-binary crash (v0.1.1): binaries were
// cross-compiled on a single Linux host, so the per-platform native addon
// @resvg/resvg-js couldn't be embedded and the darwin binaries crashed with
// "Cannot require module @resvg/resvg-js-darwin-arm64". The fix is a matrix that
// builds each binary on a runner of its OWN platform and smoke-tests it. If
// someone reverts to single-host cross-compilation, this fails.
const wf = readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");

test("release builds all four published targets", () => {
  for (const asset of [
    "clocked-in-darwin-arm64",
    "clocked-in-darwin-x64",
    "clocked-in-linux-x64",
    "clocked-in-linux-arm64",
  ]) {
    expect(wf).toContain(asset);
  }
});

test("darwin-arm64 (the common Mac) is built + smoke-tested on a native macOS runner", () => {
  // guards against regressing to a Linux-only build of the Mac binary
  expect(wf).toContain("macos-14");
  expect(wf).toMatch(/macos-14[\s\S]*bun-darwin-arm64[\s\S]*smoke: true/);
});

test("each binary is smoke-tested for `share` on a clean machine (no node_modules)", () => {
  expect(wf).toContain("Smoke test");
  expect(wf).toContain('"$bin" share'); // runs the render path that embeds wasm+font
  // must run OUTSIDE the repo so node_modules can't mask an un-embedded asset
  expect(wf).toMatch(/cp "dist\/release[\s\S]*cd "\$RUNNER_TEMP"/);
});

test("SHA256SUMS is generated over the collected artifacts and published", () => {
  expect(wf).toContain("sha256sum clocked-in-*");
  expect(wf).toContain("SHA256SUMS");
});
