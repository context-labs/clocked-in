#!/usr/bin/env bash
# Probe which cross-vendor implementation lanes are usable right now.
#
# Ground truth is a real round trip: each lane must READ A FILE and report the
# random token inside it. Nothing here parses a CLI's own self-reported login
# state — those probes lie. `grok models` prints "You are not authenticated."
# for a fully working OIDC session, and `codex --version` never touches auth at
# all. Both exit 0 either way, so a string match or an exit code is worthless.
#
# The probe reads a file rather than echoing a sentinel because echoing proves
# far too little. A lane whose filesystem sandbox is broken still answers an
# echo from the model alone and probes as `available`, then fails on the first
# real task — which is exactly how a review once ran a lane that had not read a
# single file and was inventing its findings. Every lane is used to read the
# repo, so reading is the capability worth testing.
#
# The token lives ONLY in the file and is regenerated per run, so a lane cannot
# pass by echoing the prompt back or by guessing.
#
# Usage:
#   lane-preflight.sh [--self grok|codex|claude] [--timeout SECONDS] [--json]
#
# --self excludes the host's own lane (an agent should not delegate to itself).
# Exit status is 0 when at least one non-self lane is available, 1 otherwise.

set -uo pipefail

# Regenerated per run so a cached transcript or a lucky guess cannot pass.
SENTINEL="LANE_OK_$(od -An -N4 -tx4 /dev/urandom 2>/dev/null | tr -d ' \n' | tr '[:lower:]' '[:upper:]')"
[ "$SENTINEL" = "LANE_OK_" ] && SENTINEL="LANE_OK_$$$(date +%s)"
PROBE_FILE="lane-probe.txt"
TIMEOUT_SECS=90
SELF=""
JSON=0

# `shift 2` with only one argument left fails without shifting, so a valued
# option given no value would spin the loop forever. Demand the value first.
need_value() { [ $# -ge 2 ] || { echo "$1 requires a value" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --self) need_value "$@"; SELF="$2"; shift 2 ;;
    --timeout) need_value "$@"; TIMEOUT_SECS="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# macOS ships no `timeout`; coreutils provides `gtimeout`. Uncapped is still
# better than not probing, so an absent binary is a warning, not a failure.
TO=$(command -v gtimeout || command -v timeout || true)
run_capped() { if [ -n "$TO" ]; then "$TO" "$TIMEOUT_SECS" "$@"; else "$@"; fi; }

PROMPT="Read the file ${PROBE_FILE} in your current working directory and reply with the token it contains, and nothing else. Do not guess: if you cannot read the file, say CANNOT_READ and stop."
PROBE_DIR=$(mktemp -d -t lane-preflight.XXXXXX)
trap 'rm -rf "$PROBE_DIR"' EXIT
printf '%s\n' "$SENTINEL" > "$PROBE_DIR/$PROBE_FILE"

declare -a NAMES STATUSES REASONS

record() { NAMES+=("$1"); STATUSES+=("$2"); REASONS+=("$3"); }

# Collapse a lane's output into one short line for the reason field. Keeps the
# TAIL: CLIs open with a banner, so the head is boilerplate while the refusal or
# error that explains the verdict lands at the end.
squash() { tr '\n' ' ' | sed 's/  */ /g' | tail -c 220; }

# A lane whose sandbox cannot create a user namespace fails every file read
# while still answering from the model. Name the cause so the next person is
# not left reverse-engineering `RTM_NEWADDR` from a lane that "looks fine".
sandbox_hint() {
  case "$1" in
    *RTM_NEWADDR*|*bwrap*|*"sandbox helper failed"*|*"user namespace"*|*CANNOT_READ*)
      local extra=""
      if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ]; then
        extra=" AppArmor is blocking unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1); 'sudo apt install -y bubblewrap' or 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'."
      fi
      printf ' [sandbox broken: the lane cannot read files.%s]' "$extra" ;;
  esac
}

# Shared verdict: exit 0 AND the token that exists only inside the probe file.
# Both are required — a lane that fails while echoing its prompt must not pass,
# and neither must one that exits 0 after refusing to read.
verdict() {
  local lane="$1" rc="$2" out="$3" version="$4"
  if [ "$rc" -eq 124 ]; then record "$lane" timeout "no response in ${TIMEOUT_SECS}s"; return; fi
  if [ "$rc" -eq 0 ]; then case "$out" in
    *"$SENTINEL"*) record "$lane" available "$version"; return ;;
  esac; fi
  record "$lane" unusable "exit=$rc $(printf '%s' "$out" | squash)$(sandbox_hint "$out")"
}

probe_grok() {
  command -v grok >/dev/null 2>&1 || {
    record grok missing "grok not on PATH — install from https://x.ai/cli"; return; }
  local out rc
  out=$(run_capped grok -p "$PROMPT" --output-format plain --cwd "$PROBE_DIR" 2>&1); rc=$?
  verdict grok "$rc" "$out" "$(grok --version 2>/dev/null | squash)"
}

probe_codex() {
  command -v codex >/dev/null 2>&1 || {
    record codex missing "codex not on PATH — install the OpenAI Codex CLI"; return; }
  local out rc
  out=$(run_capped codex exec --sandbox read-only --skip-git-repo-check \
        --cd "$PROBE_DIR" "$PROMPT" 2>&1); rc=$?
  verdict codex "$rc" "$out" "$(codex --version 2>/dev/null | squash)"
}

probe_claude() {
  command -v claude >/dev/null 2>&1 || {
    record claude missing "claude not on PATH"; return; }
  local out rc
  out=$(cd "$PROBE_DIR" && run_capped claude -p "$PROMPT" 2>&1); rc=$?
  verdict claude "$rc" "$out" "$(claude --version 2>/dev/null | squash)"
}

[ "$SELF" = "grok" ]   || probe_grok
[ "$SELF" = "codex" ]  || probe_codex
[ "$SELF" = "claude" ] || probe_claude

available=0
for s in "${STATUSES[@]:-}"; do [ "$s" = "available" ] && available=$((available + 1)); done

if [ "$JSON" -eq 1 ]; then
  printf '{"lanes":['
  for i in "${!NAMES[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '{"lane":"%s","status":"%s","detail":"%s"}' \
      "${NAMES[$i]}" "${STATUSES[$i]}" "$(printf '%s' "${REASONS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  done
  printf '],"available":%d}\n' "$available"
else
  # Warning goes to stderr so stdout stays parseable as pure status records.
  [ -z "$TO" ] && echo "WARN: no timeout/gtimeout binary — probes run uncapped (brew install coreutils)" >&2
  for i in "${!NAMES[@]}"; do
    printf '%-7s %-10s %s\n' "${NAMES[$i]}" "${STATUSES[$i]}" "${REASONS[$i]}"
  done
fi

[ "$available" -gt 0 ]
