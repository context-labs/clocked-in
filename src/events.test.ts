import { expect, test } from "bun:test";
import {
  fmtDuration,
  heatmap,
  pairIntervals,
  percentile,
  toolAction,
  toolIntervals,
  unionMs,
  type Event,
} from "./events.ts";

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

test("interval carries model/effort from the stop event", () => {
  const start: Event = { ts: 1000, kind: "start", agent: "claude-code", session: "s1" };
  const stop: Event = {
    ts: 4000,
    kind: "stop",
    agent: "claude-code",
    session: "s1",
    model: "claude-opus-4-8",
    effort: "high",
  };
  expect(pairIntervals([start, stop])).toEqual([
    {
      agent: "claude-code",
      session: "s1",
      start: 1000,
      ms: 3000,
      model: "claude-opus-4-8",
      effort: "high",
    },
  ]);
});

test("toolIntervals pairs by toolId and maps actions", () => {
  const evs: Event[] = [
    { ts: 0, kind: "tool_start", agent: "claude-code", session: "s", tool: "Bash", toolId: "t1" },
    { ts: 2000, kind: "tool_end", agent: "claude-code", session: "s", tool: "Bash", toolId: "t1" },
    {
      ts: 3000,
      kind: "tool_start",
      agent: "claude-code",
      session: "s",
      tool: "Edit",
      toolId: "t2",
    },
    { ts: 3500, kind: "tool_end", agent: "claude-code", session: "s", tool: "Edit", toolId: "t2" },
  ];
  const out = toolIntervals(evs);
  expect(out).toEqual([
    { agent: "claude-code", session: "s", tool: "Bash", action: "run", start: 0, ms: 2000 },
    { agent: "claude-code", session: "s", tool: "Edit", action: "edit", start: 3000, ms: 500 },
  ]);
});

test("toolIntervals falls back to session+tool stack when no toolId", () => {
  const evs: Event[] = [
    { ts: 0, kind: "tool_start", agent: "codex", session: "s", tool: "Read" },
    { ts: 1000, kind: "tool_end", agent: "codex", session: "s", tool: "Read" },
  ];
  expect(toolIntervals(evs)[0]).toMatchObject({ tool: "Read", action: "read", ms: 1000 });
});

test("unionMs counts overlapping time once (human wait)", () => {
  // two agents, each 1h, fully overlapping → 1h of human waiting, not 2h
  expect(
    unionMs([
      { start: 0, ms: 3_600_000 },
      { start: 0, ms: 3_600_000 },
    ]),
  ).toBe(3_600_000);
  // disjoint → summed
  expect(
    unionMs([
      { start: 0, ms: 1000 },
      { start: 5000, ms: 1000 },
    ]),
  ).toBe(2000);
  // partial overlap [0,3000] + [2000,5000] → [0,5000]
  expect(
    unionMs([
      { start: 0, ms: 3000 },
      { start: 2000, ms: 3000 },
    ]),
  ).toBe(5000);
});

test("toolAction categorizes tools", () => {
  expect(toolAction("Bash")).toBe("run");
  expect(toolAction("Edit")).toBe("edit");
  expect(toolAction("Grep")).toBe("search");
  expect(toolAction("Read")).toBe("read");
  expect(toolAction("Task")).toBe("subagent");
  expect(toolAction("mcp__linear__create")).toBe("mcp");
  expect(toolAction("WebFetch")).toBe("web");
});

test("fmtDuration scales s/m/h/d", () => {
  expect(fmtDuration(3000)).toBe("3s");
  expect(fmtDuration(90000)).toBe("1m 30s");
  expect(fmtDuration(3_660_000)).toBe("1h 1m");
  expect(fmtDuration(90_000_000)).toBe("1d 1h");
});

test("heatmap places days into the weekday×week grid (newest column = this week)", () => {
  const now = Date.parse("2026-08-18T12:00:00"); // a Tuesday (local)
  const midnight = (s: string) => new Date(Date.parse(s)).setHours(0, 0, 0, 0);
  const hm = heatmap(
    [
      { day: midnight("2026-08-18T00:00:00"), ms: 5000 }, // today (Tue), last column
      { day: midnight("2026-08-11T00:00:00"), ms: 2000 }, // a week earlier (Tue)
    ],
    now,
    4,
  );
  expect(hm.weeks).toBe(4);
  expect(hm.max).toBe(5000);
  const tue = new Date(now).getDay();
  expect(hm.grid[tue]![3]).toBe(5000); // this week
  expect(hm.grid[tue]![2]).toBe(2000); // last week
  expect(hm.grid[tue]![0]).toBe(0); // 3 weeks ago: empty
});

test("percentile is nearest-rank and handles empty/single", () => {
  expect(percentile([], 0.5)).toBe(0);
  expect(percentile([42], 0.9)).toBe(42);
  expect(percentile([10, 20, 30], 0.5)).toBe(20);
  expect(percentile([1000, 2000, 3000, 100000], 0.5)).toBe(3000); // resists the outlier vs mean
});
