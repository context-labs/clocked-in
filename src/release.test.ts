import { expect, test } from "bun:test";
import { isNewer, parseSums, sha256 } from "./release.ts";
import { assetName, isCompiledBinary } from "./version.ts";

test("isNewer only upgrades to a strictly newer semver (never downgrades)", () => {
  expect(isNewer("v0.1.0", "v0.1.1")).toBe(true);
  expect(isNewer("v0.1.0", "v1.0.0")).toBe(true);
  expect(isNewer("v2.0.0", "v1.9.3")).toBe(false); // the downgrade codex flagged
  expect(isNewer("v0.1.0", "v0.1.0")).toBe(false); // equal
  expect(isNewer("v1.2.0-rc.1", "v1.2.0")).toBe(true); // release beats its prerelease
  expect(isNewer("v1.2.0", "v1.2.0-rc.2")).toBe(false); // prerelease isn't newer
  expect(isNewer("v0.1.0", "nightly")).toBe(false); // unparseable → refuse
});

test("sha256 is stable and correct", () => {
  expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("parseSums reads the standard `<hex>  <file>` format", () => {
  const text =
    "790b7055f506ddebbf5229a458d81ff7ed9f63d9903b8fc1107a85c3baaea23e  clocked-in-linux-x64\n" +
    "db8a4f617698e844cc5b3b624745e7e4daace3f85cb2ad34cb06db36b74f37ed  clocked-in-darwin-x64\n";
  const m = parseSums(text);
  expect(m.get("clocked-in-linux-x64")).toBe(
    "790b7055f506ddebbf5229a458d81ff7ed9f63d9903b8fc1107a85c3baaea23e",
  );
  expect(m.size).toBe(2);
});

test("parseSums tolerates the `*` binary marker and blank lines", () => {
  const m = parseSums("\n" + "aa".repeat(32) + " *clocked-in-linux-arm64\n\n");
  expect(m.get("clocked-in-linux-arm64")).toBe("aa".repeat(32));
});

test("assetName maps platform+arch to the release asset", () => {
  expect(assetName("linux", "x64")).toBe("clocked-in-linux-x64");
  expect(assetName("darwin", "arm64")).toBe("clocked-in-darwin-arm64");
  expect(assetName("win32", "x64")).toBeNull();
});

test("isCompiledBinary is false under bun (tests run under bun)", () => {
  expect(isCompiledBinary()).toBe(false);
});
