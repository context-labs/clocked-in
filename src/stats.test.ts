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
