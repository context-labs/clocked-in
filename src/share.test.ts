import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeStats } from "./stats.ts";
import { renderCardPng, share, tweetText } from "./share.ts";
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

test("renderCardPng returns a real PNG buffer (via embedded wasm + font)", async () => {
  const png = await renderCardPng(computeStats(events));
  expect(png.length).toBeGreaterThan(1000);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG magic
});

test("share tolerates missing opener and clipboard commands", async () => {
  const path = process.env.PATH;
  const out = join(tmpdir(), `clocked-in-share-${crypto.randomUUID()}.png`);
  try {
    process.env.PATH = "";
    const result = await share(events, { open: true, out });
    expect(result.url).toStartWith("https://twitter.com/intent/tweet");
    await Bun.sleep(0);
  } finally {
    process.env.PATH = path;
    rmSync(out, { force: true });
  }
});
