#!/usr/bin/env bash
# Run a five-part spec through one implementation lane and capture its output.
#
# Usage:
#   run-lane.sh <grok|codex|claude> <spec-file> [--timeout SECONDS] [--model MODEL]
#               [--effort LEVEL] [--require STRING]
#
# Prints the lane's final message to stdout and the transcript path to stderr.
# Exit 0 = the lane ran to completion. Exit 3 = lane unusable (missing CLI or
# auth). Exit 5 = lane output failed the completion guard (truncated/silent
# death — see below). Exit 124 = wall-clock timeout, with whatever landed left
# in the tree.
#
# Completion guard: CLIs can die mid-session and still exit 0 with only their
# opening narration in the transcript (observed repeatedly on grok, INF-4818).
# Pass --require with a string the spec obligates the final message to contain
# (e.g. "Verification"); a rc=0 transcript missing it exits 5 so the caller
# re-routes instead of trusting a phantom success. A tiny rc=0 transcript
# (<300 bytes) trips the same guard unconditionally.
#
# This does NOT verify the work. The caller re-runs the spec's verification
# command against the working tree; a lane's own success claim is not evidence.

set -uo pipefail

LANE="${1:-}"; SPEC="${2:-}"; shift 2 2>/dev/null || true
TIMEOUT_SECS=600
MODEL=""
EFFORT=""
REQUIRE=""
# rc=0 transcripts smaller than this are treated as a silent lane death: no
# real completion (the spec contract demands verification output) is this small.
MIN_OUTPUT_BYTES=300

# `shift 2` with only one argument left fails without shifting, so a valued
# option given no value would spin the loop forever. Demand the value first.
need_value() { [ $# -ge 2 ] || { echo "$1 requires a value" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) need_value "$@"; TIMEOUT_SECS="$2"; shift 2 ;;
    --model) need_value "$@"; MODEL="$2"; shift 2 ;;
    --effort) need_value "$@"; EFFORT="$2"; shift 2 ;;
    --require) need_value "$@"; REQUIRE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$LANE" ] && [ -n "$SPEC" ] || { sed -n '2,14p' "$0"; exit 2; }
[ -f "$SPEC" ] || { echo "spec file not found: $SPEC" >&2; exit 2; }

TO=$(command -v gtimeout || command -v timeout || true)
[ -z "$TO" ] && echo "WARN: no timeout binary — lane runs uncapped (brew install coreutils)" >&2
run_capped() { if [ -n "$TO" ]; then "$TO" "$TIMEOUT_SECS" "$@"; else "$@"; fi; }

# Unique per run: parallel lanes on a fixed path corrupt each other.
LOG=$(mktemp -t lane-"$LANE".XXXXXX)
echo "transcript: $LOG" >&2

case "$LANE" in
  grok)
    command -v grok >/dev/null 2>&1 || { echo "grok not on PATH" >&2; exit 3; }
    # --allow rules are load-bearing. With --permission-mode acceptEdits alone,
    # grok headless announces its plan, writes nothing, and exits 0 — a silent
    # no-op that reads as a completed run.
    run_capped grok --prompt-file "$SPEC" \
      -m "${MODEL:-grok-4.6}" \
      ${EFFORT:+--reasoning-effort "$EFFORT"} \
      --permission-mode acceptEdits \
      --allow Bash --allow Write --allow Edit \
      --output-format plain \
      --cwd "$(pwd)" >"$LOG" 2>&1
    rc=$?
    ;;
  codex)
    command -v codex >/dev/null 2>&1 || { echo "codex not on PATH" >&2; exit 3; }
    # Do not invent a default --model. ~/.codex/config.toml is the source of
    # truth (this shop: model=gpt-5.6-terra, effort=xhigh, provider=litellm
    # at https://lllm.inference.net/v1). Forcing a slug overrides the
    # provider and 400s LiteLLM when someone concatenates effort onto the
    # model id (gpt-5.6-terra-xhigh is not a model).
    if [ -n "$MODEL" ] && { [ "$MODEL" != "${MODEL%-xhigh}" ] || [ "$MODEL" != "${MODEL%-high}" ]; }; then
      echo "WARN: --model $MODEL looks like model+effort concatenated. Use --model gpt-5.6-terra --effort xhigh" >&2
    fi
    FINAL=$(mktemp -t lane-codex-final.XXXXXX)
    set -- exec
    [ -n "$MODEL" ] && set -- "$@" --model "$MODEL"
    [ -n "$EFFORT" ] && set -- "$@" -c "model_reasoning_effort=$EFFORT"
    set -- "$@" \
      --sandbox workspace-write \
      --skip-git-repo-check \
      --cd "$(pwd)" \
      --output-last-message "$FINAL" \
      -
    run_capped codex "$@" <"$SPEC" >"$LOG" 2>&1
    rc=$?
    [ -s "$FINAL" ] && cat "$FINAL" >>"$LOG"
    rm -f "$FINAL"
    ;;
  claude)
    command -v claude >/dev/null 2>&1 || { echo "claude not on PATH" >&2; exit 3; }
    [ -n "$EFFORT" ] && echo "WARN: --effort is grok-only; ignored for claude (pin --model instead)" >&2
    # Spec via stdin, not argv: a large spec passed as an argument blows
    # ARG_MAX and the exec fails before claude ever starts.
    run_capped claude -p ${MODEL:+--model "$MODEL"} \
      --permission-mode acceptEdits <"$SPEC" >"$LOG" 2>&1
    rc=$?
    ;;
  *)
    echo "unknown lane: $LANE (expected grok, codex, or claude)" >&2; exit 2 ;;
esac

cat "$LOG"

if [ $rc -eq 124 ]; then
  echo "TIMEOUT after ${TIMEOUT_SECS}s — inspect the working tree for partial work" >&2
fi

# Completion guard — only a clean exit can be a phantom success; real failures
# already carry their own exit codes.
if [ $rc -eq 0 ]; then
  size=$(wc -c <"$LOG" | tr -d ' ')
  if [ "$size" -lt "$MIN_OUTPUT_BYTES" ]; then
    echo "unusable [suspected silent lane death: output only ${size} bytes]" >&2
    exit 5
  fi
  if [ -n "$REQUIRE" ] && ! grep -qF -- "$REQUIRE" "$LOG"; then
    echo "unusable [required marker missing from output: ${REQUIRE}]" >&2
    exit 5
  fi
fi
exit $rc
