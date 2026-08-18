# Model routing — plan vs implement

Judgment (plans, diagnosis write-ups, specs) and typing (the diff) want
different models. Do not pick a model just because it is hosting the session.

This file is the roster for `new-feature-development*` and `fixing-a-bug*`
across project repos. The rest of this skill owns preflight, the spec
contract, lane flags, and verification.

## Ask which planner — do not assume fable

Before writing a plan or a substantial spec, ask the user which planner to
use. Use a structured question with these options, recommended first. Do not
silently start as fable.

| Option | Invocation |
|---|---|
| **fable** (recommended) | `run-lane.sh claude <spec> --model fable` |
| **opus** | `run-lane.sh claude <spec> --model opus` |
| **gpt-5.6-sol** | `run-lane.sh codex <spec> --model gpt-5.6-sol` |

Skip the question only if the user already named a planner this turn. If
this session already *is* the chosen planner, write the plan here. If it is
not, delegate the plan write with the invocation above.

## Implementers

Once the plan or spec is approved, type the code on these two:

| Option | Invocation |
|---|---|
| grok 4.6 high | `run-lane.sh grok <spec> --model grok-4.6 --effort high` |
| grok 4.6 xhigh | same, `--effort xhigh` — use when the change is subtle or costly-if-wrong |
| gpt-5.6-terra xhigh | `run-lane.sh codex <spec> --model gpt-5.6-terra --effort xhigh` |

`--model` is a LiteLLM id. `--effort` is Codex `model_reasoning_effort`.
Never concatenate them (`gpt-5.6-terra-xhigh` is not a model and 400s).
Omitting both flags on the Codex lane uses `~/.codex/config.toml` (this
shop: terra + xhigh via `lllm.inference.net`).

Race grok (high or xhigh) against terra at xhigh on the same spec when
correctness matters and keep the stronger diff. If this session is already
one of those implementers, it may type the code itself and send the other
as the cross-check.

Do not send implementation to fable, opus, or gpt-5.6-sol.
