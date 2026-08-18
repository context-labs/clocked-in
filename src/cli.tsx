#!/usr/bin/env bun
// Statically import only the hot-path deps (hook + its light graph). Everything
// heavy (commander/Ink/resvg/history) is dynamically imported below, so the
// `hook` fast path never loads them — keeping per-event cost low.
import { KIND, type Kind } from "./events.ts";
import { runHook } from "./hook.ts";

const argv = process.argv.slice(2);

// --- Hot path: `hook` is spawned on every prompt/stop/tool call.
if (argv[0] === "hook") {
  const CLI_KIND: Record<string, Kind> = {
    start: KIND.start,
    stop: KIND.stop,
    "tool-start": KIND.tool_start,
    "tool-end": KIND.tool_end,
  };
  const kind = CLI_KIND[argv[1] ?? ""];
  if (kind) {
    const flag = (n: string) => {
      const i = argv.indexOf(`--${n}`);
      return i >= 0 ? argv[i + 1] : undefined;
    };
    await runHook(kind, {
      agent: flag("agent"),
      session: flag("session"),
      tool: flag("tool"),
      toolId: flag("tool-id"),
    });
  }
  process.exit(0);
}

// --- Everything else: the full CLI. Imports are lazy so the hot path above
// never pays for commander/Ink/resvg.
const { Command } = await import("commander");
const { allEvents } = await import("./db.ts");
const { report } = await import("./report.ts");
const { installAgents, uninstallAgents } = await import("./install.ts");
const { AGENTS } = await import("./agents.ts");
const { VERSION } = await import("./version.ts");

const program = new Command();
program
  .name("clocked-in")
  .description("Measure how much time you spend waiting for coding agents.")
  .version(VERSION);

// Default: open the TUI. Non-interactive (piped/CI) → print the text report.
// Note: reads only what's recorded — never triggers a history backfill (that's
// `clocked-in history`, opt-in), so the default view stays fast and predictable.
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
  .command("history")
  .description("Backfill completed turns from saved Codex & Claude Code history (opt-in, one-off)")
  .action(async () => {
    const { syncHistory } = await import("./history.ts");
    const r = syncHistory();
    const s = (n: number) => (n === 1 ? "" : "s");
    console.log(
      `✓ scanned ${r.files} history file${s(r.files)}; found ${r.found} completed turn${s(r.found)}; imported ${r.imported}.`,
    );
    if (r.imported)
      console.log(
        "  Run `clocked-in` to see the backfilled time. Re-running is safe (already-imported turns are skipped).",
      );
  });

program
  .command("install [agents...]")
  .description(`Install hooks (defaults to every detected agent). Agents: ${AGENTS.join(", ")}`)
  .option("-a, --all", "install into every detected agent (the default)")
  .option("--local", "point hooks at this checkout (dev) instead of the installed bin")
  .action((agents: string[], opts) => {
    const all = opts.all || agents.length === 0; // default to --all when none named
    const results = installAgents(agents, { ...opts, all });
    if (!results.length)
      return console.log(
        "No supported agents found on this machine (looked for ~/.claude, ~/.codex, ~/.grok, ~/.cursor, ~/.config/opencode, ~/.config/pi).",
      );
    for (const r of results)
      console.log(
        `✓ ${r.name.padEnd(12)} ${r.path}${r.unverified ? "  (unverified — verify it works)" : ""}`,
      );
    console.log("\nRestart the agent(s), then run `clocked-in` to watch the damage.");
    console.log("Want time from before you installed hooks? Run `clocked-in history`.");
  });

program
  .command("uninstall [agents...]")
  .description("Remove hooks (defaults to all; only clocked-in's — your other hooks are kept)")
  .option("-a, --all", "remove from every agent (the default)")
  .action((agents: string[], opts) => {
    const all = opts.all || agents.length === 0;
    const results = uninstallAgents(agents, { ...opts, all });
    if (!results.length) return console.log("Nothing to uninstall.");
    for (const r of results) console.log(`✓ removed from ${r.name}`);
  });

program
  .command("share")
  .description("Generate a share image + draft a tweet")
  .option("-o, --out <path>", "output PNG path")
  .option("--no-open", "don't open X or copy to clipboard")
  .action(async (opts) => {
    try {
      const { share } = await import("./share.ts");
      const { png, text, url } = share(allEvents(), { out: opts.out, open: opts.open });
      console.log(`✓ image → ${png}\n\n${text}\n\nShare it: ${url}`);
      if (opts.open) console.log("(attempted to copy tweet to clipboard and open X)");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

program
  .command("version")
  .description(
    "Show version, commit, and this binary's sha256 (to verify against the published checksum)",
  )
  .action(async () => (await import("./release.ts")).printVersion());

program
  .command("update")
  .description("Download and verify the latest released binary, then replace this one")
  .action(async () => {
    try {
      await (await import("./release.ts")).runUpdate();
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

await program.parseAsync();
