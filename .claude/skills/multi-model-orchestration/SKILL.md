---
name: multi-model-orchestration
description: Vendor-neutral routing doctrine for delegating implementation work across the Claude Code, Grok, and Codex CLIs. Whichever model hosts the session acts as architect and routes typing to the other two families. Use when delegating implementation, choosing an implementation lane, writing a spec for another agent, racing two model families on the same spec, checking whether a CLI lane is usable, or managing session token cost on a multi-task build. Replaces the fable-advisor `/orchestration` plugin skill, whose auth preflight and grok flag set both produce false failures.
metadata:
  managed-by: context-labs/inf-internal-skills
  category: general-capabilities
---

# Multi-model orchestration

The session is the architect regardless of which model runs it. It owns requirements, decomposition, interface design, specs, routing, and verification. It should rarely type implementation code — that goes to a different model family via its CLI.

## Identify your own lane first

Three lanes exist. **You are one of them. Never delegate to your own family** — that buys no independent perspective and costs a process spawn.

| Host | Delegate to |
|---|---|
| Claude Code | `grok`, `codex` |
| Grok CLI | `claude`, `codex` |
| Codex CLI | `claude`, `grok` |

## Preflight — the only trustworthy auth check

```bash
SKILL_DIR=<this skill's directory>   # the directory containing this SKILL.md, e.g. .agents/skills/multi-model-orchestration
$SKILL_DIR/scripts/lane-preflight.sh --self claude
```

Substitute your own lane for `--self`. The script writes a random token into a file and asks each other CLI to **read that file** and report the token, then reports `available | missing | unusable | timeout`.

It probes a file read rather than an echo on purpose. Every lane exists to read the repo, and a lane whose filesystem sandbox is broken still answers an echo from the model alone — so an echo probe reports `available` for a lane that cannot open a single file. The token exists only inside the file and is regenerated per run, so no lane can pass by echoing the prompt or guessing.

**Never decide a lane is unauthenticated from a CLI's self-reported login state.** Those probes are wrong in both directions and were the cause of the `/orchestration` plugin's phantom failures:

- `grok models` prints `You are not authenticated.` and exits **0** on a fully working OIDC session. Its login probe only recognizes API-key auth; it does not read the OIDC credentials in `~/.grok/auth.json` that every real invocation uses.
- `codex --version` never contacts auth at all, so it "passes" for an account that cannot run a single request.
- Both exit 0 in every case, so neither the exit code nor a substring match carries information.

If a lane reads the probe file, it is usable. That round trip is the test. If a preflight probe disagrees with a lane that then works, trust the work and treat the probe as the bug.

A `timeout` result is not a failure — retry once at a longer timeout before routing around it.

### A lane that answers but cannot read files

`unusable [sandbox broken: the lane cannot read files ...]` means the CLI is authenticated and responding while every filesystem read fails. **Do not use such a lane for review or implementation.** It will still emit confident output — invented, because it never opened the code. Codex fails this way on Ubuntu 24 hosts: its bundled bubblewrap cannot create a user namespace, so every read dies with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.

Fix it on the host, not by disabling the sandbox:

```bash
sudo apt install -y bubblewrap            # system bwrap ships an AppArmor profile that is permitted
# or, if that is not enough:
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-userns.conf
```

Never route around it with `--dangerously-bypass-approvals-and-sandbox`: that trades a lane that reads nothing for a lane with unrestricted write access to the machine.

## Running a lane

Write the spec to a file, then:

```bash
$SKILL_DIR/scripts/run-lane.sh grok /tmp/spec-auth.md --effort high --require "Verification"
$SKILL_DIR/scripts/run-lane.sh codex /tmp/spec-auth.md --timeout 900 --require "Verification"
```

Always pass `--require` with a string the spec obligates the final message to
contain (the verification section's heading is the natural choice). CLIs can
die mid-session and still exit 0 with only their opening narration captured —
a phantom success that reads as a completed run (INF-4818, observed four times
in one day on grok). The guard turns that into exit 5
(`unusable [required marker missing…]`) so the caller re-routes instead of
trusting it; a sub-300-byte rc=0 transcript trips the same guard even without
`--require`.

Never inline a spec in shell quoting — long specs get mangled or truncated. The script writes a unique transcript per run, so parallel lanes cannot clobber each other. See [`lanes.md`](./lanes.md) for the exact flags, why each one is required, and the failure modes each prevents.

## The spec contract

Lanes share none of your conversation context. Every delegation carries all five parts:

1. **Objective** — what to build or change, one paragraph
2. **Files** — exact paths to create or modify
3. **Interfaces** — signatures, types, or API shapes the code must match
4. **Constraints** — project conventions, things not to touch
5. **Verification** — the exact command that proves it works

End every spec with: *"Run the verification command and include its actual output in your final message."*

A spec you cannot finish writing means the decision isn't made yet. That is architect work, not ambiguity to hand down.

For work in this repo, point the lane at `CLAUDE.md` / `AGENTS.md` and the relevant skill SKILL.md files in the constraints section — lanes do not inherit your loaded instructions.

## Routing

When a `new-feature-development*` or `fixing-a-bug*` umbrella is driving,
follow [`model-routing.md`](./model-routing.md): ask which planner (fable /
opus / gpt-5.6-sol), then type on grok 4.6 high/xhigh and
`gpt-5.6-terra` at `--effort xhigh` (never the concatenated slug
`gpt-5.6-terra-xhigh` — LiteLLM 400s it). The family table below is the
fallback for work those umbrellas do not own.

Deciding rule: how much does the outcome depend on judgment the spec can't capture?

- **Little** — one lane, the cheapest available. Boilerplate, wiring, CRUD, mechanical edits, well-specified features. You verify anyway.
- **A lot, and mistakes are costly** — race both non-self lanes on the same spec and keep the stronger diff. Two independent families plus your review is three perspectives for one extra lane's cost.
- **The decision itself is unsettled** — that's not a delegation. Resolve it first, alone or with a second-opinion consult.

Grok vs codex is not a capability ranking, it's a failure-distribution question. Pick for family diversity from the host, not for a presumed skill order.

Independent specs (no shared files, no ordering dependency) launch in parallel. Sequential chains and single-file surgery stay serial.

## Cost discipline

The architect's tokens are the expensive ones and get re-read every turn.

- **Emit judgment, not volume.** A code block longer than an interface signature is a spec you haven't delegated yet.
- **Keep context lean.** Delegate codebase searches and log-grepping to a cheap read-only agent; keep the conclusions, not the dumps.
- **Reason once, then hand off.** Capture the thinking in the spec instead of re-deriving it each turn.
- **Fix by re-spec, not by hand.** A lane's bug goes back to the lane as a corrected spec.

## Verification is non-negotiable

Lane reports are claims, not evidence. Before accepting any diff:

1. Read the diff (`git diff`, `git status`).
2. Re-run the spec's verification command **yourself**.
3. Check the diff against what the lane said it did — silent no-ops report success.

"Should work", "tests should pass", or a report with no command output means the task is not done.

## Failure handling

If a lane returns `unusable` (exit 3 or the exit-5 completion guard), `timeout`, or a bad diff, re-route the same spec to the other lane and **say so explicitly in your report**. Never quietly absorb the substitution — the caller chose a vendor profile deliberately.

If every other lane is unavailable, implement it yourself and state the downgrade plainly. Do not pretend a lane ran.
