import { expect, test } from "bun:test";
import type { Event } from "./events.ts";
import { computeStats } from "./stats.ts";

const turn = (
  agent: string,
  session: string,
  start: number,
  ms: number,
  model?: string,
  effort?: string,
): Event[] => [
  { ts: start, kind: "start", agent, session },
  { ts: start + ms, kind: "stop", agent, session, model, effort },
];

test("byModel groups per harness → model → effort", () => {
  const events = [
    ...turn("claude-code", "a", 0, 3_600_000, "claude-opus-4-8", "high"),
    ...turn("claude-code", "b", 10, 1_800_000, "claude-opus-4-8", "high"), // same bucket
    ...turn("claude-code", "c", 20, 600_000, "claude-sonnet-4", "medium"),
    ...turn("codex", "d", 30, 1_200_000, "gpt-5.6-terra", "xhigh"),
  ];
  const s = computeStats(events);
  const opusHigh = s.byModel.find((m) => m.model === "claude-opus-4-8" && m.effort === "high");
  expect(opusHigh).toMatchObject({ agent: "claude-code", turns: 2, ms: 5_400_000 });
  expect(s.byModel[0]!.model).toBe("claude-opus-4-8"); // sorted desc by ms
  expect(s.byModel.map((m) => m.agent)).toContain("codex");
});

test("missing model/effort bucket as unknown / —", () => {
  const s = computeStats(turn("grok", "x", 0, 5000));
  expect(s.byModel[0]).toMatchObject({ agent: "grok", model: "unknown", effort: "—" });
});

test("humanWaitMs dedupes concurrent agents; totalMs sums them", () => {
  // two agents both wait 0..1h → agent-time 2h, human wait 1h
  const events = [...turn("claude-code", "a", 0, 3_600_000), ...turn("codex", "b", 0, 3_600_000)];
  const s = computeStats(events);
  expect(s.totalMs).toBe(7_200_000);
  expect(s.humanWaitMs).toBe(3_600_000);
});

test("byTool and byAction aggregate tool intervals", () => {
  const events: Event[] = [
    { ts: 0, kind: "tool_start", agent: "claude-code", session: "s", tool: "Bash", toolId: "1" },
    { ts: 3000, kind: "tool_end", agent: "claude-code", session: "s", tool: "Bash", toolId: "1" },
    { ts: 4000, kind: "tool_start", agent: "claude-code", session: "s", tool: "Bash", toolId: "2" },
    { ts: 5000, kind: "tool_end", agent: "claude-code", session: "s", tool: "Bash", toolId: "2" },
    { ts: 6000, kind: "tool_start", agent: "claude-code", session: "s", tool: "Read", toolId: "3" },
    { ts: 6500, kind: "tool_end", agent: "claude-code", session: "s", tool: "Read", toolId: "3" },
  ];
  const s = computeStats(events);
  expect(s.byTool[0]).toEqual({ tool: "Bash", action: "run", ms: 4000, count: 2 });
  expect(s.byAction.find((a) => a.action === "run")).toEqual({ action: "run", ms: 4000, count: 2 });
  expect(s.byAction.find((a) => a.action === "read")).toEqual({
    action: "read",
    ms: 500,
    count: 1,
  });
});

test("since cutoff (clocked-in start) shows only turns from the session onward", () => {
  const events: Event[] = [
    { ts: 1000, kind: "start", agent: "claude-code", session: "old" },
    { ts: 5000, kind: "stop", agent: "claude-code", session: "old" }, // before session
    { ts: 20000, kind: "start", agent: "codex", session: "new" },
    { ts: 26000, kind: "stop", agent: "codex", session: "new" }, // after session start (10000)
  ];
  const s = computeStats(events, { since: 10000, now: 30000 });
  expect(s.turns).toBe(1);
  expect(s.totalMs).toBe(6000);
  expect(s.byAgent).toEqual([{ agent: "codex", ms: 6000, turns: 1 }]);
});
