#!/usr/bin/env bash
# Install dependencies and self-heal the @discordjs/opus NABI binary mismatch
# that breaks Bun startups after a `git pull` adds new packages.
#
# Idempotent — safe to call repeatedly. Returns 0 even when `node_modules/` is
# already up to date and the opus prebuilt binary is already in place. Only
# runs `bun install` and the binary copy when actually needed.
#
# Usage:
#   bin/install-deps.sh             # install + heal opus binary
#   bin/install-deps.sh --force     # always reinstall + recopy binary
#   bin/install-deps.sh --quiet     # skip bun output unless something needs to run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${MCD_REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

FORCE=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --quiet) QUIET=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
  esac
done

cd "$REPO_DIR"

if [[ -n "${BUN_BIN:-}" ]]; then
  BUN="$BUN_BIN"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then
  BUN="$HOME/.bun/bin/bun"
elif [[ -x "/home/openclaw/.bun/bin/bun" ]]; then
  BUN="/home/openclaw/.bun/bin/bun"
else
  BUN="$(command -v bun || true)"
fi
[[ -z "$BUN" ]] && { echo "bun not found — set BUN_BIN=/path/to/bun" >&2; exit 1; }

NEEDS_INSTALL=0
if [[ "$FORCE" -eq 1 ]]; then
  NEEDS_INSTALL=1
else
  # Trigger install when package.json or bun.lock is newer than any existing
  # install marker. Bun 1.3 does not write a reliable .package-lock.json inside
  # node_modules, so use the node_modules directory mtime as the marker.
  if [[ ! -d "node_modules" ]]; then
    NEEDS_INSTALL=1
  else
    for marker in package.json bun.lock; do
      if [[ -f "$marker" && "$marker" -nt "node_modules" ]]; then
        NEEDS_INSTALL=1
        break
      fi
    done
  fi
fi

if [[ "$NEEDS_INSTALL" -eq 1 ]]; then
  if [[ "$QUIET" -eq 0 ]]; then
    echo "[mcd] installing dependencies via bun install…"
  fi
  "$BUN" install
else
  [[ "$QUIET" -eq 0 ]] && echo "[mcd] node_modules up to date — skipping bun install"
fi

# Heal the @discordjs/opus prebuilt binary for Bun.
#
# @discordjs/opus@0.10.0 only ships a node-v127 NAPI addon. Bun 1.3+ is NAPI v137,
# so bun looks for node-v137-napi-v3-linux-x64-glibc-2.39/opus.node and exits
# with "Cannot find module" at import time, killing the server.
#
# Copy whatever node-v127 binary exists on disk into the node-v137 directory
# bun expects. Resolution is by directory name only — bun does not validate the
# binary's NAPI version — so the node-v127 binary is structurally compatible
# enough to work.
OPUS_DIR="$REPO_DIR/node_modules/@discordjs/opus"
NEEDED_DIR="$OPUS_DIR/prebuild/node-v137-napi-v3-linux-x64-glibc-2.39"
NODE_V127_DIR="$OPUS_DIR/prebuild/node-v127-napi-v3-linux-x64-glibc-2.39"

if [[ -d "$OPUS_DIR" ]]; then
  mkdir -p "$NEEDED_DIR"
  if [[ -f "$NODE_V127_DIR/opus.node" ]]; then
    SOURCE="$NODE_V127_DIR/opus.node"
  else
    # Fallback: probe Bun's npm cache for any prebuilt version
    SOURCE="$(find "$HOME/.bun/install/cache" -path '*/@discordjs/opus/prebuild/node-v*/opus.node' 2>/dev/null | head -1 || true)"
  fi

  if [[ -n "$SOURCE" && ! -f "$NEEDED_DIR/opus.node" ]]; then
    if [[ "$QUIET" -eq 0 ]]; then
      echo "[mcd] installing @discordjs/opus node-v137 shim from $(basename "$(dirname "$SOURCE")")…"
    fi
    cp "$SOURCE" "$NEEDED_DIR/opus.node"
    chmod +x "$NEEDED_DIR/opus.node"
  elif [[ "$FORCE" -eq 1 && -n "$SOURCE" ]]; then
    cp "$SOURCE" "$NEEDED_DIR/opus.node"
    chmod +x "$NEEDED_DIR/opus.node"
  else
    [[ "$QUIET" -eq 0 ]] && echo "[mcd] @discordjs/opus binary present — no shim needed"
  fi
elif [[ "$QUIET" -eq 0 ]]; then
  echo "[mcd] @discordjs/opus not installed (no voice deps) — skipping binary shim"
fi

# Sanity check
if [[ -d "$OPUS_DIR" ]]; then
  if "$BUN" -e 'const o = require("@discordjs/opus"); if (typeof o.OpusEncoder !== "function") process.exit(2)' 2>/dev/null; then
    [[ "$QUIET" -eq 0 ]] && echo "[mcd] @discordjs/opus loads cleanly under bun"
  else
    echo "[mcd] WARNING: @discordjs/opus import check failed — voice may not work at runtime" >&2
  fi
fi

exit 0
