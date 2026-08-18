import { Box, render, Text, useApp, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import { allEvents, resetEvents } from "./db.ts";
import { fmtDate, fmtDuration, heatmap, type Event } from "./events.ts";
import { share } from "./share.ts";
import { computeStats, type Stats } from "./stats.ts";

const ORANGE = "#f97316";
const WEEK = 7 * 86_400_000;

function bar(ms: number, max: number, width = 24): string {
  const n = Math.round((ms / Math.max(1, max)) * width);
  return "█".repeat(n) + "░".repeat(width - n);
}

// GitHub-style contribution heatmap of wait-per-day. 0 = empty (very dim), then
// four orange steps by intensity relative to the busiest day.
const HEAT = ["#20242c", "#7c3d10", "#b5560f", "#e0670f", ORANGE];
const DOW = ["", "Mon", "", "Wed", "", "Fri", ""];
const level = (ms: number, max: number) =>
  ms <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((ms / max) * 4));

function Heat({ stats, now }: { stats: Stats; now: number }) {
  if (!stats.byDay.length || !stats.sinceMs) return null;
  const weeks = Math.max(4, Math.min(26, Math.ceil((now - stats.sinceMs) / WEEK) + 1));
  const hm = heatmap(stats.byDay, now, weeks);
  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>wait per day · last {weeks}w</Text>
      {hm.grid.map((row, dow) => (
        <Text key={dow}>
          <Text dimColor>{DOW[dow]!.padEnd(4)}</Text>
          {row.map((ms, c) => (
            <Text key={c} color={HEAT[level(ms, hm.max)]}>
              ▇
            </Text>
          ))}
        </Text>
      ))}
      <Text dimColor>
        {"    less "}
        {[1, 2, 3, 4].map((l) => (
          <Text key={l} color={HEAT[l]}>
            ▇
          </Text>
        ))}
        {" more"}
      </Text>
    </Box>
  );
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const WINDOWS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "all time", days: 0 },
] as const;

function App({ since }: { since?: number }) {
  const { exit } = useApp();
  const session = since !== undefined;
  const [events, setEvents] = useState<Event[]>(() => allEvents());
  const [winIdx, setWinIdx] = useState(WINDOWS.length - 1); // default: all time
  const [note, setNote] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setEvents(allEvents()), 1000);
    return () => clearInterval(t);
  }, []);

  const win = WINDOWS[winIdx]!;
  const stats = useMemo(
    () => computeStats(events, session ? { since } : { days: win.days || undefined }),
    [events, winIdx, since, session],
  );

  useInput((input, key) => {
    // Reset erases all recorded data — require an explicit second confirmation.
    if (confirmReset) {
      if (input === "y") {
        resetEvents();
        setEvents(allEvents());
        setNote("reset — all recorded data erased.");
      } else {
        setNote("reset cancelled.");
      }
      setConfirmReset(false);
      return;
    }
    // Arrow keys switch the time window (not in a fixed-range session view).
    if (!session && (key.leftArrow || key.rightArrow)) {
      setWinIdx((i) => Math.min(WINDOWS.length - 1, Math.max(0, i + (key.rightArrow ? 1 : -1))));
      return;
    }
    if (input === "q") exit();
    else if (input === "r") {
      setConfirmReset(true);
      setNote("");
    } else if (input === "s") {
      setNote("rendering share card…");
      share(events, { open: true })
        .then(({ png }) => setNote(`saved → ${png}`))
        .catch((e) => setNote(String((e as Error).message)));
    }
  });

  const max = Math.max(1, ...stats.byAgent.map((a) => a.ms));
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text>
        <Text color={ORANGE} bold>
          ⏱ clocked-in
        </Text>
        {session ? (
          <Text dimColor>{`   this session · started ${clock(since!)}`}</Text>
        ) : win.days === 0 ? (
          <Text
            dimColor
          >{`   all time${stats.sinceMs ? ` · since ${fmtDate(stats.sinceMs)}` : ""}`}</Text>
        ) : (
          <Text dimColor>{`   last ${win.label}`}</Text>
        )}
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

      {!session && win.days === 0 && <Heat stats={stats} now={Date.now()} />}

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
          <Text dimColor>by model · effort — wait per turn (speed)</Text>
          {stats.byModel.map((m) => (
            <Text key={`${m.agent}/${m.model}/${m.effort}`}>
              <Text dimColor>{`${m.model} · ${m.effort}`.padEnd(28)}</Text>
              <Text color={ORANGE}>{`${fmtDuration(m.avgMs)}/turn`.padStart(12)}</Text>
              <Text
                dimColor
              >{`  p50 ${fmtDuration(m.p50Ms).padStart(7)} · ${fmtDuration(m.ms)} total (${m.turns})`}</Text>
            </Text>
          ))}
        </Box>
      )}

      {stats.byAction.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>by action</Text>
          {stats.byAction.map((a) => (
            <Text key={a.action}>
              <Text dimColor>{a.action.padEnd(13)}</Text>
              <Text color={ORANGE}>{fmtDuration(a.ms).padStart(9)}</Text>
              <Text dimColor>{`  (${a.count} calls)`}</Text>
            </Text>
          ))}
        </Box>
      )}

      {!session && !confirmReset && (
        <Box marginTop={1}>
          <Text dimColor>{"← → "}</Text>
          {WINDOWS.map((w, i) => (
            <Text
              key={w.label}
              color={i === winIdx ? ORANGE : undefined}
              dimColor={i !== winIdx}
              bold={i === winIdx}
            >
              {i === winIdx ? `[${w.label}]` : ` ${w.label} `}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        {confirmReset ? (
          <Text color={ORANGE}>
            ⚠ erase ALL recorded data? press [y] to confirm · any other key cancels
          </Text>
        ) : (
          <Text dimColor>[q]uit [s]hare [r]eset{note ? `   ${note}` : ""}</Text>
        )}
      </Box>
    </Box>
  );
}

export function runTui(opts: { since?: number } = {}): void {
  render(<App since={opts.since} />);
}
