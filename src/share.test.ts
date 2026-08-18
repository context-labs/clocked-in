import { expect, test } from "bun:test";
import { computeStats } from "./stats.ts";
import { renderCardPng, tweetText } from "./share.ts";
import type { Event } from "./events.ts";

const events: Event[] = [
  { ts: 0, kind: "start", agent: "claude-code", session: "a" },
  { ts: 3_600_000, kind: "stop", agent: "claude-code", session: "a" }, // 1h
  { ts: 0, kind: "start", agent: "codex", session: "b" },
  { ts: 1_800_000, kind: "stop", agent: "codex", session: "b" }, // 30m
];

test("tweetText names the total and worst agent", () => {
  const t = tweetText(computeStats(events));
  expect(t).toContain("1h 30m");
  expect(t).toContain("claude-code was the worst");
  expect(t).toContain("clocked-in");
});

test("renderCardPng returns a real PNG buffer", () => {
  const png = renderCardPng(computeStats(events));
  expect(png.length).toBeGreaterThan(1000);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG magic
});
