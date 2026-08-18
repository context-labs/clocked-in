import { pairIntervals, type Event, type Interval } from "./events.ts";

export type Stats = {
  totalMs: number;
  todayMs: number;
  turns: number;
  longest: Interval | null;
  byAgent: { agent: string; ms: number; turns: number }[]; // sorted desc by ms
};

const DAY_MS = 86_400_000;

export function computeStats(events: Event[], opts: { days?: number; now?: number } = {}): Stats {
  const now = opts.now ?? Date.now();
  const cutoff = opts.days ? now - opts.days * DAY_MS : 0;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const intervals = pairIntervals(events).filter((i) => i.start >= cutoff);

  const agents = new Map<string, { ms: number; turns: number }>();
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
  }

  return {
    totalMs,
    todayMs,
    turns: intervals.length,
    longest,
    byAgent: [...agents].map(([agent, g]) => ({ agent, ...g })).sort((a, b) => b.ms - a.ms),
  };
}
