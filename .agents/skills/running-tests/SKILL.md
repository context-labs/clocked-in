---
name: running-tests
description: How to run and debug tests in the clocked-in repo — a small Bun CLI. Covers `bun test`, the `task check` gate (tsgo + oxlint + oxfmt + tests), running a single file or test, how DB/HOME isolation works, the committed-bundle rebuild gotcha, and end-to-end checks (hook → report, the Ink TUI in a pty, a real opencode run). Use whenever the user asks to run tests, verify a change, reproduce a failure, or mentions "unit test", "task check", "test hangs", or "test fails".
metadata:
  category: clocked-in
---

# Running tests in clocked-in

Everything runs under **Bun**. There is no external infrastructure — no Docker,
no server, no DB to boot. Tests are `bun:test` files next to the code
(`src/*.test.ts`). Pure logic (`events.ts`, `stats.ts`) is tested directly;
I/O (`db.ts`, `hook.ts`, installers) is tested against a **temp** SQLite DB and
a **temp** HOME so nothing touches your real `~/.clocked-in`.

## The commands

| Goal | Command |
| --- | --- |
| All tests | `bun test` (or `task test`) |
| The full gate (what CI/`/code-review` expects) | `task check` |
| One file | `bun test src/events.test.ts` |
| One test by name | `bun test -t "unionMs counts overlapping"` |
| Typecheck only | `task typecheck` (`bunx tsgo --noEmit`) |
| Lint / format | `task lint` · `task fmt` |

`task check` runs, in order: `tsgo --noEmit` → `oxlint` → `oxfmt --check src`
→ `bun test`. A change isn't done until it's green.

## How isolation works (don't skip it)

Tests must never read or write the real `~/.clocked-in/clocked-in.db`.

- **DB tests** pass an explicit path: `insertEvent(e, path)` / `allEvents(path)`
  with a `mkdtemp`/`tmpdir` file, cleaned up in `afterAll`. The DB handle is
  cached per-path, so distinct temp paths stay isolated.
- **Installer tests** create a temp HOME (`mkdtempSync`) and call
  `installAgents([...], { home })` — never the real `homedir()`.
- **Pure functions** (`pairIntervals`, `toolIntervals`, `unionMs`, `toolAction`,
  `computeStats`, `resolveEvent`, `metaFromTranscript`) take their inputs as
  arguments and need no isolation — prefer testing here; it's the fastest, most
  durable level.

`resolveEvent`/`metaFromTranscript` are exported precisely so the hook can be
tested **without stdin** — never write a test that pipes to a real hook process
(it can block on stdin; see below).

## The committed-bundle gotcha

The installed hooks and the `clocked-in` / `clocked-in-hook` bins run the
**committed bundles** in `dist/`, not `src/`. `bun test` and `task dev` use
`src/` directly, but any **end-to-end** check through the bins needs a rebuild:

```bash
bun run build     # regenerates dist/cli.js + dist/hook-cli.js
```

If an e2e check behaves like your edit didn't happen, you forgot `bun run build`.

## End-to-end checks

Drive the real bins against a throwaway DB:

```bash
export CLOCKED_IN_DB=/tmp/e2e.db && rm -f "$CLOCKED_IN_DB"
echo '{"session_id":"s","transcript_path":"/path/to/transcript.jsonl"}' \
  | bun dist/hook-cli.js start --agent claude-code
bun dist/hook-cli.js tool-start --agent claude-code --session s --tool Bash --tool-id 1
bun dist/hook-cli.js tool-end   --agent claude-code --session s --tool Bash --tool-id 1
bun dist/cli.js report
```

**The Ink TUI** needs a real terminal — capture it in a pty:

```bash
timeout 3 script -qec "bun dist/cli.js" /dev/null </dev/null | cat -v
```

**A real agent** (opencode is installable here): install the plugin
(`bun dist/cli.js install opencode --local`), run
`opencode run --model <provider/model> "use the bash tool to echo hi"`, then
confirm events landed with `bun dist/cli.js report`.

## Troubleshooting

1. **A hook test hangs** → you're reading stdin from a non-TTY that never
   closes. Test `resolveEvent`/`metaFromTranscript` (pure) instead of spawning a
   hook. The real hook bounds this with a 300 ms stdin-read timeout, but tests
   shouldn't rely on it.
2. **`toEqual` fails on an object with extra `undefined` keys** → `bun:test`
   treats `{a:1}` and `{a:1,b:undefined}` as equal, so that's not it; look for a
   real value mismatch.
3. **e2e shows stale behavior** → run `bun run build` (the bins are bundled).
4. **oxlint flags `dist/`** → it shouldn't (`.oxlintrc.json` ignores it); if it
   does, that file was removed.
5. **A test writes to your real `~/.clocked-in`** → it's missing the temp-path /
   temp-HOME isolation above. Fix the test, not the DB.
