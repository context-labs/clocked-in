import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// install.sh runs under whatever /bin/sh a user has — notably macOS bash 3.2,
// where a multibyte char (e.g. `…`) directly after a `$VAR` gets slurped into
// the variable name and fails under `set -u` (real bug report). Keeping the
// installer pure ASCII sidesteps every locale/shell quirk of this kind.
test("install.sh is pure ASCII", () => {
  const src = readFileSync(resolve(import.meta.dir, "../install.sh"), "utf8");
  const offenders = [...src.matchAll(/[^\x00-\x7F]/g)].map((m) => ({ index: m.index, char: m[0] }));
  expect(offenders).toEqual([]);
});

test("install.sh sets strict mode and verifies the checksum", () => {
  const src = readFileSync(resolve(import.meta.dir, "../install.sh"), "utf8");
  expect(src).toContain("set -eu");
  expect(src).toContain("CHECKSUM MISMATCH");
});
