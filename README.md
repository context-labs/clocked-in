# clocked-in ⏱

**How much of your life do you spend watching a coding agent think?**

`clocked-in` installs tiny hooks into your coding agents (Claude Code, Codex,
Grok, opencode, pi), records the gap between *you hit enter* and *the agent
finishes*, and adds it all up. Open a live TUI, or run `share` to generate a
"holy shit I waited N hours" card for the timeline.

It's a marketing stunt with a point: **slow harnesses cost you real hours.**
Measure it.

```
⏱  clocked-in

 Total waited   15h 34m  across 247 turns
 Today           1h 03m
 Longest wait    6m 2s (claude-code)

 claude-code   ████████████████████████   9h 21m (188)
 codex         ████████████░░░░░░░░░░░░   3h 21m (41)
 grok          ████░░░░░░░░░░░░░░░░░░░░   2h 2m  (18)

 [q]uit  [s]hare  [r]eset
```

## Install

Not on npm yet — install straight from GitHub. **[Bun](https://bun.sh) is
required to run it** (the CLI ships a Bun-native binary and uses `bun:sqlite`),
but you can install it with whichever package manager you like:

```sh
bun install -g  github:context-labs/clocked-in     # recommended
npm  install -g github:context-labs/clocked-in
pnpm add -g     github:context-labs/clocked-in
yarn global add github:context-labs/clocked-in
```

Run it once without installing:

```sh
bunx github:context-labs/clocked-in            # or: pnpm dlx / npx github:context-labs/clocked-in
```

Getting a `tarball/ 404`, or an **old/broken version** even after reinstalling?
Two GitHub/Bun quirks, one fix. GitHub's API briefly caches a just-public repo
(404), and Bun pins the first-resolved commit in its global lockfile (so a plain
reinstall keeps the stale one). Remove it and pin the branch:

```sh
bun remove -g clocked-in
bun install -g github:context-labs/clocked-in#main
```

Any of these put a global `clocked-in` on your PATH — no build step (the bin is
prebundled). If `clocked-in` isn't found afterward, add Bun's global bin dir to
your PATH: `export PATH="$(bun pm bin -g):$PATH"`.

Then wire the hooks in:

```sh
clocked-in install --all      # wire hooks into every agent found on your machine
```

Restart your agent(s), work as usual, then:

```sh
clocked-in            # live TUI (default)
clocked-in report     # one-shot text summary  (--days 7 to window it)
clocked-in share      # generate a PNG card + draft a tweet, opens X
```

Remove everything just as easily — your own hooks are left untouched:

```sh
clocked-in uninstall --all
```

You can also target specific agents: `clocked-in install claude-code grok`.

## Supported agents

| Agent | Mechanism | Where |
|-------|-----------|-------|
| Claude Code | `UserPromptSubmit`/`Stop` hooks | `~/.claude/settings.json` (merged) |
| Codex | `UserPromptSubmit`/`Stop` hooks | `~/.codex/hooks.json` (merged) |
| Grok | Claude-compatible hooks | `~/.grok/hooks/clocked-in.json` |
| Cursor (IDE + `cursor-agent`) | `beforeSubmitPrompt`/`stop` hooks | `~/.cursor/hooks.json` (merged) |
| opencode | plugin (`session.idle`) | `~/.config/opencode/plugin/clocked-in.ts` ¹ |
| pi | extension | `~/.config/pi/extensions/clocked-in.ts` ¹ |

¹ Written from each tool's docs; verify after install (they weren't runtime-tested).

`install --all` only touches agents actually present on your machine.

## The share card

`clocked-in share` renders a 1200×675 PNG to `~/.clocked-in/share.png`, copies a
drafted tweet to your clipboard, and opens the X compose window. The image is
self-contained (bundled font) so it looks identical everywhere. `--no-open`
skips the clipboard/browser side effects; `--out <path>` picks the file.

## Breakdown by model & reasoning effort

`report` and the TUI also break your wait down **per harness → model → effort**:

```
  By model & effort:
    claude-code
      claude-opus-4-8        high         9h 21m  (188 turns)
      claude-sonnet-4        medium       1h 02m  (12 turns)
    codex
      gpt-5.6-terra          xhigh        3h 21m  (41 turns)
```

Model and effort are read on `stop` from the harness's transcript (Claude Code
records `message.model` + `effort`) or from the hook's stdin (Codex/Grok expose
`model`). When a harness exposes neither, the turn buckets as `unknown` / `—`.

## How it works

- `start` = you submitted a prompt (the wait begins).
- `stop`  = the agent finished (the wait ends); model + effort are captured here.
- Each `start` pairs with the next `stop` in the same session; re-prompting
  before a stop replaces the pending start (you interrupted).
- Events go into SQLite at `~/.clocked-in/clocked-in.db` (override `CLOCKED_IN_DB`).

*Caveat:* v1 counts submit→stop as "wait", which includes time you spent
answering permission prompts. Documented ceiling; refine later.

## Develop

```sh
git clone git@github.com:context-labs/clocked-in.git && cd clocked-in
bun install
task check          # tsgo typecheck + oxlint + oxfmt --check + bun test
task dev -- report  # run from source without a build
bun run build       # rebuild dist/cli.js (the committed, bundled bin) — commit it
task fmt
```

`dist/cli.js` is a **committed** single-file bundle (Ink + React + commander
inlined so a nested-`node_modules` install can't hit duplicate-React; only the
native `@resvg/resvg-js` and `bun:sqlite` stay external). Rebuild it with
`bun run build` whenever you change `src/` and commit the result.

Installing hooks from a source checkout? Use `clocked-in install --all --local`
so the hooks call your checkout (`bun …/cli.tsx`) instead of a global bin.

Stack: Bun · `bun:sqlite` · commander · Ink · `@resvg/resvg-js` · oxlint/oxfmt ·
tsgo (TypeScript 7 preview).

MIT. Bundled font: Geist (SIL OFL 1.1).
```
