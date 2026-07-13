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
  # `=SESSION` forces exact name match; without it, tmux prefix-matches, so an
  # orphaned per-project session like `mcd-claude-…` fools us into thinking
  # the master session still exists and we silently no-op the restart.
  if ! tmux has-session -t "=$SESSION" 2>/dev/null; then
    # Self-heal stale/missing node_modules before each respawn. If a `git pull`
    # brought in new package.json entries (or wiped `node_modules/`), bun will
    # crash at import time on every respawn attempt and the runner enters a
    # tight 5s loop with no progress. Run install-deps here so each respawn
    # attempt starts from a clean build. Idempotent — no-op on a fresh tree.
    if [[ -x "$SCRIPT_DIR/install-deps.sh" ]]; then
      "$SCRIPT_DIR/install-deps.sh" --quiet || true
    fi
    # `tmux new-session` runs the command in a fresh login-less shell that does
    # NOT inherit env from this wrapper (so systemd's MCD_CHANNELS_DIR is dropped
    # on the floor). Inline the env assignment into the command string so the
    # spawned `bun server.ts` sees it. Use the systemd default when the wrapper
    # itself was started without the var (e.g. running the script by hand).
    # Build the inline env block. Only forward vars that are actually set in
    # the wrapper's env, so the command string stays short. MCD_CHANNELS_DIR
    # has a hardcoded fallback for when the wrapper itself was started without
    # the var (e.g. running the script by hand).
    INLINE_ENV=(
      "MCD_CHANNELS_DIR='${MCD_CHANNELS_DIR:-/home/openclaw/.claude/channels/discord-multi}'"
    )
    [[ -n "${WHATSAPP_ENABLED:-}" ]] && INLINE_ENV+=("WHATSAPP_ENABLED='$WHATSAPP_ENABLED'")
    tmux new-session -d -s "$SESSION" \
      -c "$REPO_DIR" \
      "${INLINE_ENV[*]} $BUN server.ts"
  fi

  # Block until the exact tmux session ends.
  while tmux has-session -t "=$SESSION" 2>/dev/null; do
    sleep 5
  done

  echo "[mcd] tmux session ended; restarting in 5s…" >&2
  sleep 5
done
