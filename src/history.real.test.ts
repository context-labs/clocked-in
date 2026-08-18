import { expect, test } from "bun:test";
import { claudeTurns, codexTurns } from "./history.ts";

// These fixtures mirror the ACTUAL record shapes found on disk (content
// redacted): Claude `~/.claude/projects/*.jsonl` and Codex
// `~/.codex/sessions/**/rollout-*.jsonl`. Verified by running the parsers over
// real files — claudeTurns produced 236 turns (all with model), codexTurns 34
// (all with model + effort), zero negative durations. These lock the shapes in.

test("Claude: real transcript shape → one turn with model + effort, noise ignored", () => {
  // One real prompt→end_turn turn buried in the record types Claude actually
  // writes: queue-operation, attachment, tool_use assistant, tool_result user,
  // an isMeta system-reminder user, and a sidechain sub-agent turn.
  const records = [
    {
      type: "queue-operation",
      operation: "add",
      timestamp: "2026-08-15T06:43:38.952Z",
      sessionId: "s",
      content: "…",
    },
    {
      type: "user",
      isSidechain: false,
      promptId: "p1",
      message: { role: "user", content: "…prompt…" },
      uuid: "u1",
      timestamp: "2026-08-15T06:43:39.000Z",
      permissionMode: "default",
      promptSource: "user",
      userType: "external",
      cwd: "/repo",
      sessionId: "s",
      version: "2.1.0",
      gitBranch: "main",
    },
    {
      type: "attachment",
      isSidechain: false,
      attachment: {},
      timestamp: "2026-08-15T06:43:39.001Z",
      sessionId: "s",
    },
    {
      type: "assistant",
      isSidechain: false,
      requestId: "r1",
      message: {
        model: "claude-sonnet-5",
        id: "m1",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use" }],
        stop_reason: "tool_use",
        usage: {},
      },
      effort: "high",
      timestamp: "2026-08-15T06:43:42.000Z",
      sessionId: "s",
    },
    {
      type: "user",
      isSidechain: false,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] },
      toolUseResult: {},
      timestamp: "2026-08-15T06:43:43.000Z",
      sessionId: "s",
    },
    {
      type: "user",
      isMeta: true,
      message: { role: "user", content: "<system-reminder>…</system-reminder>" },
      timestamp: "2026-08-15T06:43:44.000Z",
      sessionId: "s",
    },
    // a sub-agent (sidechain) turn reusing the parent session id — must be skipped
    {
      type: "assistant",
      isSidechain: true,
      message: { model: "claude-haiku-4-5", stop_reason: "end_turn" },
      effort: "low",
      timestamp: "2026-08-15T06:43:45.000Z",
      sessionId: "s",
    },
    {
      type: "assistant",
      isSidechain: false,
      requestId: "r2",
      message: {
        model: "claude-sonnet-5",
        type: "message",
        role: "assistant",
        content: [{ type: "text" }],
        stop_reason: "end_turn",
        usage: {},
      },
      effort: "high",
      timestamp: "2026-08-15T06:43:46.453Z",
      sessionId: "s",
    },
    { type: "last-prompt", lastPrompt: "…", leafUuid: "u9", sessionId: "s" },
  ];
  expect(claudeTurns(records, "x.jsonl")).toEqual([
    {
      agent: "claude-code",
      session: "s",
      start: Date.parse("2026-08-15T06:43:39.000Z"),
      stop: Date.parse("2026-08-15T06:43:46.453Z"),
      model: "claude-sonnet-5",
      effort: "high",
    },
  ]);
});

test("Codex: real rollout shape → one turn with model + effort from turn_context, noise ignored", () => {
  const records = [
    { type: "session_meta", payload: { meta: { id: "019ff941-f77f-70e0" } } },
    {
      type: "turn_context",
      payload: {
        turn_id: "82da3706",
        cwd: "/repo",
        model: "gpt-5.6-terra",
        effort: "xhigh",
        collaboration_mode: { settings: { model: "gpt-5.6-terra", reasoning_effort: "xhigh" } },
      },
    },
    { type: "event_msg", timestamp: "2026-08-13T03:55:03.414Z", payload: { type: "task_started" } },
    { type: "response_item", payload: { type: "message" } }, // noise
    {
      type: "event_msg",
      timestamp: "2026-08-13T03:55:10.000Z",
      payload: { type: "item_completed" },
    }, // noise
    {
      type: "event_msg",
      timestamp: "2026-08-13T03:55:11.000Z",
      payload: { type: "token_count", info: {} },
    }, // noise
    {
      type: "event_msg",
      timestamp: "2026-08-13T03:57:33.000Z",
      payload: { type: "task_complete" },
    },
  ];
  expect(codexTurns(records, "rollout.jsonl")).toEqual([
    {
      agent: "codex",
      session: "019ff941-f77f-70e0",
      start: Date.parse("2026-08-13T03:55:03.414Z"),
      stop: Date.parse("2026-08-13T03:57:33.000Z"),
      model: "gpt-5.6-terra",
      effort: "xhigh",
    },
  ]);
});

test("Codex: reasoning_effort inside turn_context payload is picked up when effort is absent", () => {
  const records = [
    { type: "turn_context", payload: { model: "gpt-5.6-terra", reasoning_effort: "high" } },
    { type: "event_msg", timestamp: "2026-08-13T03:55:00.000Z", payload: { type: "turn_started" } },
    {
      type: "event_msg",
      timestamp: "2026-08-13T03:55:20.000Z",
      payload: { type: "turn_complete" },
    },
  ];
  expect(codexTurns(records, "r.jsonl")[0]).toMatchObject({
    model: "gpt-5.6-terra",
    effort: "high",
  });
});
