# Reviewer brief template (find phase)

Fill the placeholders and write to a file, then hand it to every lane via `fan-out-review.sh --brief`. Lanes share none of your context — the brief is everything they get.

Keep it identical across lanes. Different models finding different things is the signal; different *prompts* finding different things is noise you can't interpret.

---

```
You are performing an extremely strict code quality and correctness review.
You are one of several independent reviewers from different model families.
You cannot see the others' findings. Do not hedge toward a consensus you
cannot observe — report what you actually believe is wrong.

## Scope

Repo root: {{CWD}}
Base: {{BASE}} (merge-base {{MERGE_BASE}})
The full diff under review is at: {{SCOPE_DIR}}/diff.patch
A scope summary, including per-file line counts and any file crossing 1000
lines, is at: {{SCOPE_DIR}}/scope.md

Read the diff. Read the surrounding code in the repo for anything you need
context on — a diff alone hides most real defects. You have read-only access;
do not attempt to edit files.

## Project conventions

These are binding. A finding that contradicts them is wrong:

{{CONVENTIONS}}

## What to look for

Two categories, and you must label every finding as exactly one:

BEHAVIORAL — the code does something wrong or will at runtime. Bugs, wrong
edge cases, races, unhandled rejections, off-by-ones, incorrect SQL, missing
authorization, silent failure paths, broken error mapping, resource leaks.
The test for this category: could a test be written that fails today and
passes after the fix? If yes, it is behavioral.

STRUCTURAL — the code works but makes the codebase worse. Be ambitious here,
not merely tidy. Look for "code judo": a restructuring that preserves behavior
while making the implementation dramatically simpler, so whole branches,
helpers, modes, or layers disappear. Specifically:
  - a file pushed from under 1000 lines to over (a presumptive blocker)
  - ad-hoc conditionals and special cases scattered into unrelated flows
  - complexity rearranged rather than deleted
  - thin abstractions, identity wrappers, pass-through helpers
  - unnecessary optionality, `unknown`, `any`, cast-heavy boundaries
  - silent fallbacks papering over an unclear invariant
  - duplicating a canonical helper, or logic in the wrong layer
  - feature logic leaking into a shared path

Do not stop at "this could be cleaner." If there is a path to delete
complexity rather than move it, say so concretely and name the shape of the
result.

Do not flood the review with nits. A small number of high-conviction findings
beats a long cosmetic list. If the change is genuinely clean, say so — a
manufactured objection wastes everyone's time and costs you credibility on
the findings that matter.

## Output format

Return ONLY a JSON array, no prose before or after. One object per finding:

[
  {
    "id": "short-kebab-slug",
    "category": "behavioral" | "structural",
    "file": "path/relative/to/repo/root",
    "line": 123,
    "severity": "blocker" | "major" | "minor",
    "claim": "One sentence: what is wrong.",
    "why_it_matters": "One or two sentences: the concrete consequence.",
    "failure_scenario": "For behavioral: exact inputs/state -> wrong output. For structural: the maintenance cost that lands later.",
    "proposed_fix": "The specific change. For structural findings, describe the end shape, not just 'extract a helper'.",
    "test_sketch": "For behavioral: the test that would fail today. For structural: null."
  }
]

Return [] if you find nothing worth raising.
```
