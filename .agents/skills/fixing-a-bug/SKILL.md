---
name: fixing-a-bug
description: >-
  The disciplined playbook for fixing a bug in the clocked-in repo — reproduce
  and root-cause BEFORE changing code, prove it with a failing test, fix at the
  right layer, verify the gate, then clean up. Use whenever something is broken
  or wrong ("X isn't recording", "the report is off", "the hook crashed/hung",
  "install clobbered my hooks", "this regressed", a pasted stack trace or wrong
  number) — i.e. making existing behavior correct again, not building something
  new (that's new-feature-development). Pulls in running-tests to reproduce,
  multi-model-orchestration to delegate/cross-check the fix, and
  /adversarial-code-review + /ponytail-review to clean up.
metadata:
  category: clocked-in
---

# Fixing a bug in clocked-in

Your instinct under pressure is to jump to a fix. Resist it. The most expensive
mistake is **treating a symptom** — a plausible patch that hides the real defect
so it resurfaces or silently records wrong data. **Reproduce it, understand the
mechanism, and prove the fix with a test** before you commit. The fix is usually
the easy part.

This repo is small and self-contained (a Bun CLI, `bun:sqlite`, no services), so
the loop is short — but the discipline is the same.

## The loop

### 0. Get specifics
What's the exact symptom, and where? Which agent (claude-code / codex / grok /
cursor / opencode / pi)? Which command (`report`, the TUI, `install`, a hook)?
Expected vs actual. A concrete number that's wrong ("shows 10h, should be ~1h")
or a copied error beats "it's broken."

### 1. Reproduce — before touching code
Get to certainty first. Most bugs here reduce to a **pure-function repro**:
construct the `Event[]` and call `pairIntervals` / `toolIntervals` / `unionMs` /
`computeStats` / `resolveEvent` directly. If it's an end-to-end symptom, drive
the real bins against a throwaway DB (`CLOCKED_IN_DB=/tmp/x.db bun dist/hook-cli.js …`
then `bun dist/cli.js report`) — see the **running-tests** skill. Remember the
committed-bundle gotcha: rebuild `dist/` (`bun run build`) before any e2e check.

Stay skeptical of the reported cause. "opencode isn't recording" might be a
missing plugin, a wrong session id, a DB-path mismatch, or a stdin hang — confirm
which.

### 2. Root-cause — state the mechanism in one sentence
You should be able to say exactly why: *"`OUR_CMD` matched any command containing
`--agent grok`, so uninstall deleted the user's own hook,"* or *"the wait counts
each concurrent agent separately because it sums intervals instead of unioning
them."* If you can't articulate the mechanism, keep digging — don't patch.

Where bugs live in this repo:
- **Pairing / math** (`src/events.ts`, `src/stats.ts`) — off-by-one, wrong key,
  overlap/union edge cases, cutoff filtering, action mapping.
- **Hook input** (`src/hook.ts`) — a harness field named differently
  (snake/camel/`conversation_id`), precedence, transcript parsing.
- **Installers** (`src/agents.ts`) — the ownership marker matching too much/little,
  a per-agent config shape, the generated plugin strings.
- **DB** (`src/db.ts`) — column migration, null↔undefined mapping.
- **The bins** — forgetting to rebuild `dist/`, or the hot path importing
  something heavy/slow.

### 3. Write a failing test — red before green
Lock the bug down with a regression test that **fails now, passes after**. Prefer
the pure level (`src/events.test.ts`, `src/stats.test.ts`, `src/hook.test.ts`) —
it's where the logic lives and the test stays fast and durable. For installer
bugs use a temp HOME (`src/agents.test.ts`). Run it and **watch it fail** — a
test written after the fix that only agrees with it proves nothing. If a bug
genuinely can't be a test (a packaging/path issue), say so and state how you'll
otherwise verify.

### 4. Fix at the right layer — minimally (ponytail)
Smallest correct change that addresses the **mechanism**, in the layer that owns
it: pairing bugs in `events.ts`, not patched in the report; input-shape bugs in
`resolveEvent`, not in each installer. Non-negotiables for this repo:
- **A hook must never disrupt the agent** — `runHook` swallows all errors, the
  hook bins always `process.exit(0)`, and stdin reads must not block. Don't add a
  throw or an unbounded await on the hook path.
- **Keep the hot path lean** — `clocked-in-hook` must not gain
  commander/Ink/resvg imports; that's what keeps it ~10 ms.
- **Prefer a named constant/union** over a second hardcoded string when the
  mechanism is a drifted literal — and repoint every call site.
- Don't smuggle a refactor into a bug fix.

Well-specified fix? Route the typing to another model family via
**multi-model-orchestration** (grok/codex) and keep the diagnosis + verification
yourself; a subtle fix is worth racing two lanes.

### 5. Verify
- The regression test now **passes**, and genuinely failed before (flip it if
  unsure).
- The original symptom is gone (re-run the repro).
- **`task check` is green** (tsgo + oxlint + oxfmt + tests).
- **Rebuild `dist/` and re-check any e2e path** — the installed bins run the
  bundle, not `src/`. Commit the rebuilt `dist/`.
- No collateral damage — run the full suite, not just the file you touched.

### 6. Clean up and review
Run **`/ponytail-review`** to catch a fix that over-reached, then
**`/adversarial-code-review`** for a model-diverse pass that ends in verified
fixes. A bug fix reviewed only by the model that wrote it is rubber-stamped. Fix
what survives.

## Anti-patterns to refuse
- Editing code before the bug is reproduced — you can't know you fixed it.
- Accepting the reporter's theory without verifying the mechanism.
- Patching the symptom (swallow the error, clamp the number, add a retry) when
  the defect is upstream.
- Committing with no failing-then-passing test and no articulated mechanism.
- Adding a throw, an unbounded stdin await, or a heavy import to the hook path.
- Fixing an e2e symptom without rebuilding `dist/` — you're testing stale code.
- Correcting one copy of a duplicated literal instead of extracting a shared
  constant and repointing every call site.
- Letting the fix balloon into an unscoped refactor, or leaving the code messier.
- Calling it done with `task check` red or the repro still present.
