#!/usr/bin/env bash
# Install multi-channel-discord as an auto-starting user service.
#
# Detects platform:
#   - macOS  → launchd user agent at ~/Library/LaunchAgents
#   - Linux  → systemd user unit at ~/.config/systemd/user
#
# Usage:
#   bin/install-service.sh                          # install + start
#   bin/install-service.sh --uninstall              # stop + remove
#   bin/install-service.sh --restart                # restart running service
#   MCD_CHANNELS_DIR=... bin/install-service.sh     # override state dir
#
# Idempotent: re-running replaces the existing definition. Logs go to:
#   macOS  ~/Library/Logs/multi-channel-discord/{stdout,stderr}.log
#   Linux  journalctl --user -u multi-channel-discord
set -euo pipefail

LABEL="com.bistec.multi-channel-discord"
UNIT="multi-channel-discord"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="${MCD_CHANNELS_DIR:-$HOME/.claude/channels/discord-multi}"

ACTION="install"
if [[ "${1:-}" == "--uninstall" ]]; then ACTION="uninstall"
elif [[ "${1:-}" == "--restart" ]]; then ACTION="restart"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,/^set -e/p' "$0" | head -n -1
  exit 0
fi

# Locate bun. The service must point at an absolute path — launchd and
# systemd user units start with a minimal PATH.
find_bun() {
  if [[ -n "${BUN_BIN:-}" && -x "$BUN_BIN" ]]; then echo "$BUN_BIN"; return; fi
  for p in "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun" "/opt/homebrew/bin/bun" "/usr/local/bin/bun"; do
    [[ -x "$p" ]] && { echo "$p"; return; }
  done
  command -v bun 2>/dev/null || true
}
BUN=$(find_bun)
if [[ "$ACTION" != "uninstall" ]]; then
  [[ -z "$BUN" ]] && { echo "bun not found — set BUN_BIN=/path/to/bun" >&2; exit 1; }
  [[ -d "$STATE_DIR" ]] || { echo "state dir missing: $STATE_DIR — run bin/setup-new-instance.sh first" >&2; exit 1; }
fi

case "$(uname -s)" in
  Darwin)  PLATFORM="darwin" ;;
  Linux)   PLATFORM="linux" ;;
  *)       echo "unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac

# ─── macOS: launchd ───────────────────────────────────────────────────────
install_launchd() {
  local plist="$HOME/Library/LaunchAgents/${LABEL}.plist"
  local log_dir="$HOME/Library/Logs/multi-channel-discord"
  mkdir -p "$HOME/Library/LaunchAgents" "$log_dir"

  # Pass through tokens the service may need at spawn time. launchd doesn't
  # source shell rc files, so anything `git-credentials.json` references via
  # envVar must be exported in the caller's shell when running this script.
  local extra_env=""
  for var in GITHUB_TOKEN AZURE_DEVOPS_PAT MINIMAX_API_KEY ANTHROPIC_API_KEY; do
    local v="${!var:-}"
    if [[ -n "$v" ]]; then
      extra_env+="
        <key>${var}</key>
        <string>$(printf '%s' "$v" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')</string>"
    fi
  done

  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${BUN}</string>
        <string>server.ts</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>MCD_CHANNELS_DIR</key>
        <string>${STATE_DIR}</string>
        <key>PATH</key>
        <string>$(dirname "$BUN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <!-- claude CLI checks isTTY via TERM. Without it claude bails to
             non-interactive --print mode inside the tmux PTY and exits
             immediately. launchd and systemd both omit TERM by default. -->
        <key>TERM</key>
        <string>xterm-256color</string>${extra_env}
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${log_dir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${log_dir}/stderr.log</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST
  chmod 0644 "$plist"

  # Replace any existing instance. Wait for bootout to release the label
  # before bootstrap; otherwise launchd returns I/O error 5 on a tight loop.
  if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || break
      sleep 1
    done
  fi
  launchctl bootstrap "gui/$(id -u)" "$plist" || {
    # Sometimes bootstrap races even after print returns no service; one more retry.
    sleep 2
    launchctl bootstrap "gui/$(id -u)" "$plist"
  }
  sleep 2
  if launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | grep -q 'state = running'; then
    echo "installed and running: ${LABEL}"
    echo "logs: ${log_dir}/{stdout,stderr}.log"
  else
    echo "installed but not running — check ${log_dir}/stderr.log" >&2
    exit 1
  fi
}

uninstall_launchd() {
  local plist="$HOME/Library/LaunchAgents/${LABEL}.plist"
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "$plist"
  echo "uninstalled: ${LABEL}"
}

restart_launchd() {
  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
  echo "restarted: ${LABEL}"
}

# ─── Linux: systemd user unit ─────────────────────────────────────────────
install_systemd() {
  local unit_dir="$HOME/.config/systemd/user"
  local unit_file="$unit_dir/${UNIT}.service"
  mkdir -p "$unit_dir"

  cat > "$unit_file" <<UNIT
[Unit]
Description=multi-channel-discord — project-aware Discord bot for Claude Code
Documentation=https://github.com/chan4lk/claude-multi-channel-discord
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
Environment=MCD_CHANNELS_DIR=${STATE_DIR}
Environment=PATH=$(dirname "$BUN"):%h/.bun/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
# claude CLI checks isTTY via TERM. Without it claude bails to non-interactive
# --print mode inside the tmux PTY and exits immediately.
Environment=TERM=xterm-256color
# Optional pass-through for tokens git-credentials.json may reference. Place
# any KEY=value lines you want exposed to the service in this file (mode 0600).
EnvironmentFile=-%h/.config/multi-channel-discord/env
ExecStart=${BUN} server.ts
Restart=on-failure
RestartSec=10s
TimeoutStartSec=60
MemoryMax=8G

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable --now "${UNIT}"
  sleep 1
  if systemctl --user is-active --quiet "${UNIT}"; then
    echo "installed and running: ${UNIT}"
    echo "logs: journalctl --user -u ${UNIT} -f"
  else
    echo "installed but not running — check journalctl --user -u ${UNIT}" >&2
    exit 1
  fi
}

uninstall_systemd() {
  systemctl --user disable --now "${UNIT}" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/${UNIT}.service"
  systemctl --user daemon-reload
  echo "uninstalled: ${UNIT}"
}

restart_systemd() {
  systemctl --user restart "${UNIT}"
  echo "restarted: ${UNIT}"
}

# ─── dispatch ─────────────────────────────────────────────────────────────
case "${PLATFORM}:${ACTION}" in
  darwin:install)    install_launchd ;;
  darwin:uninstall)  uninstall_launchd ;;
  darwin:restart)    restart_launchd ;;
  linux:install)     install_systemd ;;
  linux:uninstall)   uninstall_systemd ;;
  linux:restart)     restart_systemd ;;
esac
