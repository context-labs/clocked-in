import { fmtDuration } from "./events.ts";
import type { Stats } from "./stats.ts";

const W = 1200;
const H = 675;
const FONT = "Geist";

function esc(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

/** A big, punchy headline number for the "holy shit" line. */
export function headline(totalMs: number): string {
  return fmtDuration(totalMs);
}

/** 1200x675 social card. Dark, one giant number, per-agent bars. */
export function renderCardSvg(stats: Stats): string {
  const big = headline(stats.totalMs);
  const bars = stats.byAgent.slice(0, 5);
  const maxMs = Math.max(1, ...bars.map((b) => b.ms));
  const barW = 620;
  const rows = bars
    .map((b, i) => {
      const y = 392 + i * 50;
      const w = Math.max(6, Math.round((b.ms / maxMs) * barW));
      return `
    <text x="80" y="${y + 22}" fill="#8b93a7" font-size="26" font-family="${FONT}">${esc(b.agent)}</text>
    <rect x="300" y="${y}" width="${w}" height="30" rx="6" fill="#f97316" opacity="${(1 - i * 0.14).toFixed(2)}"/>
    <text x="${300 + w + 16}" y="${y + 24}" fill="#e7ebf3" font-size="24" font-family="${FONT}">${esc(fmtDuration(b.ms))}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0b0e14"/>
  <rect width="${W}" height="8" fill="#f97316"/>
  <circle cx="92" cy="104" r="10" fill="#f97316"/>
  <text x="116" y="114" fill="#8b93a7" font-size="30" font-family="${FONT}">clocked-in</text>
  <text x="80" y="205" fill="#e7ebf3" font-size="46" font-family="${FONT}">Holy shit — I waited</text>
  <text x="78" y="330" fill="#f97316" font-size="120" font-weight="700" font-family="${FONT}">${esc(big)}</text>
  <text x="80" y="378" fill="#e7ebf3" font-size="40" font-family="${FONT}">for my coding agents to finish.</text>
  ${rows}
  <text x="80" y="645" fill="#5b6377" font-size="24" font-family="${FONT}">${stats.turns} turns · measure yours: github.com/context-labs/clocked-in</text>
</svg>`;
}
