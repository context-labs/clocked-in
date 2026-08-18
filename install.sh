#!/bin/sh
# clocked-in installer — downloads the released binary, verifies its checksum
# against the published SHA256SUMS, and installs it to a directory on your PATH.
#
# Everything it does is printed as it happens. Read it first if you like:
#   curl -fsSL https://raw.githubusercontent.com/context-labs/clocked-in/main/install.sh
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/context-labs/clocked-in/main/install.sh | sh
# Env overrides:
#   CLOCKED_IN_VERSION=v0.1.0   pin a version (default: latest release)
#   CLOCKED_IN_BIN_DIR=~/bin    force the install directory
#   CLOCKED_IN_BASE_URL=...     mirror base (default: GitHub releases)
#   CLOCKED_IN_NO_HOOKS=1       install the binary only; don't wire agent hooks
set -eu

REPO="context-labs/clocked-in"
BASE_URL="${CLOCKED_IN_BASE_URL:-https://github.com/$REPO/releases/download}"

say() { printf '  %s\n' "$*"; }
die() { printf 'clocked-in install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

need uname
need mktemp
# a downloader
if command -v curl >/dev/null 2>&1; then DL="curl -fsSL -o"; DLo="curl -fsSL"; else
  command -v wget >/dev/null 2>&1 || die "need curl or wget"; DL="wget -qO"; DLo="wget -qO-"; fi
# a sha256 tool
if command -v sha256sum >/dev/null 2>&1; then SHA() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "need sha256sum or shasum"; fi

# --- platform ---
os=$(uname -s); arch=$(uname -m)
case "$os" in Linux) os=linux;; Darwin) os=darwin;; *) die "unsupported OS: $os (Linux/macOS only)";; esac
case "$arch" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) die "unsupported arch: $arch";; esac
ASSET="clocked-in-$os-$arch"

# --- version ---
VERSION="${CLOCKED_IN_VERSION:-}"
if [ -z "$VERSION" ]; then
  say "Resolving latest release…"
  VERSION=$($DLo "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  [ -n "$VERSION" ] || die "could not determine the latest release (set CLOCKED_IN_VERSION)"
fi

printf '\nclocked-in %s — %s\n' "$VERSION" "$ASSET"

# --- download + verify ---
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
say "Downloading $ASSET…"
$DL "$tmp/$ASSET" "$BASE_URL/$VERSION/$ASSET" || die "download failed"
say "Downloading SHA256SUMS…"
$DL "$tmp/SHA256SUMS" "$BASE_URL/$VERSION/SHA256SUMS" || die "checksum list download failed"

expected=$(grep " $ASSET\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
[ -n "$expected" ] || die "no checksum for $ASSET in SHA256SUMS"
actual=$(SHA "$tmp/$ASSET")
say "expected sha256: $expected"
say "actual   sha256: $actual"
[ "$expected" = "$actual" ] || die "CHECKSUM MISMATCH — refusing to install. The download does not match the published checksum."
say "✓ checksum verified"
chmod 755 "$tmp/$ASSET"

# --- pick an install dir on PATH (first writable wins; create ~/.local/bin if needed) ---
in_path() { case ":$PATH:" in *":$1:"*) return 0;; *) return 1;; esac; }
DEST=""
if [ -n "${CLOCKED_IN_BIN_DIR:-}" ]; then
  mkdir -p "$CLOCKED_IN_BIN_DIR" 2>/dev/null || true
  DEST="$CLOCKED_IN_BIN_DIR"
else
  for d in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin" "$HOME/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then DEST="$d"; break; fi
  done
  # nothing writable existed — create the standard user dir
  [ -z "$DEST" ] && { mkdir -p "$HOME/.local/bin" && DEST="$HOME/.local/bin"; }
fi
[ -n "$DEST" ] && [ -w "$DEST" ] || die "no writable install directory found"

mv "$tmp/$ASSET" "$DEST/clocked-in"
say "✓ installed to $DEST/clocked-in"

# --- ensure it's on PATH ---
if ! in_path "$DEST"; then
  # Single-quote DEST (escaping embedded quotes) so a directory with spaces or
  # shell metacharacters can't inject code when the rc file is sourced.
  esc=$(printf '%s' "$DEST" | sed "s/'/'\\\\''/g")
  line="export PATH='$esc':\"\$PATH\""
  # Update every shell rc that exists, and always ~/.profile (create it if
  # missing) so a fresh machine still gets PATH on next login.
  touch "$HOME/.profile" 2>/dev/null || true
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -e "$rc" ] || continue
    grep -qF "$line" "$rc" 2>/dev/null || printf '\n# clocked-in\n%s\n' "$line" >> "$rc"
  done
  say "Added $DEST to your PATH — restart your shell, or run now: $line"
fi

printf '\n'
"$DEST/clocked-in" version || true

# --- wire agent hooks (transparent; opt out with CLOCKED_IN_NO_HOOKS=1) ---
if [ "${CLOCKED_IN_NO_HOOKS:-0}" = "1" ]; then
  printf '\nSkipped wiring hooks (CLOCKED_IN_NO_HOOKS=1). Run `clocked-in install` when ready.\n'
else
  printf '\nWiring hooks into your installed agents (clocked-in install):\n'
  "$DEST/clocked-in" install || true
fi

printf '\nDone. Restart your agents, then run `clocked-in` to see the damage.\n'
