---
name: adversarial-code-review
description: Adversarial multi-model code review that finds real defects, proves them, and fixes them. Every available model family (grok, codex, claude — including the one hosting this session) reviews the diff independently and blind; every finding is then cross-examined by a lane that did not raise it, so nothing survives on one model's say-so. Confirmed behavioral defects get a failing test before the fix and a passing one after; confirmed structural problems get fixed with the suite staying green as the proof behavior did not change. Use whenever the user asks for a hard, thorough, adversarial, multi-model, or cross-vendor review — "review my branch with multiple models", "tear this apart", "adversarial review", "have grok and codex check this", "find the real bugs and fix them with tests", "second opinion from another model on this diff" — or wants a review that ends in verified fixes rather than a list of comments. Prefer this over a single-model review whenever correctness matters enough to pay for several model families.
metadata:
  managed-by: context-labs/inf-internal-skills
  category: general-capabilities
---

# Adversarial code review

A single model reviewing its own work is a rubber stamp. A single model reviewing anyone's work has blind spots correlated with its training. This skill runs several model families over the same diff independently, then makes them attack each other's findings, and only acts on what survives.

The output is not a list of comments. It is a set of defects that were **proven** — behavioral ones by a test that failed before the fix and passes after, structural ones by the suite staying green across a restructuring that visibly simplifies the code.

Composes [`thermo-nuclear-code-quality-review`](../thermo-nuclear-code-quality-review/SKILL.md) (the review standard — read it, it defines the bar) and [`multi-model-orchestration`](../multi-model-orchestration/SKILL.md) (how the lanes are driven).

## Why the phases are shaped this way

Three failure modes make naive multi-model review worse than useless, and each phase exists to close one:

**Models agree for the wrong reason.** Show model B what model A found and B will confirm it — deference is cheap and disagreement is expensive. So the find phase is *blind*: every lane gets an identical brief and never sees another lane's output.

**Plausible findings are expensive.** A confident, well-written, wrong finding sends you refactoring correct code. So every finding is cross-examined by a lane that did not raise it, under a brief that says *refute this*, with uncertainty resolving to refuted.

**"Fixed" usually means "changed."** A fix with no failing test before it is a guess. So confirmed defects are gated on proof, and the kind of proof depends on the kind of defect.

## Phase 0 — scope and lanes

```bash
SKILL_DIR=<this skill's directory>   # the directory containing this SKILL.md, e.g. .agents/skills/adversarial-code-review
SCOPE=$($SKILL_DIR/scripts/collect-scope.sh)
cat "$SCOPE/scope.md"
$SKILL_DIR/../multi-model-orchestration/scripts/lane-preflight.sh --self <your-lane>
```

`collect-scope.sh` resolves the base (an explicit `--base`, else the PR's base via `gh`, else the trunk), diffs from the merge-base so uncommitted work is included, and computes per-file line counts — including which files cross 1000 lines, which `thermo-nuclear` treats as a presumptive blocker. Computing this once beats three lanes each deriving it slightly differently.

Preflight tells you which lanes are usable. **Never conclude a lane is unauthenticated from a CLI's self-reported login state** — `grok models` reports "not authenticated" for working sessions. The preflight makes each lane read a file containing a random token, because a lane whose sandbox is broken answers an echo from the model alone and would otherwise probe as available.

A lane reported `unusable [sandbox broken: ...]` must not review: it stays responsive while every file read fails, so it produces confident findings about code it never opened. See the sandbox section in `multi-model-orchestration` for the host fix.

State the roster before proceeding: which lanes review, and which are down. A two-lane review is still worth running; a review silently missing a family is not.

## Phase 1 — find, blind and in parallel

Build the brief from [`references/find-brief.md`](./references/find-brief.md), filling the placeholders. For `{{CONVENTIONS}}`, paste the rules from the repo's `AGENTS.md` that actually bear on this diff — lanes do not inherit your loaded instructions, and a reviewer ignorant of house conventions generates confident nonsense about them.

```bash
$SKILL_DIR/scripts/fan-out-review.sh \
  --brief /tmp/find-brief.md --out "$SCOPE/find" --self <your-lane>
```

**Then review it yourself, to the same brief, before reading any lane's output.** You are one of the reviewers — the user is paying for your family's perspective too. Reading the others first contaminates it, and you will find yourself agreeing rather than looking.

Lanes run read-only by construction. A reviewer that can edit starts fixing mid-review, which corrupts the finding list and races the other lanes.

Merge the findings, deduplicating by (file, rough line, claim). Keep track of which lane raised each one — the next phase needs it. When two lanes independently raise the same defect, note it: independent agreement across families is the strongest signal available here, though it still gets cross-examined.

## Phase 2 — cross-examine

Every finding goes to at least one lane that **did not raise it**, using [`references/refute-brief.md`](./references/refute-brief.md). Route your own findings out to a CLI lane; take findings from a lane and judge them yourself. Self-review is the one thing this phase cannot allow.

Send blockers to two refuters when you have the lanes. Use single-refuter for the rest.

Resolve the verdicts:

| Verdicts | Outcome |
|---|---|
| All confirm | Confirmed. Act on it. |
| All refute | Dropped. Record it — a refuted finding is a useful result. |
| Split | You decide, having read the code yourself. Cite what settled it. |
| Confirmed with a correction | Act on the corrected version, not the original. |

A refuter that returns confirmed without stating the failure in its own words has deferred, not confirmed. Treat that as refuted.

Report the counts. "11 raised, 4 confirmed" tells the user something real about their diff; presenting only the 4 hides the review's precision.

## Phase 3 — prove and fix

Confirmed findings split into two tracks with different burdens of proof. Sort within each track by severity and do blockers first.

### Behavioral track — red before green

The gate: **no failing test, no fix.**

1. Write the test that expresses the defect. Follow [`writing-tests`](../writing-tests/SKILL.md) for style and placement.
2. Run it and watch it **fail**. Capture the actual failure output.
3. If it passes, the finding is wrong no matter what the refuter said — a defect that cannot be made to fail was never real. Reclassify it as refuted and say so.
4. Fix at the layer that owns the defect, not where the symptom surfaced.
5. Run the test again and watch it **pass**. Capture that output too.
6. Run the surrounding suite. A fix that breaks a neighbor is not a fix.

The red output is the load-bearing artifact. Without it you have a test that agrees with your fix, which proves nothing.

Route the typing through a lane via `multi-model-orchestration` when the fix is well-specified. Keep the diagnosis and the verification yourself.

### Structural track — green across the change

Structural findings have no red state; the code already works. The proof is that behavior is unchanged while the shape measurably improves.

1. Establish green first. If the suite is already failing, that is the finding.
2. Make the restructuring. Aim for the code-judo move — deleting branches, helpers, or layers — not relocating complexity. `thermo-nuclear`'s bar: *does this make the code feel inevitable in hindsight?*
3. Run the full affected suite. Still green, with no test edits, is the evidence.
4. Record the shape delta concretely: line counts before/after, branches or files removed. "Cleaner" is not a result; `router.ts 1,240 → 680, three special-case branches deleted` is.

If a structural fix requires changing a test, stop. Either behavior changed — making it a behavioral finding needing the red→green gate — or the test was asserting the implementation rather than the contract, which is its own finding.

### When a fix is out of scope

Some confirmed findings are real and too large for this pass — a defect that predates the branch, a restructuring touching code the diff never went near. Fixing those silently turns a review into an unrequested refactor. Report them as confirmed-but-deferred with the reason, and let the user decide.

## Phase 4 — verify and report

Run the repo's full gate (`task check`) before reporting. Then:

```
ADVERSARIAL REVIEW
Scope: <base>..<head>, N files, +X/-Y
Lanes: <which reviewed> | Unavailable: <which, and why>
Findings: N raised -> M confirmed -> K fixed (D deferred, R refuted)

## Behavioral — test-proven
<id> <file:line> [severity]
  claim:  ...
  red:    <test path> FAILED — <actual output excerpt>
  fix:    <what changed, and at which layer>
  green:  <test path> PASSED
  refuted-by-none | confirmed by <lanes>

## Structural — suite-green
<id> <file:line> [severity]
  claim:  ...
  fix:    <the restructuring>
  shape:  <before -> after: lines, branches, files>
  proof:  <suite> green, no test edits
  confirmed by <lanes>

## Confirmed but deferred
<id> — <why out of scope>

## Refuted
<id> — raised by <lane>, refuted by <lane>: <one line>

## Gate
task check: <result>
```

Report what actually happened. A review that found nothing and says so is a real result; a review that manufactures three findings to look thorough has cost the user money and trust. If a lane was down, if a test could not be written, if a fix was reverted — say it plainly.

## Scaling down

The full protocol is for changes where correctness is worth several model families. For a small diff, run it with fewer lanes or skip cross-examination on minor findings — but keep the red→green gate. That one is what separates a fix from a guess, and it is cheap.
