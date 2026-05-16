#!/usr/bin/env bash
# Optional tmux wrapper for multi-channel-discord. Useful when you want to
# `tmux attach -t mcd` and watch live logs without redirecting through
# journalctl. systemd service can ExecStart= this instead of `bun server.ts`
# directly.
#
# Default behavior: starts a detached tmux session named "mcd" running the
# server, restarts on crash with backoff.
set -u

SESSION="${MCD_TMUX_SESSION:-mcd}"
# Default to the repo this script lives in, not a fixed path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${MCD_REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# Find bun: explicit override, then common install locations, then PATH.
if [[ -n "${BUN_BIN:-}" ]]; then
  BUN="$BUN_BIN"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then
  BUN="$HOME/.bun/bin/bun"
elif [[ -x "$HOME/.local/bin/bun" ]]; then
  BUN="$HOME/.local/bin/bun"
else
  BUN="$(command -v bun || true)"
fi
[[ -z "$BUN" ]] && { echo "bun not found — set BUN_BIN" >&2; exit 1; }

# Stale tmux sockets after reboot. macOS uses /var/folders, Linux uses /tmp.
# Only clean what tmux owns under /tmp; leave anything else alone.
rm -rf /tmp/tmux-"$(id -u)" 2>/dev/null || true

while true; do
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-session -d -s "$SESSION" \
      -c "$REPO_DIR" \
      "$BUN server.ts"
  fi

  # Block until the tmux session ends.
  while tmux has-session -t "$SESSION" 2>/dev/null; do
    sleep 5
  done

  echo "[mcd] tmux session ended; restarting in 5s…" >&2
  sleep 5
done
