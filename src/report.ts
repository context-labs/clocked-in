import { fmtDate, fmtDuration, type Event } from "./events.ts";
import { computeStats } from "./stats.ts";

export function report(
  events: Event[],
  opts: { days?: number; now?: number; since?: number } = {},
): string {
  const s = computeStats(events, opts);
  if (!s.turns)
    return opts.since
      ? "clocked-in: nothing recorded this session yet."
      : "clocked-in: no waiting recorded yet. Install hooks (clocked-in install --all) and run some agent turns.";

  const scope = opts.since
    ? "this session"
    : s.sinceMs && !opts.days
      ? `since ${fmtDate(s.sinceMs)}`
      : opts.days
        ? `last ${opts.days}d`
        : "all time";
  const overlap = s.totalMs - s.humanWaitMs;
  const lines = [
    `⏱  clocked-in — time you spent waiting on coding agents (${scope})`,
    "",
    `  Human wait:   ${fmtDuration(s.humanWaitMs)}  ← real time you sat waiting`,
    `  Agent-time:   ${fmtDuration(s.totalMs)}  across ${s.turns} turns (sums concurrent agents)`,
  ];
  if (overlap > 1000) lines.push(`  Saved by //:  ${fmtDuration(overlap)}  ran concurrently`);
  lines.push(
    `  Today:        ${fmtDuration(s.todayMs)}`,
    `  Avg / turn:   ${fmtDuration(s.totalMs / s.turns)}`,
  );
  if (s.longest) lines.push(`  Longest wait: ${fmtDuration(s.longest.ms)}  (${s.longest.agent})`);
  lines.push("", "  By agent:");
  for (const a of s.byAgent) {
    lines.push(
      `    ${a.agent.padEnd(14)} ${fmtDuration(a.ms).padStart(10)}  (${a.turns} turns, ${fmtDuration(a.ms / a.turns)}/turn)`,
    );
  }

  lines.push("", "  By model & effort  (wait per turn — a rough speed signal):");
  for (const a of s.byAgent) {
    const rows = s.byModel.filter((m) => m.agent === a.agent);
    lines.push(`    ${a.agent}`);
    for (const m of rows) {
      lines.push(
        `      ${m.model.padEnd(22)} ${m.effort.padEnd(7)} ${fmtDuration(m.avgMs).padStart(9)}/turn  p50 ${fmtDuration(m.p50Ms).padStart(8)}  (${m.turns} turns · ${fmtDuration(m.ms)} total)`,
      );
    }
  }

  if (s.byAction.length) {
    lines.push("", "  By action:");
    for (const a of s.byAction) {
      lines.push(
        `    ${a.action.padEnd(10)} ${fmtDuration(a.ms).padStart(10)}  (${a.count} calls)`,
      );
    }
    lines.push("", "  By tool:");
    for (const t of s.byTool) {
      lines.push(`    ${t.tool.padEnd(20)} ${fmtDuration(t.ms).padStart(10)}  (${t.count} calls)`);
    }
  }
  return lines.join("\n");
}
