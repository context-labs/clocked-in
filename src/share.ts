import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { headline, renderCardSvg } from "./card.ts";
import { fmtDuration, type Event } from "./events.ts";
import { computeStats, type Stats } from "./stats.ts";
// Embed the WASM rasterizer and font INTO the bundle/standalone binary. Unlike
// the native @resvg/resvg-js addon (which bun --compile can't embed on macOS),
// a `with { type: "file" }` asset is portable and works on a clean machine.
import fontAsset from "../assets/Geist-Regular.ttf" with { type: "file" };
import wasmAsset from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };

export function tweetText(stats: Stats): string {
  const worst = stats.byAgent[0];
  const worstLine = worst ? ` ${worst.agent} was the worst at ${fmtDuration(worst.ms)}.` : "";
  return `Holy shit — I've spent ${headline(stats.totalMs)} of my life waiting for coding agents to finish. 🫠\n\nAcross ${stats.turns} turns.${worstLine}\n\nMeasure your own wait: github.com/context-labs/clocked-in`;
}

// Resolve emitted-asset paths against this module's dir, not the process CWD:
// bundled output emits a relative path; the compiled binary embeds an absolute
// one (resolve leaves absolute paths untouched).
const assetPath = (p: string) => resolve(import.meta.dir, p);

let wasmReady: Promise<void> | undefined;
const ensureWasm = () =>
  (wasmReady ??= Bun.file(assetPath(wasmAsset))
    .arrayBuffer()
    .then((b) => initWasm(b)));

export async function renderCardPng(stats: Stats): Promise<Buffer> {
  await ensureWasm();
  const font = new Uint8Array(await Bun.file(assetPath(fontAsset)).arrayBuffer());
  const resvg = new Resvg(renderCardSvg(stats), {
    background: "#0b0e14",
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false, fontBuffers: [font], defaultFontFamily: "Geist" },
  });
  return Buffer.from(resvg.render().asPng());
}

function openUrl(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    const p = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" });
    p.on("error", () => {});
    p.unref();
  } catch {}
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
    p.on("error", () => {});
    p.stdin.end(text);
    return true;
  } catch {
    return false;
  }
}

export function tweetUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

// Build the share artifacts. `open` controls side effects (off in tests).
export async function share(
  events: Event[],
  opts: { out?: string; open?: boolean } = {},
): Promise<{ png: string; text: string; url: string }> {
  const stats = computeStats(events);
  if (!stats.turns) throw new Error("Nothing to share yet — no waiting recorded.");
  const out = opts.out ?? join(homedir(), ".clocked-in", "share.png");
  const text = tweetText(stats);
  const url = tweetUrl(text);
  writeFileSync(out, await renderCardPng(stats));
  if (opts.open) {
    copyToClipboard(text);
    openUrl(url);
  }
  return { png: out, text, url };
}
