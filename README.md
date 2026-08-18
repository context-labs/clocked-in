# clocked-in ⏱

**How much of your life do you spend watching a coding agent think?**

`clocked-in` puts tiny hooks in your coding agents (Claude Code, Codex, Grok,
Cursor, opencode, pi), records the gap between *you hit enter* and *the agent
finishes*, and adds it up. It's a marketing stunt with a point: **slow harnesses
cost you real hours — measure yours.**

```
⏱  clocked-in

 Human wait    6h 12m   real time you sat waiting
 Agent-time   15h 34m   across 318 turns (sums concurrent)
 Today         1h 03m

 claude-code  ████████████████████████   9h 21m (188)
 codex        ████████████░░░░░░░░░░░░   3h 21m (41)
 grok         ████░░░░░░░░░░░░░░░░░░░░   2h  2m (18)

 by action
 run          3h 02m   edit  1h 30m   read  48m   mcp  22m

 [q]uit  [s]hare  [r]eset
```

## Install

One line. No `sudo`, no global npm, no Bun required — it installs a single
self-contained binary:

```sh
curl -fsSL https://raw.githubusercontent.com/context-labs/clocked-in/main/install.sh | sh
```

The installer downloads the binary for your platform, **verifies its SHA-256
against the published checksums**, drops it on your `PATH`, and wires the hooks
into every agent it finds. Then:

```sh
clocked-in            # live TUI
clocked-in history    # (optional) backfill time from before you installed hooks
clocked-in update     # upgrade to the latest release (re-verifies the checksum)
clocked-in version    # version, commit, and this binary's own sha256
```

Wary of `curl | sh`? Good instinct. See **[Is this safe?](#is-this-safe)** — or
read [`install.sh`](install.sh) first (it's ~90 lines and prints everything it
does), then run it.

<details>
<summary>Prefer a package manager, or hacking on it? (needs <a href="https://bun.sh">Bun</a>)</summary>

```sh
bun install -g github:context-labs/clocked-in#main   # or npm/pnpm/yarn add -g …
clocked-in install                                   # wire hooks (defaults to all agents)
```

Bun installs run under Bun (they use `bun:sqlite`). If a reinstall keeps an old
version, `bun remove -g clocked-in` first — Bun pins the first-resolved commit.
</details>

## Is this safe?

The whole point is that you can trust it, so nothing is hidden:

- **Open source, reproducible.** The published binary is compiled from this repo
  with `bun build --compile` in [CI](.github/workflows/release.yml). `clocked-in
  version` prints the exact **commit** it was built from and the **sha256 of the
  binary you're running** — compare it to `SHA256SUMS` on the
  [release](https://github.com/context-labs/clocked-in/releases). The installer
  and `update` refuse to install anything whose checksum doesn't match.
- **Local-only.** Every event goes to a SQLite file at `~/.clocked-in`. No
  network, no accounts, no telemetry. The only time it touches the internet is
  `install`/`update`, which fetch from GitHub Releases.
- **It only records timestamps** — when a turn started and stopped, the agent,
  model, and tool name. Not your prompts, code, or output.
- **Nothing runs behind your back.** Hooks record as you work; the optional
  `clocked-in history` backfill runs **only when you run it**. The default view
  never scans your files or backfills.
- **Clean uninstall.** `clocked-in uninstall` removes only clocked-in's hooks and
  leaves your own untouched. Delete `~/.clocked-in` to erase the data.

## What you get

**Human wait vs agent-time.** Ten agents working an hour *at once* isn't ten
hours of your life. `clocked-in` reports the **union** of busy intervals (real
time you waited) next to the raw sum.

**Breakdowns**, in `report` and the TUI:

- **by agent** — which harness cost you the most.
- **by model & effort** — e.g. `claude-opus-4-8 · high` vs `gpt-5.6-terra · xhigh`.
- **by tool** and **by action** (run / edit / read / search / subagent / mcp / web).

**A share card.** `clocked-in share` renders a "Holy shit I waited N hours" PNG,
copies a drafted tweet, and (if it can) opens X. Works headless — it always
prints the tweet URL.

**Backfill (opt-in).** Installed hooks only see turns from *now on*. To count
what you already spent, `clocked-in history` reads the transcripts Codex
(`~/.codex/sessions`) and Claude Code (`~/.claude/projects`) already save on
disk, derives completed turns, and imports them (tagged `source: history`). It
**deduplicates** against what hooks already recorded (±5s) so nothing is
double-counted, and re-running is safe. It runs **only when you invoke it** —
never automatically.

Every event is stored raw (timestamp, agent, session, model, effort, tool, cwd,
source), so heatmaps and other views can be added later without re-recording.

## Supported agents

| Agent | Where hooks go |
|-------|----------------|
| Claude Code | `~/.claude/settings.json` (merged) |
| Codex | `~/.codex/hooks.json` (merged) |
| Grok | `~/.grok/hooks/clocked-in.json` |
| Cursor (IDE + `cursor-agent`) | `~/.cursor/hooks.json` (merged) |
| opencode | `~/.config/opencode/plugin/clocked-in.ts` |
| pi | `~/.config/pi/extensions/clocked-in.ts` ¹ |

Each registers prompt-submit, stop, and per-tool (`PreToolUse`/`PostToolUse`)
hooks. `install` only touches agents actually present. ¹ pi's installer is
written from its docs and not yet runtime-verified; the rest are.

## How it measures

- `start` = you submitted a prompt; `stop` = the agent finished (model/effort
  read from the transcript or hook stdin here); `tool-start`/`tool-end` bracket
  each tool call.
- Each `start` pairs with the next `stop` in the same session (re-prompting
  replaces the pending start — you interrupted).

*Ceiling:* submit→stop counts time you spent answering permission prompts as
"waiting". Documented; refine later.

## Develop

```sh
git clone git@github.com:context-labs/clocked-in.git && cd clocked-in
bun install
task check              # tsgo + oxlint + oxfmt + bun test
task dev -- report      # run from source
bun run build           # rebuild the committed dist/ bundles (commit them)
bun run build:release   # cross-compile the release binaries + SHA256SUMS
```

- `dist/cli.js` + `dist/hook-cli.js` are **committed** bundles for the bun/npm
  install path (`clocked-in-hook` is the ~10 ms hot-path bin). Rebuild after
  changing `src/`.
- Release binaries are single-file `bun --compile` executables (the hot path is
  ~30 ms via a top-of-`cli.tsx` short-circuit); a git tag `v*` triggers the
  release workflow.
- Installing hooks from a checkout? `clocked-in install --local` points them at
  your source.

Stack: Bun · `bun:sqlite` · commander · Ink · `@resvg/resvg-js` · oxlint/oxfmt ·
tsgo (TypeScript 7 preview). MIT. Bundled font: Geist (SIL OFL 1.1).
