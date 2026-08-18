// Pure domain logic — no I/O, no Bun/Node deps. Unit-tested in events.test.ts.

/** A supported coding agent. */
export const AGENTS = ["claude-code", "codex", "grok", "cursor", "opencode", "pi"] as const;
export type Agent = (typeof AGENTS)[number];

export const KIND = { start: "start", stop: "stop" } as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export type Event = {
  ts: number; // epoch ms
  kind: Kind; // start = user submitted a prompt; stop = agent finished
  agent: string; // one of AGENTS (kept as string — hooks are untrusted input)
  session: string;
  cwd?: string;
  model?: string; // the model that ran the turn (known on `stop`)
  effort?: string; // reasoning effort, if the harness exposes it
  source?: "hook" | "history";
};

export type Interval = {
  agent: string;
  session: string;
  start: number;
  ms: number;
  model?: string;
  effort?: string;
};

// Pair each `start` with the next `stop` in the same session. A new `start`
// before a `stop` replaces the pending one (user re-prompted / interrupted).
// ponytail: submit→stop counts permission-prompt time as "waiting" too; refine
// with a Notification event only if that gap proves material.
export function pairIntervals(events: Event[]): Interval[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const pending = new Map<string, Event>();
  const out: Interval[] = [];
  for (const e of sorted) {
    if (e.kind === KIND.start) {
      pending.set(e.session, e);
    } else {
      const s = pending.get(e.session);
      if (s) {
        // model/effort are known at `stop` (the turn has run), so take them from e.
        out.push({
          agent: s.agent,
          session: e.session,
          start: s.ts,
          ms: e.ts - s.ts,
          model: e.model,
          effort: e.effort,
        });
        pending.delete(e.session);
      }
    }
  }
  return out;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
