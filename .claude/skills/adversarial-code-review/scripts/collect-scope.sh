#!/usr/bin/env bash
# Resolve what is under review and compute the facts every reviewer needs.
#
# Scope is uncommitted work plus everything on this branch that isn't on the
# base yet — the same thing a reviewer would see in the PR, plus what you
# haven't pushed. Reviewers that each re-derive this get slightly different
# answers and waste tokens doing it, so it is computed once here.
#
# Usage: collect-scope.sh [--base REF] [--out DIR]
#
# Writes to DIR (default: a fresh mktemp dir, path echoed on stdout):
#   diff.patch      full unified diff under review
#   files.txt       changed paths, one per line
#   filesizes.tsv   path <TAB> lines_before <TAB> lines_after <TAB> delta
#   scope.md        human/model-readable summary, including 1k-line crossings

set -uo pipefail

BASE=""
OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not a git repo" >&2; exit 2; }

# Base resolution, most specific first. An explicit --base always wins; a
# stacked PR's real base comes from gh, not from guessing the trunk name.
if [ -z "$BASE" ]; then
  BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || true)
  [ -n "$BASE" ] && BASE="origin/$BASE"
fi
if [ -z "$BASE" ]; then
  for candidate in origin/development origin/main origin/master development main master; do
    if git rev-parse --verify --quiet "$candidate" >/dev/null; then BASE="$candidate"; break; fi
  done
fi
[ -n "$BASE" ] || { echo "could not resolve a base ref — pass --base" >&2; exit 2; }

MERGE_BASE=$(git merge-base HEAD "$BASE" 2>/dev/null) || {
  echo "no merge base with $BASE" >&2; exit 2; }

[ -n "$OUT" ] || OUT=$(mktemp -d -t review-scope.XXXXXX)
mkdir -p "$OUT"

# Three dots would hide uncommitted work; the explicit merge-base plus a dirty
# working tree is what the reviewer actually needs to see.
git diff "$MERGE_BASE" >"$OUT/diff.patch"
git diff --name-only "$MERGE_BASE" >"$OUT/files.txt"

# git reports paths from the repo top-level, which is not necessarily cwd —
# in a monorepo you are usually several directories down. Resolve against the
# top-level or every "after" count silently reads 0 and the 1000-line check
# never fires.
TOP=$(git rev-parse --show-toplevel)

: >"$OUT/filesizes.tsv"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  before=$(git show "$MERGE_BASE:$f" 2>/dev/null | wc -l | tr -d ' ')
  [ -z "$before" ] && before=0
  if [ -f "$TOP/$f" ]; then after=$(wc -l <"$TOP/$f" | tr -d ' '); else after=0; fi
  printf '%s\t%s\t%s\t%s\n' "$f" "$before" "$after" "$((after - before))" >>"$OUT/filesizes.tsv"
done <"$OUT/files.txt"

CROSSINGS=$(awk -F'\t' '$2 < 1000 && $3 >= 1000 {printf "  %s: %s -> %s lines\n", $1, $2, $3}' "$OUT/filesizes.tsv")
BIG=$(awk -F'\t' '$3 >= 1000 && !($2 < 1000) {printf "  %s: %s lines (already over)\n", $1, $3}' "$OUT/filesizes.tsv")

{
  echo "# Review scope"
  echo
  echo "Base: $BASE (merge-base $MERGE_BASE)"
  echo "Head: $(git rev-parse --short HEAD)$(git diff --quiet 2>/dev/null || echo ' + uncommitted changes')"
  echo "Files changed: $(wc -l <"$OUT/files.txt" | tr -d ' ')"
  echo "Diff size: $(git diff --shortstat "$MERGE_BASE")"
  echo
  echo "## Files newly crossing 1000 lines"
  if [ -n "$CROSSINGS" ]; then echo "$CROSSINGS"; else echo "  none"; fi
  if [ -n "$BIG" ]; then echo; echo "## Files already over 1000 lines"; echo "$BIG"; fi
  echo
  echo "## Changed files"
  awk -F'\t' '{printf "  %s (%s -> %s, %+d)\n", $1, $2, $3, $4}' "$OUT/filesizes.tsv"
} >"$OUT/scope.md"

echo "$OUT"
