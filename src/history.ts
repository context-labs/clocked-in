import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { allEvents, historyResetAt, insertEvents } from "./db.ts";
import { pairIntervals, type Event, type Interval } from "./events.ts";

export type HistoryTurn = {
  agent: "claude-code" | "codex";
  session: string;
  start: number;
  stop: number;
  model?: string;
  effort?: string;
};

export type HistoryScan = {
  files: number;
  turns: HistoryTurn[];
};

export type HistorySync = {
  files: number;
  found: number;
  imported: number;
  importedMs: number;
};

type HistoryRecord = Record<string, any>;

const MATCH_TOLERANCE_MS = 5_000;

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jsonLines(path: string): HistoryRecord[] {
  try {
    const contents = readFileSync(path);
    const text = path.endsWith(".zst")
      ? Bun.zstdDecompressSync(contents).toString("utf8")
      : contents.toString("utf8");
    return text.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const record = JSON.parse(line);
        return record && typeof record === "object" ? [record] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function jsonlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files = new Map<string, string>();
  const visit = (dir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.set(path, path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl.zst") && !files.has(path.slice(0, -4)))
        files.set(path.slice(0, -4), path);
    }
  };
  visit(root);
  return [...files.values()];
}

function sessionFrom(records: HistoryRecord[], path: string): string {
  for (const record of records) {
    const payload = record.payload as HistoryRecord | undefined;
    const meta = payload?.meta as HistoryRecord | undefined;
    const id = record.sessionId ?? record.session_id ?? payload?.session_id ?? meta?.id;
    if (typeof id === "string" && id) return id;
  }
  return basename(path, ".jsonl");
}

/** Parse completed Codex turns from a persisted rollout JSONL file. */
export function codexTurns(records: HistoryRecord[], path = "session.jsonl"): HistoryTurn[] {
  const session = sessionFrom(records, path);
  let pending: number | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  const turns: HistoryTurn[] = [];

  for (const record of records) {
    const at = timestamp(record.timestamp);
    const payload = record.payload as HistoryRecord | undefined;
    const type = record.type === "event_msg" ? payload?.type : undefined;
    if (record.type === "turn_context") {
      if (typeof payload?.model === "string") model = payload.model;
      if (typeof payload?.effort === "string") effort = payload.effort;
      if (typeof payload?.reasoning_effort === "string") effort = payload.reasoning_effort;
    }
    if (!at) continue;
    if (type === "task_started" || type === "turn_started") {
      pending = at;
      continue;
    }
    if (
      (type === "task_complete" || type === "turn_complete") &&
      pending !== undefined &&
      at >= pending
    ) {
      turns.push({ agent: "codex", session, start: pending, stop: at, model, effort });
      pending = undefined;
    }
  }
  return turns;
}

function isToolResult(record: HistoryRecord): boolean {
  const content = (record.message as HistoryRecord | undefined)?.content;
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((part) => part?.type === "tool_result")
  );
}

/** Parse completed Claude Code turns from a project transcript JSONL file. */
export function claudeTurns(records: HistoryRecord[], path = "session.jsonl"): HistoryTurn[] {
  const session = sessionFrom(records, path);
  let pending: number | undefined;
  const turns: HistoryTurn[] = [];

  for (const record of records) {
    // Claude persists child agents in sidechain transcripts. Their records
    // reuse the parent session ID, so importing them would mis-pair parent
    // events and count the same wall-clock wait more than once.
    if (record.isSidechain) continue;
    const at = timestamp(record.timestamp);
    if (!at) continue;
    // Claude persists system reminders, slash-command bookkeeping, and other
    // harness messages as `user` records. They can arrive while a real turn is
    // running, so treating them as a new prompt would replace the real start
    // time and undercount the wait.
    if (record.type === "user" && !record.isMeta && !isToolResult(record)) {
      pending = at;
      continue;
    }
    const message = record.message as HistoryRecord | undefined;
    if (record.type !== "assistant" || message?.stop_reason !== "end_turn" || pending === undefined)
      continue;
    if (at >= pending) {
      turns.push({
        agent: "claude-code",
        session,
        start: pending,
        stop: at,
        model: typeof message.model === "string" ? message.model : undefined,
        // Claude records reasoning effort at the top level of the assistant
        // record (same field the live Stop hook reads from the transcript).
        effort: typeof record.effort === "string" ? record.effort : undefined,
      });
    }
    pending = undefined;
  }
  return turns;
}

/** Read the persisted histories that expose durable start/complete timestamps. */
export function scanHistory(home = homedir()): HistoryScan {
  const codexFiles = [
    ...jsonlFiles(join(home, ".codex", "sessions")),
    ...jsonlFiles(join(home, ".codex", "archived_sessions")),
  ];
  const claudeFiles = jsonlFiles(join(home, ".claude", "projects"));
  const turns = [
    ...codexFiles.flatMap((path) => codexTurns(jsonLines(path), path)),
    ...claudeFiles.flatMap((path) => claudeTurns(jsonLines(path), path)),
  ];
  return { files: codexFiles.length + claudeFiles.length, turns };
}

function matchesInterval(turn: HistoryTurn, interval: Interval): boolean {
  return (
    turn.agent === interval.agent &&
    Math.abs(turn.start - interval.start) <= MATCH_TOLERANCE_MS &&
    Math.abs(turn.stop - (interval.start + interval.ms)) <= MATCH_TOLERANCE_MS
  );
}

function eventsFor(turn: HistoryTurn): Event[] {
  return [
    { ts: turn.start, kind: "start", agent: turn.agent, session: turn.session, source: "history" },
    {
      ts: turn.stop,
      kind: "stop",
      agent: turn.agent,
      session: turn.session,
      model: turn.model,
      effort: turn.effort,
      source: "history",
    },
  ];
}

/**
 * Import history into the event database. Re-running is safe: matched intervals
 * (including intervals recorded by hooks) are left alone.
 */
export function syncHistory(dbPath?: string, home = homedir()): HistorySync {
  const scan = scanHistory(home);
  const known = pairIntervals(allEvents(dbPath));
  const resetAt = historyResetAt(dbPath);
  const imported: HistoryTurn[] = [];
  for (const turn of scan.turns) {
    if (
      turn.stop < turn.start ||
      turn.start < resetAt ||
      known.some((interval) => matchesInterval(turn, interval))
    )
      continue;
    imported.push(turn);
    known.push({
      agent: turn.agent,
      session: turn.session,
      start: turn.start,
      ms: turn.stop - turn.start,
      model: turn.model,
      effort: turn.effort,
    });
  }
  insertEvents(imported.flatMap(eventsFor), dbPath);
  return {
    files: scan.files,
    found: scan.turns.length,
    imported: imported.length,
    importedMs: imported.reduce((total, turn) => total + turn.stop - turn.start, 0),
  };
}
