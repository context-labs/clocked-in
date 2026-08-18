import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Event } from "./events.ts";

export function dbPath(): string {
  return process.env.CLOCKED_IN_DB || join(homedir(), ".clocked-in", "clocked-in.db");
}

const cache = new Map<string, Database>();

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
    cwd TEXT
  );`);
  d.exec("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session, ts);");
  cache.set(path, d);
  return d;
}

export function insertEvent(e: Event, path = dbPath()): void {
  db(path)
    .query("INSERT INTO events (ts, kind, agent, session, cwd) VALUES (?, ?, ?, ?, ?)")
    .run(e.ts, e.kind, e.agent, e.session, e.cwd ?? null);
}

export function allEvents(path = dbPath()): Event[] {
  return db(path)
    .query("SELECT ts, kind, agent, session, cwd FROM events ORDER BY ts")
    .all() as Event[];
}

export function resetEvents(path = dbPath()): void {
  db(path).exec("DELETE FROM events;");
}
