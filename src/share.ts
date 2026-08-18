import { Resvg } from "@resvg/resvg-js";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { headline, renderCardSvg } from "./card.ts";
import { fmtDuration, type Event } from "./events.ts";
import { computeStats, type Stats } from "./stats.ts";

export function tweetText(stats: Stats): string {
  const worst = stats.byAgent[0];
  const worstLine = worst ? ` ${worst.agent} was the worst at ${fmtDuration(worst.ms)}.` : "";
  return `Holy shit — I've spent ${headline(stats.totalMs)} of my life waiting for coding agents to finish. 🫠\n\nAcross ${stats.turns} turns.${worstLine}\n\nMeasure your own wait: npm i -g clocked-in`;
}

// Bundled so the card renders identically on any machine (no system fonts needed).
const FONT_FILE = resolve(import.meta.dir, "../assets/Geist-Regular.ttf");

export function renderCardPng(stats: Stats): Buffer {
  const resvg = new Resvg(renderCardSvg(stats), {
    background: "#0b0e14",
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false, fontFiles: [FONT_FILE], defaultFontFamily: "Geist" },
  });
  return resvg.render().asPng();
}

function openUrl(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" }).unref();
}

function copyToClipboard(text: string): boolean {
  const cmd =
    platform() === "darwin"
      ? ["pbcopy"]
      : platform() === "win32"
        ? ["clip"]
        : process.env.WAYLAND_DISPLAY
          ? ["wl-copy"]
          : ["xclip", "-selection", "clipboard"];
  try {
    const p = spawn(cmd[0]!, cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    p.stdin.end(text);
    return true;
  } catch {
    return false;
  }
}

// Build the share artifacts. `open` controls side effects (off in tests).
export function share(
  events: Event[],
  opts: { out?: string; open?: boolean } = {},
): { png: string; text: string } {
  const stats = computeStats(events);
  if (!stats.turns) throw new Error("Nothing to share yet — no waiting recorded.");
  const out = opts.out ?? join(homedir(), ".clocked-in", "share.png");
  const text = tweetText(stats);
  writeFileSync(out, renderCardPng(stats));
  if (opts.open) {
    copyToClipboard(text);
    openUrl(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);
  }
  return { png: out, text };
}
