import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allEvents, resetEvents } from "./db.ts";
import { claudeTurns, codexTurns, scanHistory, syncHistory } from "./history.ts";

const root = join(tmpdir(), `clocked-in-history-${process.pid}`);
afterEach(() => rmSync(root, { force: true, recursive: true }));

test("Codex rollout task markers become completed turns", () => {
  const turns = codexTurns([
    { type: "session_meta", payload: { meta: { id: "codex-session" } } },
    { timestamp: "2026-08-18T10:00:00.000Z", type: "event_msg", payload: { type: "task_started" } },
    {
      timestamp: "2026-08-18T10:02:30.000Z",
      type: "event_msg",
      payload: { type: "task_complete" },
    },
  ]);
  expect(turns).toEqual([
    {
      agent: "codex",
      session: "codex-session",
      start: 1_787_047_200_000,
      stop: 1_787_047_350_000,
      model: undefined,
      effort: undefined,
    },
  ]);
});

test("Claude history ignores tool results and waits for end_turn", () => {
  const turns = claudeTurns([
    {
      type: "user",
      sessionId: "claude-session",
      timestamp: "2026-08-18T10:00:00.000Z",
      message: { content: "fix it" },
    },
    {
      type: "assistant",
      timestamp: "2026-08-18T10:00:10.000Z",
      message: { stop_reason: "tool_use" },
    },
    {
      type: "user",
      timestamp: "2026-08-18T10:00:11.000Z",
      message: { content: [{ type: "tool_result" }] },
    },
    {
      type: "assistant",
      timestamp: "2026-08-18T10:01:00.000Z",
      message: { stop_reason: "end_turn", model: "claude-sonnet" },
    },
  ]);
  expect(turns).toEqual([
    {
      agent: "claude-code",
      session: "claude-session",
      start: 1_787_047_200_000,
      stop: 1_787_047_260_000,
      model: "claude-sonnet",
    },
  ]);
});

test("Claude history does not replace a prompt with an in-turn meta message", () => {
  const turns = claudeTurns([
    {
      type: "user",
      sessionId: "claude-session",
      timestamp: "2026-08-18T10:00:00.000Z",
      message: { content: "fix it" },
    },
    {
      type: "user",
      isMeta: true,
      timestamp: "2026-08-18T10:00:30.000Z",
      message: { content: "<system-reminder>tool finished</system-reminder>" },
    },
    {
      type: "assistant",
      timestamp: "2026-08-18T10:01:00.000Z",
      message: { stop_reason: "end_turn", model: "claude-sonnet" },
    },
  ]);
  expect(turns).toEqual([
    {
      agent: "claude-code",
      session: "claude-session",
      start: 1_787_047_200_000,
      stop: 1_787_047_260_000,
      model: "claude-sonnet",
    },
  ]);
});

test("Claude history ignores sidechain records that share the parent session", () => {
  const turns = claudeTurns([
    {
      type: "user",
      sessionId: "parent-session",
      timestamp: "2026-08-18T10:00:00.000Z",
      message: { content: "fix it" },
    },
    {
      type: "user",
      isSidechain: true,
      sessionId: "parent-session",
      timestamp: "2026-08-18T10:00:05.000Z",
      message: { content: "subagent task" },
    },
    {
      type: "assistant",
      isSidechain: true,
      sessionId: "parent-session",
      timestamp: "2026-08-18T10:00:30.000Z",
      message: { stop_reason: "end_turn", model: "claude-haiku" },
    },
    {
      type: "assistant",
      sessionId: "parent-session",
      timestamp: "2026-08-18T10:01:00.000Z",
      message: { stop_reason: "end_turn", model: "claude-sonnet" },
    },
  ]);
  expect(turns).toEqual([
    {
      agent: "claude-code",
      session: "parent-session",
      start: 1_787_047_200_000,
      stop: 1_787_047_260_000,
      model: "claude-sonnet",
    },
  ]);
});

test("history scan imports once and does not double-count a later sync", () => {
  const sessionDir = join(root, ".codex", "sessions", "2026", "08", "18");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "rollout.jsonl"),
    [
      JSON.stringify({ type: "session_meta", payload: { meta: { id: "codex-session" } } }),
      JSON.stringify({
        timestamp: "2026-08-18T10:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started" },
      }),
      JSON.stringify({
        timestamp: "2026-08-18T10:03:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      }),
    ].join("\n"),
  );
  const path = join(root, "clocked-in.db");
  expect(scanHistory(root)).toMatchObject({
    files: 1,
    turns: [{ agent: "codex", session: "codex-session" }],
  });
  expect(syncHistory(path, root)).toMatchObject({
    files: 1,
    found: 1,
    imported: 1,
    importedMs: 180_000,
  });
  expect(syncHistory(path, root)).toMatchObject({ imported: 0, importedMs: 0 });
  expect(allEvents(path)).toMatchObject([
    { kind: "start", source: "history", ts: 1_787_047_200_000 },
    { kind: "stop", source: "history", ts: 1_787_047_380_000 },
  ]);
  resetEvents(path, 1_787_047_380_001);
  expect(syncHistory(path, root)).toMatchObject({ imported: 0, importedMs: 0 });
  expect(allEvents(path)).toEqual([]);
});

test("history scan reads compressed Codex rollouts", () => {
  const sessionDir = join(root, ".codex", "archived_sessions", "2026", "08", "18");
  mkdirSync(sessionDir, { recursive: true });
  const rollout = [
    JSON.stringify({ type: "session_meta", payload: { session_id: "compressed-session" } }),
    JSON.stringify({
      timestamp: "2026-08-18T10:00:00.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    }),
    JSON.stringify({
      timestamp: "2026-08-18T10:01:00.000Z",
      type: "event_msg",
      payload: { type: "task_complete" },
    }),
  ].join("\n");
  writeFileSync(join(sessionDir, "rollout.jsonl.zst"), Bun.zstdCompressSync(rollout));
  expect(scanHistory(root)).toMatchObject({
    files: 1,
    turns: [{ agent: "codex", session: "compressed-session" }],
  });
});
