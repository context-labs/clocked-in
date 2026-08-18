#!/usr/bin/env bash
# Run one brief across every available CLI lane, in parallel, read-only.
#
# Used twice per review: once to find (each lane reviews the diff blind to the
# others) and once to refute (each finding goes to a lane that did not raise
# it). Same mechanics both times, so it is one script.
#
# Usage: fan-out-review.sh --brief FILE --out DIR [--self LANE] [--timeout SECS]
#                          [--lanes grok,codex,claude]
#
# Writes DIR/<lane>.md per lane and DIR/lanes.txt listing the ones that
# produced output. Exit 1 if no lane produced anything.
#
# Every lane runs read-only. A reviewer that can edit will start fixing things
# mid-review, which corrupts the finding list and races the other lanes.

set -uo pipefail

BRIEF=""; OUT=""; SELF=""; TIMEOUT_SECS=900; LANES="grok,codex,claude"

while [ $# -gt 0 ]; do
  case "$1" in
    --brief) BRIEF="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --self) SELF="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECS="${2:-900}"; shift 2 ;;
    --lanes) LANES="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -f "$BRIEF" ] || { echo "brief not found: $BRIEF" >&2; exit 2; }
[ -n "$OUT" ] || { echo "--out is required" >&2; exit 2; }
mkdir -p "$OUT"

TO=$(command -v gtimeout || command -v timeout || true)
[ -z "$TO" ] && echo "WARN: no timeout binary — lanes run uncapped (brew install coreutils)" >&2
run_capped() { if [ -n "$TO" ]; then "$TO" "$TIMEOUT_SECS" "$@"; else "$@"; fi; }

CWD=$(pwd)

run_grok() {
  command -v grok >/dev/null 2>&1 || return 1
  # Read-only is enforced by removing the write tools, not by withholding
  # approval. Any denied tool call cancels a grok run silently — exit 0, a
  # half-finished sentence, no review — and an allow-list can never enumerate
  # every tool a long review reaches for. Stripping `write`/`search_replace`
  # makes editing impossible, which lets everything else be auto-approved
  # without risking a mid-review cancellation.
  run_capped grok --prompt-file "$BRIEF" \
    -m grok-4.6 \
    --always-approve \
    --disallowed-tools write,search_replace,image_gen,image_edit \
    --output-format plain --cwd "$CWD" >"$OUT/grok.md" 2>&1
}

run_codex() {
  command -v codex >/dev/null 2>&1 || return 1
  # Honor ~/.codex/config.toml (LiteLLM / lllm.inference.net). Do not pin a
  # default slug — concatenating effort onto the model id 400s LiteLLM.
  run_capped codex exec \
    --sandbox read-only \
    --skip-git-repo-check --cd "$CWD" \
    --output-last-message "$OUT/codex.md" \
    - <"$BRIEF" >"$OUT/codex.transcript" 2>&1
}

run_claude() {
  command -v claude >/dev/null 2>&1 || return 1
  (cd "$CWD" && run_capped claude -p "$(cat "$BRIEF")" \
    --permission-mode plan) >"$OUT/claude.md" 2>&1
}

pids=()
for lane in ${LANES//,/ }; do
  [ "$lane" = "$SELF" ] && continue
  case "$lane" in
    grok)   run_grok & pids+=("$!") ;;
    codex)  run_codex & pids+=("$!") ;;
    claude) run_claude & pids+=("$!") ;;
    *) echo "unknown lane: $lane" >&2 ;;
  esac
done

for p in "${pids[@]:-}"; do [ -n "$p" ] && wait "$p"; done

: >"$OUT/lanes.txt"
for lane in grok codex claude; do
  if [ -s "$OUT/$lane.md" ]; then echo "$lane" >>"$OUT/lanes.txt"; fi
done

n=$(wc -l <"$OUT/lanes.txt" | tr -d ' ')
echo "lanes producing output: $n ($(tr '\n' ' ' <"$OUT/lanes.txt"))" >&2
[ "$n" -gt 0 ]
