#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __promiseAll = (args) => Promise.all(args);
var __require = import.meta.require;

// src/events.ts
function toolAction(tool) {
  const t = (tool ?? "").toLowerCase();
  if (t.startsWith("mcp__") || t.startsWith("mcp_"))
    return "mcp";
  if (/(bash|shell|terminal|exec|run_command|command)/.test(t))
    return "run";
  if (/(edit|write|create|apply_patch|str_replace|patch|multiedit|notebook)/.test(t))
    return "edit";
  if (/(grep|glob|search|find|codebase|ripgrep|ls|list)/.test(t))
    return "search";
  if (/(read|view|open|cat|file)/.test(t))
    return "read";
  if (/(task|agent|subagent|dispatch)/.test(t))
    return "subagent";
  if (/(web|fetch|browser|url)/.test(t))
    return "web";
  if (/(todo|plan|think)/.test(t))
    return "plan";
  return "other";
}
function pairIntervals(events) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const pending = new Map;
  const out = [];
  for (const e of sorted) {
    if (e.kind === KIND.start) {
      pending.set(e.session, e);
    } else if (e.kind === KIND.stop) {
      const s = pending.get(e.session);
      if (s) {
        out.push({
          agent: s.agent,
          session: e.session,
          start: s.ts,
          ms: e.ts - s.ts,
          model: e.model,
          effort: e.effort
        });
        pending.delete(e.session);
      }
    }
  }
  return out;
}
function toolIntervals(events) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const byId = new Map;
  const stacks = new Map;
  const stackKey = (e) => `${e.session}\x00${e.tool ?? ""}`;
  const out = [];
  const emit = (s, e) => {
    const tool = s.tool ?? e.tool ?? "unknown";
    out.push({
      agent: s.agent,
      session: s.session,
      tool,
      action: toolAction(tool),
      start: s.ts,
      ms: e.ts - s.ts
    });
  };
  for (const e of sorted) {
    if (e.kind === KIND.tool_start) {
      if (e.toolId)
        byId.set(e.toolId, e);
      else
        (stacks.get(stackKey(e)) ?? stacks.set(stackKey(e), []).get(stackKey(e))).push(e);
    } else if (e.kind === KIND.tool_end) {
      const s = e.toolId ? byId.get(e.toolId) : stacks.get(stackKey(e))?.pop();
      if (s) {
        emit(s, e);
        if (e.toolId)
          byId.delete(e.toolId);
      }
    }
  }
  return out;
}
function unionMs(intervals) {
  const spans = intervals.filter((i) => i.ms > 0).map((i) => [i.start, i.start + i.ms]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of spans) {
    if (s > curEnd) {
      total += curEnd - curStart > 0 ? curEnd - curStart : 0;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart)
    total += curEnd - curStart;
  return total;
}
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)
    return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)
    return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24)
    return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
var AGENTS, KIND;
var init_events = __esm(() => {
  AGENTS = ["claude-code", "codex", "grok", "cursor", "opencode", "pi"];
  KIND = {
    start: "start",
    stop: "stop",
    tool_start: "tool_start",
    tool_end: "tool_end"
  };
});

// src/db.ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
function dbPath() {
  return process.env.CLOCKED_IN_DB || join(homedir(), ".clocked-in", "clocked-in.db");
}
function db(path = dbPath()) {
  const hit = cache.get(path);
  if (hit)
    return hit;
  mkdirSync(dirname(path), { recursive: true });
  const d = new Database(path);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA busy_timeout = 2000;");
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
  for (const definition of [
    "model TEXT",
    "effort TEXT",
    "source TEXT NOT NULL DEFAULT 'hook'",
    "tool TEXT",
    "tool_id TEXT"
  ]) {
    try {
      d.exec(`ALTER TABLE events ADD COLUMN ${definition};`);
    } catch {}
  }
  cache.set(path, d);
  return d;
}
function insertEvent(e, path = dbPath()) {
  db(path).query("INSERT INTO events (ts, kind, agent, session, cwd, model, effort, source, tool, tool_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(e.ts, e.kind, e.agent, e.session, e.cwd ?? null, e.model ?? null, e.effort ?? null, e.source ?? "hook", e.tool ?? null, e.toolId ?? null);
}
function insertEvents(events, path = dbPath()) {
  if (!events.length)
    return;
  const d = db(path);
  const statement = d.query("INSERT INTO events (ts, kind, agent, session, cwd, model, effort, source, tool, tool_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  d.transaction(() => {
    for (const e of events) {
      statement.run(e.ts, e.kind, e.agent, e.session, e.cwd ?? null, e.model ?? null, e.effort ?? null, e.source ?? "hook", e.tool ?? null, e.toolId ?? null);
    }
  })();
}
function allEvents(path = dbPath()) {
  const rows = db(path).query("SELECT ts, kind, agent, session, cwd, model, effort, source, tool, tool_id FROM events ORDER BY ts").all();
  return rows.map((r) => ({
    ts: r.ts,
    kind: r.kind,
    agent: r.agent,
    session: r.session,
    cwd: r.cwd ?? undefined,
    model: r.model ?? undefined,
    effort: r.effort ?? undefined,
    source: r.source ?? "hook",
    tool: r.tool ?? undefined,
    toolId: r.tool_id ?? undefined
  }));
}
function historyResetAt(path = dbPath()) {
  const row = db(path).query("SELECT value FROM metadata WHERE key = ?").get(HISTORY_RESET_KEY);
  const at = Number(row?.value);
  return Number.isFinite(at) ? at : 0;
}
function resetEvents(path = dbPath(), resetAt = Date.now()) {
  const d = db(path);
  const saveReset = d.query("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  d.transaction(() => {
    d.exec("DELETE FROM events;");
    saveReset.run(HISTORY_RESET_KEY, String(resetAt));
  })();
}
var cache, HISTORY_RESET_KEY = "history_reset_at";
var init_db = __esm(() => {
  cache = new Map;
});

// src/hook-cli.ts
init_events();

// src/hook.ts
init_db();
init_events();
import { readFileSync } from "fs";
async function readStdin() {
  if (process.stdin.isTTY)
    return {};
  try {
    const text = await Promise.race([
      Bun.stdin.text(),
      new Promise((r) => setTimeout(() => r(""), 300))
    ]);
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
function str(v) {
  return typeof v === "string" && v ? v : undefined;
}
function resolveEvent(kind, opts, input, env, now, meta = {}) {
  return {
    ts: now,
    kind,
    agent: opts.agent || str(input.agent) || "claude-code",
    session: opts.session || str(input.session_id) || str(input.sessionId) || str(input.conversation_id) || env.CLAUDE_SESSION_ID || env.GROK_SESSION_ID || env.CODEX_SESSION_ID || "unknown",
    cwd: str(input.cwd) || str(input.workspace_roots?.[0]) || env.PWD,
    model: str(input.model) || str(input.model_slug) || str(input.modelId) || str(input.model_id) || meta.model,
    effort: str(input.reasoning_effort) || str(input.effort) || str(input.reasoningEffort) || meta.effort,
    tool: opts.tool || str(input.tool_name) || str(input.toolName) || str(input.tool),
    toolId: opts.toolId || str(input.tool_use_id) || str(input.toolUseId) || str(input.tool_call_id) || str(input.toolCallId) || str(input.callId)
  };
}
function metaFromTranscript(lines) {
  const meta = {};
  for (const line of lines) {
    if (!line)
      continue;
    try {
      const o = JSON.parse(line);
      const model = o.message?.model ?? o.model ?? o.model_slug;
      const effort = o.effort ?? o.reasoning_effort ?? o.message?.effort;
      if (typeof model === "string" && model)
        meta.model = model;
      if (typeof effort === "string" && effort)
        meta.effort = effort;
    } catch {}
  }
  return meta;
}
function readTranscript(path) {
  if (!path)
    return {};
  try {
    const buf = readFileSync(path);
    const tail = buf.length > 512000 ? buf.subarray(buf.length - 512000) : buf;
    return metaFromTranscript(tail.toString("utf8").split(`
`));
  } catch {
    return {};
  }
}
async function runHook(kind, opts) {
  try {
    const input = await readStdin();
    const meta = kind === KIND.stop ? readTranscript(str(input.transcript_path) || str(input.transcriptPath)) : {};
    insertEvent(resolveEvent(kind, opts, input, process.env, Date.now(), meta));
  } catch {}
}

// src/hook-cli.ts
var CLI_KIND = {
  start: KIND.start,
  stop: KIND.stop,
  "tool-start": KIND.tool_start,
  "tool-end": KIND.tool_end
};
var argv = process.argv.slice(2);
var kind = CLI_KIND[argv[0] ?? ""];
if (!kind)
  process.exit(0);
var flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
await runHook(kind, {
  agent: flag("agent"),
  session: flag("session"),
  tool: flag("tool"),
  toolId: flag("tool-id")
});
process.exit(0);
