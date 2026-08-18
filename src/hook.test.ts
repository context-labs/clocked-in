import { expect, test } from "bun:test";
import { metaFromTranscript, resolveEvent } from "./hook.ts";

const NOW = 1234;

test("snake_case (Claude/Codex) stdin", () => {
  const e = resolveEvent("start", { agent: "codex" }, { session_id: "abc", cwd: "/p" }, {}, NOW);
  expect(e).toEqual({ ts: NOW, kind: "start", agent: "codex", session: "abc", cwd: "/p" });
});

test("camelCase (Grok) stdin", () => {
  const e = resolveEvent("stop", { agent: "grok" }, { sessionId: "g1" }, {}, NOW);
  expect(e).toMatchObject({ kind: "stop", agent: "grok", session: "g1" });
});

test("env fallback for session", () => {
  const e = resolveEvent("start", {}, {}, { GROK_SESSION_ID: "envses" }, NOW);
  expect(e.session).toBe("envses");
});

test("explicit flag beats stdin", () => {
  expect(resolveEvent("start", { session: "flag" }, { session_id: "std" }, {}, NOW).session).toBe(
    "flag",
  );
});

test("empty everything → sane defaults", () => {
  const e = resolveEvent("start", {}, {}, {}, NOW);
  expect(e).toMatchObject({ agent: "claude-code", session: "unknown" });
});

test("model/effort from stdin (Codex-style) beats transcript meta", () => {
  const e = resolveEvent(
    "stop",
    {},
    { model: "gpt-5.6-terra", reasoning_effort: "xhigh" },
    {},
    NOW,
    { model: "other", effort: "low" },
  );
  expect(e).toMatchObject({ model: "gpt-5.6-terra", effort: "xhigh" });
});

test("model/effort fall back to transcript meta when stdin lacks them", () => {
  const e = resolveEvent("stop", {}, {}, {}, NOW, { model: "claude-opus-4-8", effort: "high" });
  expect(e).toMatchObject({ model: "claude-opus-4-8", effort: "high" });
});

test("metaFromTranscript reads last assistant model + effort (Claude shape)", () => {
  const lines = [
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-4", role: "assistant" },
      effort: "medium",
    }),
    "not json",
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-8", role: "assistant" },
      effort: "high",
    }),
  ];
  expect(metaFromTranscript(lines)).toEqual({ model: "claude-opus-4-8", effort: "high" });
});

test("metaFromTranscript handles generic top-level model / reasoning_effort", () => {
  const lines = [JSON.stringify({ model: "grok-4.6", reasoning_effort: "high" })];
  expect(metaFromTranscript(lines)).toEqual({ model: "grok-4.6", effort: "high" });
});
