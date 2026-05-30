#!/usr/bin/env bash
# Restart the multi-channel-discord server running in the "mcd" tmux session.
#
# Usage:
#   bin/restart-server.sh                  # restart (default state dir)
#   MCD_CHANNELS_DIR=/path bin/restart-server.sh
#
# IMPORTANT: Run this from OUTSIDE the mcd tmux session (e.g. a separate terminal
# or shell). If you run it from inside the bot (as a Claude Code subprocess), it
# kills the session that spawned you.
set -euo pipefail

SESSION="${MCD_TMUX_SESSION:-mcd}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# REPO_DIR is the multi-channel-discord repo where bun server.ts lives
REPO_DIR="${MCD_REPO_DIR:-/home/openclaw/dev/multi-channel-discord}"
STATE_DIR="${MCD_CHANNELS_DIR:-$HOME/.claude/channels/discord-multi}"

# Locate bun
if [[ -n "${BUN_BIN:-}" ]]; then
  BUN="$BUN_BIN"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then
  BUN="$HOME/.bun/bin/bun"
elif [[ -x "$HOME/.local/bin/bun" ]]; then
  BUN="$HOME/.local/bin/bun"
elif [[ -x "/home/openclaw/.bun/bin/bun" ]]; then
  BUN="/home/openclaw/.bun/bin/bun"
else
  BUN="$(command -v bun || true)"
fi
[[ -z "$BUN" ]] && { echo "bun not found — set BUN_BIN=/path/to/bun" >&2; exit 1; }

echo "[mcd] killing tmux session '${SESSION}'…"
tmux kill-session -t "$SESSION" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8; do
  tmux has-session -t "$SESSION" 2>/dev/null || break
  sleep 1
done

echo "[mcd] starting new tmux session '${SESSION}'…"
# --bun flag is REQUIRED: @discordjs/opus ships a node-v127 NAPI addon but Bun
# v1.3+ uses NAPI v137 (node-v137). Without --bun, Bun looks for node-v137 and
# the opus module crashes at import time, killing the entire server.
tmux new-session -d -s "$SESSION" \
  -c "$REPO_DIR" \
  -e "MCD_CHANNELS_DIR=${STATE_DIR}" \
  "$BUN" --bun server.ts

sleep 4
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[mcd] server started in tmux session '${SESSION}'"
  echo "      attach: tmux attach -t ${SESSION}"
  echo "      logs:   tmux attach -t ${SESSION}  (or pipe stderr to a file)"
else
  echo "[mcd] ERROR: session did not start — check bun/server.ts" >&2
  exit 1
fi
