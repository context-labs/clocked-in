import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { INSTALLERS, installerFor, type AgentInstaller } from "./agents.ts";

export type InstallResult = { name: string; path: string; unverified?: boolean };

// The command an agent's hook invokes — the fast hook bin (no commander/Ink/
// resvg, ~5-10ms). Globally installed -> `clocked-in-hook` on PATH.
// `--local` embeds absolute paths to this checkout (bun + the hook script) so it
// works under /bin/sh regardless of PATH. The hook script is the sibling of the
// running entry: hook-cli.ts when run from src/, hook-cli.js when run from dist/.
export function resolveBase(local: boolean): string {
  if (!local) return "clocked-in-hook";
  const ts = resolve(import.meta.dir, "hook-cli.ts");
  const script = existsSync(ts) ? ts : resolve(import.meta.dir, "hook-cli.js");
  return `${process.execPath} ${script}`;
}

// Which agents to act on: explicit names, or (--all) every detected one.
function pick(names: string[], all: boolean, home: string): AgentInstaller[] {
  if (all) return INSTALLERS.filter((a) => a.detected(home));
  return names.map(installerFor).filter((a): a is AgentInstaller => Boolean(a));
}

export function installAgents(
  names: string[],
  opts: { all?: boolean; local?: boolean; home?: string } = {},
): InstallResult[] {
  const home = opts.home ?? homedir();
  const base = resolveBase(Boolean(opts.local));
  return pick(names, Boolean(opts.all), home).map((a) => {
    a.install(base, home);
    return { name: a.name, path: a.path(home), unverified: a.unverified };
  });
}

export function uninstallAgents(
  names: string[],
  opts: { all?: boolean; home?: string } = {},
): InstallResult[] {
  const home = opts.home ?? homedir();
  // Uninstall ignores `detected` — remove from every agent we might have touched.
  const targets = opts.all
    ? INSTALLERS
    : names.map(installerFor).filter((a): a is AgentInstaller => Boolean(a));
  return targets.map((a) => {
    a.uninstall(home);
    return { name: a.name, path: a.path(home) };
  });
}
