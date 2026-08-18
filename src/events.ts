// Pure domain logic — no I/O, no Bun/Node deps. Unit-tested in events.test.ts.

/** A supported coding agent. */
export const AGENTS = ["claude-code", "codex", "grok", "cursor", "opencode", "pi"] as const;
export type Agent = (typeof AGENTS)[number];

export const KIND = {
  start: "start", // user submitted a prompt (wait begins)
  stop: "stop", // agent finished the turn (wait ends)
  tool_start: "tool_start", // a tool call began (PreToolUse)
  tool_end: "tool_end", // a tool call finished (PostToolUse)
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export type Event = {
  ts: number; // epoch ms
  kind: Kind;
  agent: string; // one of AGENTS (kept as string — hooks are untrusted input)
  session: string;
  cwd?: string;
  model?: string; // the model that ran the turn (known on `stop`)
  effort?: string; // reasoning effort, if the harness exposes it
  source?: "hook" | "history";
  tool?: string; // tool name (on tool_start/tool_end), e.g. "Bash"
  toolId?: string; // tool_use_id, used to pair tool_start↔tool_end
};

export type Interval = {
  agent: string;
  session: string;
  start: number;
  ms: number;
  model?: string;
  effort?: string;
};

export type ToolInterval = {
  agent: string;
  session: string;
  tool: string;
  action: string;
  start: number;
  ms: number;
};

/** Coarse category for a tool name — the "action" axis (run/edit/read/…). */
export function toolAction(tool: string | undefined): string {
  const t = (tool ?? "").toLowerCase();
  if (t.startsWith("mcp__") || t.startsWith("mcp_")) return "mcp";
  if (/(bash|shell|terminal|exec|run_command|command)/.test(t)) return "run";
  if (/(edit|write|create|apply_patch|str_replace|patch|multiedit|notebook)/.test(t)) return "edit";
  if (/(grep|glob|search|find|codebase|ripgrep|ls|list)/.test(t)) return "search";
  if (/(read|view|open|cat|file)/.test(t)) return "read";
  if (/(task|agent|subagent|dispatch)/.test(t)) return "subagent";
  if (/(web|fetch|browser|url)/.test(t)) return "web";
  if (/(todo|plan|think)/.test(t)) return "plan";
  return "other";
}

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
    } else if (e.kind === KIND.stop) {
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

// Pair each tool_start with its tool_end. tool_use_id is the reliable key when
// present (Claude/Cursor); otherwise fall back to a per-(session,tool) LIFO stack.
export function toolIntervals(events: Event[]): ToolInterval[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const byId = new Map<string, Event>();
  const stacks = new Map<string, Event[]>();
  const stackKey = (e: Event) => `${e.session}\0${e.tool ?? ""}`;
  const out: ToolInterval[] = [];
  const emit = (s: Event, e: Event) => {
    const tool = s.tool ?? e.tool ?? "unknown";
    out.push({
      agent: s.agent,
      session: s.session,
      tool,
      action: toolAction(tool),
      start: s.ts,
      ms: e.ts - s.ts,
    });
  };
  for (const e of sorted) {
    if (e.kind === KIND.tool_start) {
      if (e.toolId) byId.set(e.toolId, e);
      else (stacks.get(stackKey(e)) ?? stacks.set(stackKey(e), []).get(stackKey(e))!).push(e);
    } else if (e.kind === KIND.tool_end) {
      const s = e.toolId ? byId.get(e.toolId) : stacks.get(stackKey(e))?.pop();
      if (s) {
        emit(s, e);
        if (e.toolId) byId.delete(e.toolId);
      }
    }
  }
  return out;
}

// Total length of the UNION of intervals — overlapping time counted once. This
// is the "human wait": how long a person actually sat waiting even when several
// agents ran concurrently (10 agents × 1h overlapping ≈ 1h here, not 10h).
export function unionMs(intervals: { start: number; ms: number }[]): number {
  const spans = intervals
    .filter((i) => i.ms > 0)
    .map((i) => [i.start, i.start + i.ms] as const)
    .sort((a, b) => a[0] - b[0]);
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
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jan 13, 2026" — local date, no locale/Intl surprises. */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const DAY = 86_400_000;

/** Nearest-rank percentile of an ascending-sorted array (p in [0,1]). */
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx]!;
}

export type Heatmap = { grid: number[][]; weeks: number; max: number };

/**
 * GitHub-style contribution grid: rows are weekdays (0=Sun..6=Sat), columns are
 * weeks (oldest→newest, rightmost = current week). grid[weekday][week] = wait ms.
 * Pure; `now` is passed in so it's deterministic to test.
 */
export function heatmap(byDay: { day: number; ms: number }[], now: number, weeks: number): Heatmap {
  const w = Math.max(1, Math.floor(weeks));
  const grid = Array.from({ length: 7 }, () => new Array<number>(w).fill(0));
  const todayMid = new Date(now).setHours(0, 0, 0, 0);
  const thisSunday = todayMid - new Date(todayMid).getDay() * DAY;
  let max = 0;
  for (const { day, ms } of byDay) {
    const dow = new Date(day).getDay();
    const daySunday = day - dow * DAY;
    const weeksAgo = Math.round((thisSunday - daySunday) / (7 * DAY));
    const col = w - 1 - weeksAgo;
    if (col >= 0 && col < w) {
      grid[dow]![col]! += ms;
      if (grid[dow]![col]! > max) max = grid[dow]![col]!;
    }
  }
  return { grid, weeks: w, max };
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
