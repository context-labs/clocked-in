import { expect, test } from "bun:test";
import { fmtDuration, pairIntervals, type Event } from "./events.ts";

const ev = (ts: number, kind: "start" | "stop", session = "s1", agent = "claude-code"): Event => ({
  ts,
  kind,
  agent,
  session,
});

test("pairs each start with the next stop in same session", () => {
  expect(pairIntervals([ev(1000, "start"), ev(4000, "stop")])).toEqual([
    { agent: "claude-code", session: "s1", start: 1000, ms: 3000 },
  ]);
});

test("a new start before a stop replaces the pending one (interrupt)", () => {
  expect(pairIntervals([ev(1000, "start"), ev(2000, "start"), ev(5000, "stop")])).toEqual([
    { agent: "claude-code", session: "s1", start: 2000, ms: 3000 },
  ]);
});

test("sessions are tracked independently", () => {
  const out = pairIntervals([
    ev(1000, "start", "a"),
    ev(1500, "start", "b"),
    ev(2000, "stop", "a"),
    ev(4000, "stop", "b"),
  ]);
  expect(out.map((i) => i.ms).sort((x, y) => x - y)).toEqual([1000, 2500]);
});

test("a stop with no pending start is ignored", () => {
  expect(pairIntervals([ev(1000, "stop")])).toEqual([]);
});

test("fmtDuration scales s/m/h/d", () => {
  expect(fmtDuration(3000)).toBe("3s");
  expect(fmtDuration(90000)).toBe("1m 30s");
  expect(fmtDuration(3_660_000)).toBe("1h 1m");
  expect(fmtDuration(90_000_000)).toBe("1d 1h");
});
