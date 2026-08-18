import { Box, render, Text, useApp, useInput } from "ink";
import React, { useEffect, useState } from "react";
import { allEvents, resetEvents } from "./db.ts";
import { fmtDuration } from "./events.ts";
import { share } from "./share.ts";
import { computeStats, type Stats } from "./stats.ts";

const ORANGE = "#f97316";

function bar(ms: number, max: number, width = 24): string {
  const n = Math.round((ms / Math.max(1, max)) * width);
  return "█".repeat(n) + "░".repeat(width - n);
}

function App() {
  const { exit } = useApp();
  const [stats, setStats] = useState<Stats>(() => computeStats(allEvents()));
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = setInterval(() => setStats(computeStats(allEvents())), 1000);
    return () => clearInterval(t);
  }, []);

  useInput((input) => {
    if (input === "q") exit();
    else if (input === "r") {
      resetEvents();
      setStats(computeStats(allEvents()));
      setNote("reset.");
    } else if (input === "s") {
      try {
        const { png } = share(allEvents(), { open: true });
        setNote(`saved → ${png}`);
      } catch (e) {
        setNote(String((e as Error).message));
      }
    }
  });

  const max = Math.max(1, ...stats.byAgent.map((a) => a.ms));
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color={ORANGE} bold>
        ⏱ clocked-in
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Human wait {"  "}
          <Text color={ORANGE} bold>
            {fmtDuration(stats.humanWaitMs)}
          </Text>
          <Text dimColor> real time you sat waiting</Text>
        </Text>
        <Text>
          Agent-time {"  "}
          <Text bold>{fmtDuration(stats.totalMs)}</Text>
          <Text dimColor> across {stats.turns} turns (sums concurrent)</Text>
        </Text>
        <Text>
          Today {"       "}
          <Text bold>{fmtDuration(stats.todayMs)}</Text>
        </Text>
        {stats.longest && (
          <Text dimColor>
            Longest wait {fmtDuration(stats.longest.ms)} ({stats.longest.agent})
          </Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {stats.byAgent.length === 0 ? (
          <Text dimColor>No waiting recorded yet. Run: clocked-in install --all</Text>
        ) : (
          stats.byAgent.map((a) => (
            <Text key={a.agent}>
              <Text dimColor>{a.agent.padEnd(13)}</Text>
              <Text color={ORANGE}>{bar(a.ms, max)}</Text> {fmtDuration(a.ms).padStart(9)}
              <Text dimColor> ({a.turns})</Text>
            </Text>
          ))
        )}
      </Box>

      {stats.byModel.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>by model · effort</Text>
          {stats.byModel.slice(0, 6).map((m) => (
            <Text key={`${m.agent}/${m.model}/${m.effort}`}>
              <Text dimColor>{`${m.model} · ${m.effort}`.padEnd(30)}</Text>
              <Text color={ORANGE}>{fmtDuration(m.ms).padStart(9)}</Text>
              <Text dimColor>{`  ${m.agent} (${m.turns})`}</Text>
            </Text>
          ))}
        </Box>
      )}

      {stats.byAction.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>by action</Text>
          {stats.byAction.slice(0, 6).map((a) => (
            <Text key={a.action}>
              <Text dimColor>{a.action.padEnd(13)}</Text>
              <Text color={ORANGE}>{fmtDuration(a.ms).padStart(9)}</Text>
              <Text dimColor>{`  (${a.count} calls)`}</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>[q]uit [s]hare [r]eset{note ? `   ${note}` : ""}</Text>
      </Box>
    </Box>
  );
}

export function runTui(): void {
  render(<App />);
}
