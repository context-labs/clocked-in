import { expect, test } from "bun:test";
import { claudeTurns, codexTurns } from "./history.ts";

// Fixtures mirror the ACTUAL record shapes on disk (content redacted): Claude
// `~/.claude/projects/*.jsonl` and Codex `~/.codex/sessions/**/rollout-*.jsonl`.
// Verified by running the parsers over real files — claudeTurns produced 236
// turns (all with model), codexTurns 34 (all model+effort), zero negative
// durations, and tool calls were extracted with correct names/durations.

test("Claude: real transcript shape → turn with model, effort, and tool call", () => {
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
      promptSource: "user",
      userType: "external",
      cwd: "/repo",
      sessionId: "s",
    },
    {
      type: "attachment",
      isSidechain: false,
      attachment: {},
      timestamp: "2026-08-15T06:43:39.001Z",
      sessionId: "s",
    },
    // assistant emits a tool_use (Read); the matching tool_result closes it.
    {
      type: "assistant",
      isSidechain: false,
      requestId: "r1",
      message: {
        model: "claude-sonnet-5",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
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
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "…" }],
      },
      toolUseResult: {},
      timestamp: "2026-08-15T06:43:45.000Z",
      sessionId: "s",
    },
    // an in-turn system-reminder (isMeta) must NOT reset the start
    {
      type: "user",
      isMeta: true,
      message: { role: "user", content: "<system-reminder>…</system-reminder>" },
      timestamp: "2026-08-15T06:43:45.500Z",
      sessionId: "s",
    },
    // a sub-agent (sidechain) turn reusing the session id — skipped
    {
      type: "assistant",
      isSidechain: true,
      message: { model: "claude-haiku-4-5", stop_reason: "end_turn" },
      effort: "low",
      timestamp: "2026-08-15T06:43:45.900Z",
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
      tools: [
        { tool: "Read", start: Date.parse("2026-08-15T06:43:42.000Z"), ms: 3000, id: "toolu_1" },
      ],
    },
  ]);
});

test("Codex: real rollout shape → turn with model, effort, and a CommandExecution tool", () => {
  const t0 = Date.parse("2026-08-13T03:55:03.414Z");
  const records = [
    { type: "session_meta", payload: { meta: { id: "019ff941-f77f-70e0" } } },
    {
      type: "turn_context",
      payload: {
        turn_id: "82da3706",
        cwd: "/repo",
        model: "gpt-5.6-terra",
        effort: "xhigh",
        collaboration_mode: { settings: { reasoning_effort: "xhigh" } },
      },
    },
    { type: "event_msg", timestamp: "2026-08-13T03:55:03.414Z", payload: { type: "task_started" } },
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        started_at_ms: t0 + 1000,
        completed_at_ms: t0 + 5000,
        item: { type: "CommandExecution", id: "c1", command: ["zsh", "-lc", "pwd"] },
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        started_at_ms: t0 + 6000,
        completed_at_ms: t0 + 6500,
        item: { type: "FileChange", id: "f1" },
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        started_at_ms: t0 + 7000,
        completed_at_ms: t0 + 7100,
        item: { type: "Reasoning", id: "x" },
      },
    }, // not a tool
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
      start: t0,
      stop: Date.parse("2026-08-13T03:57:33.000Z"),
      model: "gpt-5.6-terra",
      effort: "xhigh",
      tools: [
        { tool: "shell", start: t0 + 1000, ms: 4000, id: "c1-0" },
        { tool: "apply_patch", start: t0 + 6000, ms: 500, id: "f1-1" },
      ],
    },
  ]);
});

test("Codex: reasoning_effort inside turn_context is used when effort is absent", () => {
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
