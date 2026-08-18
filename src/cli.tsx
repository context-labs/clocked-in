#!/usr/bin/env bun
import { Command } from "commander";
import { allEvents } from "./db.ts";
import { KIND } from "./events.ts";
import { runHook } from "./hook.ts";
import { installAgents, uninstallAgents } from "./install.ts";
import { report } from "./report.ts";
import { share } from "./share.ts";
import { AGENTS } from "./agents.ts";

const program = new Command();
program
  .name("clocked-in")
  .description("Measure how much time you spend waiting for coding agents.")
  .version("0.1.0");

// Default: open the TUI (lazy-imported so `hook`, the hot path, skips Ink/React).
// Non-interactive (piped/CI) → print the text report instead of crashing on raw mode.
program.action(async () => {
  if (!process.stdout.isTTY) return console.log(report(allEvents()));
  const { runTui } = await import("./tui.tsx");
  runTui();
});

program
  .command("report")
  .description("Print a text summary of time spent waiting")
  .option("-d, --days <n>", "only the last N days", (v) => Number(v))
  .action((opts) => console.log(report(allEvents(), { days: opts.days })));

program
  .command("install [agents...]")
  .description(`Install hooks. Agents: ${AGENTS.join(", ")}`)
  .option("-a, --all", "install into every detected agent")
  .option("--local", "point hooks at this checkout (dev) instead of the global bin")
  .action((agents: string[], opts) => {
    const results = installAgents(agents, opts);
    if (!results.length)
      return console.log(
        "Nothing installed. Pass agent names or --all (are any agents installed?).",
      );
    for (const r of results)
      console.log(
        `✓ ${r.name.padEnd(12)} ${r.path}${r.unverified ? "  (unverified — verify it works)" : ""}`,
      );
    console.log("\nRestart the agent(s), then run `clocked-in` to watch the damage.");
  });

program
  .command("uninstall [agents...]")
  .description("Remove hooks (only clocked-in's; your other hooks are kept)")
  .option("-a, --all", "remove from every agent")
  .action((agents: string[], opts) => {
    const results = uninstallAgents(agents, opts);
    if (!results.length) return console.log("Nothing to uninstall. Pass agent names or --all.");
    for (const r of results) console.log(`✓ removed from ${r.name}`);
  });

program
  .command("hook <kind>")
  .description("(internal) record a start/stop event; called by agent hooks")
  .option("--agent <name>", "agent name")
  .option("--session <id>", "session id")
  .action(async (kind: string, opts) => {
    if (kind !== KIND.start && kind !== KIND.stop) process.exit(0);
    await runHook(kind, opts);
    process.exit(0); // hooks must always exit clean
  });

program
  .command("share")
  .description("Generate a share image + draft a tweet")
  .option("-o, --out <path>", "output PNG path")
  .option("--no-open", "don't open X or copy to clipboard")
  .action((opts) => {
    try {
      const { png, text } = share(allEvents(), { out: opts.out, open: opts.open });
      console.log(`✓ image → ${png}\n\n${text}\n`);
      if (opts.open) console.log("(tweet copied to clipboard, X opened)");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

program.parseAsync();
