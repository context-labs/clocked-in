#!/usr/bin/env bun
// The hot path. Agents spawn this on every prompt, stop, and tool call — so it
// must stay tiny: no commander, Ink, or resvg in its module graph, only db+hook.
// That keeps it ~5-10ms instead of ~40ms for the full CLI bundle.
import { KIND, type Kind } from "./events.ts";
import { runHook } from "./hook.ts";

const CLI_KIND: Record<string, Kind> = {
  start: KIND.start,
  stop: KIND.stop,
  "tool-start": KIND.tool_start,
  "tool-end": KIND.tool_end,
};

const argv = process.argv.slice(2);
const kind = CLI_KIND[argv[0] ?? ""];
if (!kind) process.exit(0); // unknown kind: never disrupt the agent

const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

await runHook(kind, {
  agent: flag("agent"),
  session: flag("session"),
  tool: flag("tool"),
  toolId: flag("tool-id"),
});
process.exit(0);
