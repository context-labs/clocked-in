import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Event } from "./events.ts";

export function dbPath(): string {
  return process.env.CLOCKED_IN_DB || join(homedir(), ".clocked-in", "clocked-in.db");
}

const cache = new Map<string, Database>();
const HISTORY_RESET_KEY = "history_reset_at";

export function db(path = dbPath()): Database {
  const hit = cache.get(path);
  if (hit) return hit;
  mkdirSync(dirname(path), { recursive: true });
  const d = new Database(path);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA busy_timeout = 2000;"); // concurrent agent hooks can write at once

  d.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    agent TEXT NOT NULL,
    session TEXT NOT NULL,
    cwd TEXT,
    model TEXT,
    effort TEXT,
    source TEXT NOT NULL DEFAULT 'hook',
    tool TEXT,
    tool_id TEXT
  );`);
  d.exec(`CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`);
  d.exec("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session, ts);");
  // Migrate DBs created before model/effort/history-source/tool tracking.
  for (const definition of [
    "model TEXT",
    "effort TEXT",
    "source TEXT NOT NULL DEFAULT 'hook'",
    "tool TEXT",
    "tool_id TEXT",
  ]) {
    try {
      d.exec(`ALTER TABLE events ADD COLUMN ${definition};`);
    } catch {
      // column already exists
    }
  }
  cache.set(path, d);
  return d;
}

export function insertEvent(e: Event, path = dbPath()): void {
  db(path)
    .query(
      "INSERT INTO events (ts, kind, agent, session, cwd, model, effort, source, tool, tool_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      e.ts,
      e.kind,
      e.agent,
      e.session,
      e.cwd ?? null,
      e.model ?? null,
      e.effort ?? null,
      e.source ?? "hook",
      e.tool ?? null,
      e.toolId ?? null,
    );
}

export function insertEvents(events: Event[], path = dbPath()): void {
  if (!events.length) return;
  const d = db(path);
  const statement = d.query(
    "INSERT INTO events (ts, kind, agent, session, cwd, model, effort, source, tool, tool_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  d.transaction(() => {
    for (const e of events) {
      statement.run(
        e.ts,
        e.kind,
        e.agent,
        e.session,
        e.cwd ?? null,
        e.model ?? null,
        e.effort ?? null,
        e.source ?? "hook",
        e.tool ?? null,
        e.toolId ?? null,
      );
    }
  })();
}

type Row = {
  ts: number;
  kind: string;
  agent: string;
  session: string;
  cwd: string | null;
  model: string | null;
  effort: string | null;
  source: "hook" | "history" | null;
  tool: string | null;
  tool_id: string | null;
};

export function allEvents(path = dbPath()): Event[] {
  const rows = db(path)
    .query(
      "SELECT ts, kind, agent, session, cwd, model, effort, source, tool, tool_id FROM events ORDER BY ts",
    )
    .all() as Row[];
  return rows.map((r) => ({
    ts: r.ts,
    kind: r.kind as Event["kind"],
    agent: r.agent,
    session: r.session,
    cwd: r.cwd ?? undefined,
    model: r.model ?? undefined,
    effort: r.effort ?? undefined,
    source: r.source ?? "hook",
    tool: r.tool ?? undefined,
    toolId: r.tool_id ?? undefined,
  }));
}

/** The earliest turn that may be restored from durable agent history. */
export function historyResetAt(path = dbPath()): number {
  const row = db(path).query("SELECT value FROM metadata WHERE key = ?").get(HISTORY_RESET_KEY) as {
    value: string;
  } | null;
  const at = Number(row?.value);
  return Number.isFinite(at) ? at : 0;
}

export function resetEvents(path = dbPath(), resetAt = Date.now()): void {
  const d = db(path);
  const saveReset = d.query(
    "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  d.transaction(() => {
    d.exec("DELETE FROM events;");
    saveReset.run(HISTORY_RESET_KEY, String(resetAt));
  })();
}
