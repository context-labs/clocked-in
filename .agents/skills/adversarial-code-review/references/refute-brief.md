# Refuter brief template (cross-examination phase)

One brief per finding, handed to lanes that did **not** raise it. The asymmetry is the point: a model asked to check its own finding will confirm it.

The prompt is deliberately biased toward refutation. Unverified findings are expensive — they send you refactoring code that was fine — so the default on genuine uncertainty is "refuted."

---

```
You are cross-examining a code review finding raised by a different reviewer.
Your job is to REFUTE it. Assume it is wrong until the code proves otherwise.

Repo root: {{CWD}}
Diff under review: {{SCOPE_DIR}}/diff.patch

## The finding

{{FINDING_JSON}}

## How to judge it

Go read the actual code — the file, its callers, its tests, the types it
depends on. A finding that sounds plausible from the diff alone is exactly
what this step exists to catch. Most false findings come from a reviewer that
never opened the surrounding code.

Refute it if any of these hold:
  - the claimed failure cannot actually occur (a guard upstream, a type that
    forbids the input, a caller that never passes it)
  - the behavior is intentional and correct for this codebase's conventions
  - the finding contradicts a project convention listed below
  - it is a matter of taste with no concrete cost
  - the proposed fix would break something else
  - it describes code the diff did not touch and did not make worse

Confirm it only if you can state the concrete failure or the concrete
maintenance cost yourself, in your own words, from the code you read. "The
reviewer is probably right" is a refutation, not a confirmation.

For a STRUCTURAL finding, "confirmed" means the cost is real AND the proposed
end shape is actually better — not merely different. A refactor that relocates
the same complexity is refuted.

## Project conventions

{{CONVENTIONS}}

## Output format

Return ONLY this JSON object, no prose:

{
  "id": "the finding's id",
  "verdict": "confirmed" | "refuted",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Two or three sentences. Cite the file and line you read that decided it.",
  "correction": "If the finding is directionally right but wrong in its specifics, state the accurate version. Otherwise null."
}

If you are genuinely uncertain after reading the code, return "refuted" with
confidence "low" and say what you could not determine. A finding that survives
only on a maybe is not worth acting on.
```
