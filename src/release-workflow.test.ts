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

test("release builds every published target on a native runner", () => {
  // each asset must be produced on a matching OS runner (not cross-compiled)
  for (const [os, asset] of [
    ["macos-14", "clocked-in-darwin-arm64"],
    ["macos-13", "clocked-in-darwin-x64"],
    ["ubuntu-latest", "clocked-in-linux-x64"],
    ["ubuntu-24.04-arm", "clocked-in-linux-arm64"],
  ] as const) {
    expect(wf).toContain(os);
    expect(wf).toContain(asset);
  }
});

test("each built binary is smoke-tested (runs `share`, which loads native resvg)", () => {
  expect(wf).toContain("Smoke test");
  expect(wf).toMatch(/"\$bin" share|\/\$\{\{ matrix\.asset \}\} share|bin.* share/);
});

test("SHA256SUMS is generated over the collected artifacts and published", () => {
  expect(wf).toContain("sha256sum clocked-in-*");
  expect(wf).toContain("SHA256SUMS");
});
