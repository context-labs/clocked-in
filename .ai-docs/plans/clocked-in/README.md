# clocked-in

**Branch:** master

## What this does

An open-source CLI that measures how much wall-clock time a developer spends
*waiting for coding agents to finish*. It installs lightweight hooks into each
agent (Claude Code, Codex, Grok, opencode, pi), records a `start` when you
submit a prompt and a `stop` when the agent finishes, and stores the paired
intervals in a local SQLite DB. A `report`, an Ink **TUI**, and a `share`
command (tweet + generated image) surface the total. The point is a marketing
stunt: show how much of your life you lose watching slow harnesses.

## Goal

- One command to install hooks across all supported agents (`install --all`)
  and one to remove them cleanly (`uninstall --all`).
- Accurate per-turn wait measurement (`UserPromptSubmit`→`Stop`), per agent.
- `clocked-in` (no args) opens a live TUI of cumulative time.
- `clocked-in share` → PNG card ("Holy shit I waited XXX for my agents") +
  drafted tweet, opens X intent, copies text.
- Trivial install for end users: `bun install -g clocked-in`.

## Non-goals

- Not measuring token cost, latency-per-token, or model quality — just wall time.
- Not a daemon/background service. Hooks write; the CLI reads.
- Not subtracting time the user spent answering permission prompts (v1 counts
  submit→stop as "wait"; documented ceiling, refine later via Notification).
- No cloud sync, accounts, or telemetry. Data stays on the machine.

## Decisions (from user)

- **Runtime/dist:** npm package, run under Bun (`bun install -g` / `bunx`). DB =
  `bun:sqlite`.
- **TUI:** Ink (React).
- **Share image:** designed SVG → PNG via `@resvg/resvg-js`.
- **Tooling:** `Taskfile.yaml`, `oxlint` + `oxfmt`, `tsgo` (TypeScript 7 native
  preview) for typecheck.

## Design

Data at `~/.clocked-in/clocked-in.db` (override `CLOCKED_IN_DB`).

```
src/
  cli.ts        commander program; subcommands dispatch here. bin -> this.
  db.ts         bun:sqlite: open+migrate, insertEvent, allEvents.
  events.ts     Event/Interval types, pairIntervals (pure, tested), fmtDuration.
  hook.ts       `hook <start|stop>`: parse stdin (snake/camelCase)+env+flags, insert. Always exit 0, silent.
  report.ts     text report from paired intervals (--days window).
  stats.ts      shared aggregation: totals, byAgent, longest, today. Used by report/tui/share.
  tui.tsx       Ink app: cumulative total, per-agent bars, today, keybinds.
  agents.ts     registry: one entry per agent with install()/uninstall()/detected().
  install.ts    orchestrates install/uninstall across agents (--all / named).
  share.ts      build stats -> tweet text + SVG card -> PNG; copy + open X.
  card.ts       SVG template (1200x675) for the share image.
```

### Agent integration (two styles)

Command string agents call is `clocked-in hook start --agent <name>` (global bin
on PATH). `--local` writes `bun <abs>/src/cli.ts …` for dev installs.

- **JSON command hooks** (near-identical `UserPromptSubmit`/`Stop`):
  - **Claude Code** — merge into `~/.claude/settings.json` `hooks`.
  - **Codex** — `~/.codex/hooks.json`.
  - **Grok** — `~/.grok/hooks/clocked-in.json` (own file, Claude-compatible; sends camelCase `sessionId`).
- **TS plugin modules** (shell out to `clocked-in hook`):
  - **opencode** — `~/.config/opencode/plugin/clocked-in.ts`; user-message → start, `session.idle` → stop. *(written from docs; not runtime-verified — opencode not installed here)*
  - **pi** — extension module in pi's extensions dir; subscribe to prompt/turn events. *(same caveat)*

Install/uninstall is **idempotent** and marker-based: our hook entries are
identified by the `clocked-in hook` substring in the command, so uninstall
filters them out without clobbering the user's other hooks. Merges preserve
existing JSON.

### hook input robustness

`hook` reads stdin JSON if present; accepts `session_id` OR `sessionId`, `cwd`,
falls back to `--session`, `CLAUDE_SESSION_ID`/`GROK_SESSION_ID`/… env, else
`"unknown"`. Never throws, never prints, always exit 0 — a hook must not disrupt
the agent.

### Measurement

`pairIntervals`: each `start` pairs with the next `stop` in the same session; a
new `start` before a `stop` replaces the pending one (interrupt). Already
implemented and unit-tested from v0.

## Tooling / Taskfile

- `task install` — `bun install`
- `task check` — `tsgo --noEmit` + `oxlint` + `oxfmt --check` + `bun test`
- `task fmt` — `oxfmt` (write) + `oxlint --fix`
- `task test`, `task dev` (`bun src/cli.tsx`), `task build`

## Test plan (unit, bun:test)

- `events.test.ts` — pairing (have it) + fmtDuration.
- `db.test.ts` — insert/read round-trip against a temp `CLOCKED_IN_DB`.
- `hook.test.ts` — input parsing: snake_case, camelCase, env fallback, `--flag`, empty stdin.
- `agents.test.ts` — install writes expected config into a temp HOME; uninstall removes only our entries and preserves others; idempotent double-install.
- `share.test.ts` — tweet text formatting for s/m/h/d; `renderCard` returns a non-empty PNG buffer with PNG magic bytes.

TUI is smoke-tested manually (Ink); no e2e.

## Task breakdown

1. [x] deps + package.json bin/scripts + Taskfile + tsconfig.
2. [x] db.ts + events.ts (port v0 core) + tests.
3. [x] hook.ts + cli.tsx wiring (`hook`, `report`) + tests.
4. [x] agents.ts + install.ts (`install`/`uninstall`, `--all`) + tests. Verified live on temp HOME for Claude/Codex/Grok.
5. [x] stats.ts + report.ts.
6. [x] share.ts + card.ts (+ resvg, bundled Geist font) + tests.
7. [x] tui.tsx (Ink) + default command (pty-verified render).
8. [x] README rewrite, `task check` green. Adversarial review: **still to run** (`/adversarial-code-review`).

## Decisions & deviations log

- Share image: dropped emoji from the card (resvg has no color-emoji support) and
  bundled **Geist** (OFL) rather than trusting system fonts — the CI box had none,
  which is exactly the failure users would hit. Font families were the blank-render
  culprit; fixed with absolute `fontFiles` path + `defaultFontFamily`.
- Uninstall marker: matching the literal `"clocked-in hook"` substring broke for
  `--local` installs (`bun /…/clocked-in/src/cli.tsx hook`). Switched to a regex on
  the command *signature* (`hook (start|stop) --agent <known>`). Regression test added.
- DB handle cached per-path (not a single global) so `CLOCKED_IN_DB` / tests isolate.
- Added `PRAGMA busy_timeout` for concurrent agent hooks; non-TTY `clocked-in`
  prints the report instead of crashing Ink's raw mode.
- opencode/pi installers written from docs only — flagged `unverified` in output.
```
