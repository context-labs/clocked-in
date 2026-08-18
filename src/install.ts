import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { INSTALLERS, installerFor, type AgentInstaller } from "./agents.ts";
import { isCompiledBinary } from "./version.ts";

export type InstallResult = { name: string; path: string; unverified?: boolean };

// POSIX single-quote a path so it survives the shell the agent runs hooks in
// (paths can contain spaces). Embedded single quotes become '\''.
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

// The command an agent's hook invokes. Three install shapes:
// - standalone release binary: this binary's own absolute path + `hook`
//   (fast via cli.tsx's hot-path short-circuit; no PATH dependency).
// - bun/npm global: the tiny `clocked-in-hook` bin on PATH.
// - `--local` dev: absolute bun + the hook-cli sibling (ts from src/, js from dist/).
// Absolute paths are shell-quoted; the `clocked-in-hook` bin name needs none.
export function resolveBase(local: boolean): string {
  if (local) {
    const ts = resolve(import.meta.dir, "hook-cli.ts");
    const script = existsSync(ts) ? ts : resolve(import.meta.dir, "hook-cli.js");
    return `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  }
  if (isCompiledBinary()) return `${shellQuote(process.execPath)} hook`;
  return "clocked-in-hook";
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
