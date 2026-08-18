import { fmtDuration, type Event } from "./events.ts";
import { computeStats } from "./stats.ts";

export function report(events: Event[], opts: { days?: number; now?: number } = {}): string {
  const s = computeStats(events, opts);
  if (!s.turns)
    return "clocked-in: no waiting recorded yet. Install hooks (clocked-in install --all) and run some agent turns.";

  const scope = opts.days ? `last ${opts.days}d` : "all time";
  const lines = [
    `⏱  clocked-in — time you spent waiting on coding agents (${scope})`,
    "",
    `  Total wait:   ${fmtDuration(s.totalMs)}  across ${s.turns} turns`,
    `  Today:        ${fmtDuration(s.todayMs)}`,
    `  Avg / turn:   ${fmtDuration(s.totalMs / s.turns)}`,
  ];
  if (s.longest) lines.push(`  Longest wait: ${fmtDuration(s.longest.ms)}  (${s.longest.agent})`);
  lines.push("", "  By agent:");
  for (const a of s.byAgent) {
    lines.push(
      `    ${a.agent.padEnd(14)} ${fmtDuration(a.ms).padStart(10)}  (${a.turns} turns, ${fmtDuration(a.ms / a.turns)}/turn)`,
    );
  }
  return lines.join("\n");
}
