import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allEvents, insertEvent, resetEvents } from "./db.ts";

const path = join(tmpdir(), `clocked-in-test-${process.pid}.db`);
afterAll(() => rmSync(path, { force: true }));

test("insert then read round-trips, ordered by ts", () => {
  insertEvent({ ts: 200, kind: "stop", agent: "codex", session: "x" }, path);
  insertEvent({ ts: 100, kind: "start", agent: "codex", session: "x", cwd: "/p" }, path);
  const rows = allEvents(path);
  expect(rows.map((r) => r.ts)).toEqual([100, 200]);
  expect(rows[0]).toMatchObject({ kind: "start", agent: "codex", session: "x", cwd: "/p" });
});

test("reset clears events", () => {
  resetEvents(path);
  expect(allEvents(path)).toEqual([]);
});
