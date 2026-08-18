# Lane reference

Exact invocations, why each flag is required, and the failure mode it prevents. `run-lane.sh` encodes all of this; read here when a lane misbehaves or you need to invoke one by hand.

## Grok CLI (`grok`)

Producer: Grok 4.5. Install: <https://x.ai/cli>. Auth: `grok login` (OIDC, cached in `~/.grok/auth.json`).

```bash
grok --prompt-file "$SPEC" \
  -m grok-4.6 \
  --reasoning-effort high \
  --permission-mode acceptEdits \
  --allow Bash --allow Write --allow Edit \
  --output-format plain \
  --cwd "$(pwd)"
```

`run-lane.sh` forwards `--effort` as `--reasoning-effort`. Canonical levels
are `low`, `medium`, `high`, and `xhigh`. Omit `--effort` to leave the CLI
default.

| Flag | Why |
|---|---|
| `--prompt-file` | Headless run from a file. No shell quoting hazards, no truncation. |
| `-m grok-4.6` | Pin the producer; never rely on the CLI default. |
| `--reasoning-effort` | Pin the thinking tier (`high` / `xhigh` for implementation). |
| `--permission-mode acceptEdits` + `--allow` | **Both are required.** See the silent no-op below. |
| `--output-format plain` | Final message to stdout for capture. |
| `--cwd` | Deterministic working root. |

### Silent no-op with `acceptEdits` alone

`--permission-mode acceptEdits` without `--allow` rules produces grok's most confusing failure: it prints its plan ("I'll create `done.txt`…"), writes nothing, and exits **0**. No error, no diff, a success-shaped transcript. A caller that trusts the report ships an empty change.

The explicit `--allow Bash --allow Write --allow Edit` rules fix it. `--always-approve` and `--permission-mode bypassPermissions` also work, but grant blanket command approval — prefer the scoped rules.

The same cancellation fires whenever a run reaches for a tool no rule covers, which an allow-list cannot reliably prevent on a long multi-step task. Grok's own tool names are snake_case and do not match Claude's (`run_terminal_command`, `read_file`, `grep`, `list_dir`, `write`, `search_replace`) — `grok -p "list your tools"` prints the current set. For a **read-only** run, invert the approach: strip the write tools and auto-approve the rest, so no call can be denied and none can edit.

```bash
grok --prompt-file "$SPEC" -m grok-4.6 \
  --always-approve \
  --disallowed-tools write,search_replace,image_gen,image_edit \
  --output-format plain --cwd "$(pwd)"
```

### `grok models` lies about auth

It prints `You are not authenticated.` and exits 0 for a working OIDC session, because its probe only recognizes API-key auth. Never gate a lane on it. Ground truth is `grok -p "…"` returning the expected content.

`grok inspect` is the useful diagnostic — it shows the resolved permission source, login policy, and trust state for the current directory. Note it reads permission rules from `~/.claude/settings.local.json` when present.

## Codex CLI (`codex`)

Producer: whatever `~/.codex/config.toml` names. This shop's config is
`model = "gpt-5.6-terra"`, `model_reasoning_effort = "xhigh"`,
`model_provider = "litellm"` at `https://lllm.inference.net/v1` via
`LITELLM_API_KEY`. Auth is that key, **not** `codex login`. Expired ChatGPT
OAuth refresh 401s in the log are noise; they do not mean the lane is down.

`run-lane.sh` omits `--model` / `-c model_reasoning_effort` unless the caller
passed `--model` / `--effort`, so the config wins. `--effort` maps to
`-c model_reasoning_effort=<level>`. Do **not** concatenate effort onto the
model id — `gpt-5.6-terra-xhigh` is not a LiteLLM model and 400s.

```bash
# honor config.toml (preferred for implementation)
codex exec \
  --sandbox workspace-write \
  --skip-git-repo-check \
  --cd "$(pwd)" \
  --output-last-message "$FINAL" \
  - < "$SPEC"

# pin a real LiteLLM slug + effort
codex exec \
  --model gpt-5.6-terra \
  -c model_reasoning_effort=xhigh \
  --sandbox workspace-write \
  --skip-git-repo-check \
  --cd "$(pwd)" \
  --output-last-message "$FINAL" \
  - < "$SPEC"
```

| Flag | Why |
|---|---|
| `--sandbox workspace-write` | Writes scoped to the working tree. Never `danger-full-access`. |
| `--model` / `-c model_reasoning_effort` | Optional pins. Omit both to use `~/.codex/config.toml`. |
| `--skip-git-repo-check` + `--cd` | Deterministic root; works outside a git repo. |
| `--output-last-message` | Final message to a file, separate from the noisy transcript. |
| `- < "$SPEC"` | Prompt via stdin. |

If the spec names a different **real** LiteLLM id (`gpt-5.6-sol` for planning,
`gpt-5.6-luna` for a smoke test), pass that `--model`. If codex reports the
model unavailable, that is a genuine `unusable`; preserve the exact message.

`codex --version` does not check auth. It succeeds for an account that cannot run a single request.

**Sandbox prerequisite.** Codex runs every filesystem access through bubblewrap. On Ubuntu 24 hosts, AppArmor blocks unprivileged user namespaces, the bundled bwrap cannot create one, and every read fails with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` — while the model keeps answering, so the lane looks alive and silently invents anything it was asked to read. `lane-preflight.sh` catches this and reports `unusable` with the remediation; the host fix is `sudo apt install -y bubblewrap`, or clearing `kernel.apparmor_restrict_unprivileged_userns`. Do not work around it by disabling the sandbox.

## Claude Code CLI (`claude`)

Producer: the Claude family. Use as a lane only when the host is grok or codex, or when both other lanes are down and you say so.

```bash
claude -p "$(cat "$SPEC")" --permission-mode acceptEdits
```

Unlike grok, `acceptEdits` here does grant file writes without extra allow rules.

## Timeouts

macOS ships no `timeout`. `gtimeout` comes from `brew install coreutils`. Both scripts detect either and run uncapped with a warning when neither exists. Exit 124 means the wall clock hit — partial work may be in the tree, so inspect before re-routing.
