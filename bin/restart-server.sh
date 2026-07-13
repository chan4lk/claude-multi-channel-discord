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
# WHATSAPP_ENABLED: unset by default. Set to 1 (or 0) on the command line to
# force-enable/disable WhatsApp for this restart only:
#   WHATSAPP_ENABLED=1 bin/restart-server.sh
# Otherwise the adapter is gated by the presence of <STATE_DIR>/whatsapp-auth/.

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

# Self-heal dependencies before restart. After a `git pull` that touched
# package.json, `node_modules/` is stale and the next bun startup will crash
# with "Cannot find module" — the runner then enters a tight 5s respawn loop
# and the script's 4s post-spawn probe can confirm the session but the gateway
# never connects. Running `bin/install-deps.sh` here guarantees a clean build
# before we kill the running process. Idempotent — no-op on a fresh tree.
"$SCRIPT_DIR/install-deps.sh"

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
#
# Inline env block: tmux's `-e` flag does not reliably propagate to commands
# when the command string itself assigns env, and `new-session` runs the
# command in a fresh login-less shell that does NOT inherit from this wrapper.
# Match the runner's pattern: build the env inline, then exec bun.
INLINE_ENV=(
  "MCD_CHANNELS_DIR='${STATE_DIR}'"
)
[[ -n "${WHATSAPP_ENABLED:-}" ]] && INLINE_ENV+=("WHATSAPP_ENABLED='${WHATSAPP_ENABLED}'")
tmux new-session -d -s "$SESSION" \
  -c "$REPO_DIR" \
  "${INLINE_ENV[*]} $BUN --bun server.ts"

sleep 4
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[mcd] server started in tmux session '${SESSION}'"
  echo "      attach: tmux attach -t ${SESSION}"
  echo "      logs:   tmux attach -t ${SESSION}  (or pipe stderr to a file)"
else
  echo "[mcd] ERROR: session did not start — check bun/server.ts" >&2
  exit 1
fi
