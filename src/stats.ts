import { pairIntervals, toolIntervals, unionMs, type Event, type Interval } from "./events.ts";

export type ModelRow = { agent: string; model: string; effort: string; ms: number; turns: number };
export type ToolRow = { tool: string; action: string; ms: number; count: number };
export type ActionRow = { action: string; ms: number; count: number };

export type Stats = {
  totalMs: number; // cumulative: sum of every turn's wait (double-counts concurrent agents)
  humanWaitMs: number; // overlap-adjusted: how long a person actually sat waiting
  todayMs: number;
  turns: number;
  sinceMs: number | null; // earliest recorded turn (start of the measured range)
  longest: Interval | null;
  byAgent: { agent: string; ms: number; turns: number }[]; // sorted desc by ms
  byModel: ModelRow[]; // per harness → model → effort, sorted desc by ms
  byTool: ToolRow[]; // per tool, sorted desc by ms
  byAction: ActionRow[]; // per tool category (run/edit/read/…), sorted desc by ms
};

const DAY_MS = 86_400_000;

export function computeStats(events: Event[], opts: { days?: number; now?: number } = {}): Stats {
  const now = opts.now ?? Date.now();
  const cutoff = opts.days ? now - opts.days * DAY_MS : 0;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const intervals = pairIntervals(events).filter((i) => i.start >= cutoff);

  const agents = new Map<string, { ms: number; turns: number }>();
  const models = new Map<string, ModelRow>();
  let totalMs = 0;
  let todayMs = 0;
  let sinceMs: number | null = null;
  let longest: Interval | null = null;
  for (const i of intervals) {
    totalMs += i.ms;
    if (i.start >= startOfToday) todayMs += i.ms;
    if (sinceMs === null || i.start < sinceMs) sinceMs = i.start;
    if (!longest || i.ms > longest.ms) longest = i;
    const g = agents.get(i.agent) ?? { ms: 0, turns: 0 };
    g.ms += i.ms;
    g.turns += 1;
    agents.set(i.agent, g);

    const model = i.model ?? "unknown";
    const effort = i.effort ?? "—";
    const key = `${i.agent}\0${model}\0${effort}`;
    const m = models.get(key) ?? { agent: i.agent, model, effort, ms: 0, turns: 0 };
    m.ms += i.ms;
    m.turns += 1;
    models.set(key, m);
  }

  // Tool time (a subset of wait time, measured PreToolUse→PostToolUse).
  const tools = new Map<string, ToolRow>();
  const actions = new Map<string, ActionRow>();
  for (const ti of toolIntervals(events).filter((t) => t.start >= cutoff)) {
    const t = tools.get(ti.tool) ?? { tool: ti.tool, action: ti.action, ms: 0, count: 0 };
    t.ms += ti.ms;
    t.count += 1;
    tools.set(ti.tool, t);
    const a = actions.get(ti.action) ?? { action: ti.action, ms: 0, count: 0 };
    a.ms += ti.ms;
    a.count += 1;
    actions.set(ti.action, a);
  }

  return {
    totalMs,
    humanWaitMs: unionMs(intervals),
    todayMs,
    turns: intervals.length,
    sinceMs,
    longest,
    byAgent: [...agents].map(([agent, g]) => ({ agent, ...g })).sort((a, b) => b.ms - a.ms),
    byModel: [...models.values()].sort((a, b) => b.ms - a.ms),
    byTool: [...tools.values()].sort((a, b) => b.ms - a.ms),
    byAction: [...actions.values()].sort((a, b) => b.ms - a.ms),
  };
}
