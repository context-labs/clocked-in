import { pairIntervals, type Event, type Interval } from "./events.ts";

export type ModelRow = { agent: string; model: string; effort: string; ms: number; turns: number };

export type Stats = {
  totalMs: number;
  todayMs: number;
  turns: number;
  longest: Interval | null;
  byAgent: { agent: string; ms: number; turns: number }[]; // sorted desc by ms
  byModel: ModelRow[]; // per harness → model → effort, sorted desc by ms
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
  let longest: Interval | null = null;
  for (const i of intervals) {
    totalMs += i.ms;
    if (i.start >= startOfToday) todayMs += i.ms;
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

  return {
    totalMs,
    todayMs,
    turns: intervals.length,
    longest,
    byAgent: [...agents].map(([agent, g]) => ({ agent, ...g })).sort((a, b) => b.ms - a.ms),
    byModel: [...models.values()].sort((a, b) => b.ms - a.ms),
  };
}
