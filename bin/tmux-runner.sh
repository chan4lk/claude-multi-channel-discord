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
REPO_DIR="${MCD_REPO_DIR:-$HOME/dev/multi-channel-discord}"
BUN="${BUN_BIN:-$HOME/.bun/bin/bun}"

# Honor /tmp resets after reboot.
rm -rf /tmp/tmux-* 2>/dev/null || true

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
