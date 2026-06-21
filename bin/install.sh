#!/usr/bin/env bash
# One-liner installer for multi-channel-discord (MCD).
# Supports Linux (Ubuntu/Debian) and macOS.
#
# Non-interactive (curl-pipe-safe): pass env vars to skip prompts.
#   MCD_BOT_TOKEN=xxx MCD_USER_ID=yyy MCD_MASTER_CHANNEL=zzz bash install.sh
#
# Interactive wizard runs only when ~/.claude/channels/discord-multi/.env
# does not already exist.
set -euo pipefail

REPO_URL="https://github.com/chan4lk/claude-multi-channel-discord"
INSTALL_DIR="${MCD_INSTALL_DIR:-$HOME/multi-channel-discord}"
STATE_DIR="${MCD_STATE_DIR:-$HOME/.claude/channels/discord-multi}"
SERVICE_NAME="mcd"

OS="$(uname -s)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '\033[0;32m[mcd-install]\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m[mcd-install]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m[mcd-install]\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 1. Detect OS
# ---------------------------------------------------------------------------
case "$OS" in
  Linux)
    DISTRO="linux"
    if have apt-get; then PKG_MANAGER="apt-get"; else PKG_MANAGER="none"; fi
    ;;
  Darwin)
    DISTRO="macos"
    PKG_MANAGER="brew"
    ;;
  *)
    error "Unsupported OS: $OS. Use the PowerShell installer on Windows."
    ;;
esac
info "Detected OS: $OS ($DISTRO)"

# ---------------------------------------------------------------------------
# 2. Install bun if missing
# ---------------------------------------------------------------------------
BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
if have bun || [[ -x "$BUN_BIN" ]]; then
  info "bun already installed"
  # Ensure bun is on PATH for the rest of this script
  export PATH="$HOME/.bun/bin:$PATH"
else
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# ---------------------------------------------------------------------------
# 3. Install tmux if missing
# ---------------------------------------------------------------------------
if have tmux; then
  info "tmux already installed"
else
  info "Installing tmux..."
  case "$DISTRO" in
    linux)
      if [[ "$PKG_MANAGER" == "apt-get" ]]; then
        sudo apt-get install -y tmux
      else
        warn "Cannot auto-install tmux on this distro. Please install it manually."
      fi
      ;;
    macos)
      if have brew; then
        brew install tmux
      else
        warn "Homebrew not found. Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        brew install tmux
      fi
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# 4. Install git if missing
# ---------------------------------------------------------------------------
if have git; then
  info "git already installed"
else
  info "Installing git..."
  case "$DISTRO" in
    linux)
      if [[ "$PKG_MANAGER" == "apt-get" ]]; then
        sudo apt-get install -y git
      else
        warn "Cannot auto-install git on this distro. Please install it manually."
      fi
      ;;
    macos)
      brew install git
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# 5. Clone or pull repo
# ---------------------------------------------------------------------------
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Repo already cloned at $INSTALL_DIR — pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only || warn "git pull failed (local changes?), skipping"
else
  info "Cloning $REPO_URL to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
info "Installing dependencies..."
bun install --no-summary

# ---------------------------------------------------------------------------
# 6. Run setup wizard if not already configured
# ---------------------------------------------------------------------------
ENV_FILE="$STATE_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  info "Already configured ($ENV_FILE exists). Skipping setup wizard."
else
  info "Running setup wizard..."

  # Non-interactive mode: require env vars to avoid read -p
  TOKEN="${MCD_BOT_TOKEN:-}"
  USER_ID="${MCD_USER_ID:-}"
  MASTER="${MCD_MASTER_CHANNEL:-}"

  if [[ -z "$TOKEN" || -z "$USER_ID" || -z "$MASTER" ]]; then
    if [[ -t 0 && -t 1 ]]; then
      # Interactive terminal — use the full setup script which reads token from stdin
      info "Launching interactive setup (see prompts below)..."
      echo "MCD requires three values from the Discord Developer Portal:"
      echo "  MCD_BOT_TOKEN      - bot token"
      echo "  MCD_USER_ID        - your Discord user snowflake"
      echo "  MCD_MASTER_CHANNEL - master channel snowflake"
      echo ""
      read -rp "Bot token: " TOKEN
      read -rp "Your Discord user ID: " USER_ID
      read -rp "Master channel ID: " MASTER
    else
      warn "Non-interactive mode: set MCD_BOT_TOKEN, MCD_USER_ID, MCD_MASTER_CHANNEL to auto-configure."
      warn "Skipping setup wizard — start the server manually after setting those vars."
      TOKEN=""
    fi
  fi

  if [[ -n "$TOKEN" && -n "$USER_ID" && -n "$MASTER" ]]; then
    "$INSTALL_DIR/bin/setup-new-instance.sh" \
      --state-dir "$STATE_DIR" \
      --user-id   "$USER_ID" \
      --master    "$MASTER" \
      --slug      "master" \
      --prompt    "You are the master controller for the multi-channel-discord bot. Be terse." \
      <<< "$TOKEN"
    info "Setup complete."
  fi
fi

# ---------------------------------------------------------------------------
# 7. Register system service (idempotent)
# ---------------------------------------------------------------------------
START_CMD="$(which bun || echo "$HOME/.bun/bin/bun") server.ts"
BUN_PATH="$(which bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"

case "$DISTRO" in
  linux)
    # Try user systemd first; fall back to system systemd if we have sudo.
    SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
    SYSTEMD_SYSTEM_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    SYSTEMD_USER_FILE="$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"

    if systemctl --user is-enabled "$SERVICE_NAME" >/dev/null 2>&1 || \
       systemctl is-enabled "$SERVICE_NAME" >/dev/null 2>&1; then
      info "systemd service '$SERVICE_NAME' already registered. Skipping."
    else
      mkdir -p "$SYSTEMD_USER_DIR"
      cat > "$SYSTEMD_USER_FILE" <<UNIT
[Unit]
Description=multi-channel-discord (MCD)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$BUN_PATH server.ts
Restart=on-failure
RestartSec=5s
Environment=MCD_CHANNELS_DIR=$STATE_DIR
Environment=HOME=$HOME

[Install]
WantedBy=default.target
UNIT
      systemctl --user daemon-reload
      systemctl --user enable "$SERVICE_NAME"
      info "Registered user systemd service: $SYSTEMD_USER_FILE"
    fi
    ;;
  macos)
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.github.chan4lk.mcd.plist"
    PLIST_LABEL="com.github.chan4lk.mcd"

    if launchctl list "$PLIST_LABEL" >/dev/null 2>&1; then
      info "launchd service '$PLIST_LABEL' already registered. Skipping."
    else
      mkdir -p "$PLIST_DIR"
      cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_PATH</string>
    <string>server.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MCD_CHANNELS_DIR</key>
    <string>$STATE_DIR</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$HOME/.claude/channels/discord-multi/mcd.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.claude/channels/discord-multi/mcd-error.log</string>
</dict>
</plist>
PLIST
      launchctl load "$PLIST_FILE"
      info "Registered launchd agent: $PLIST_FILE"
    fi
    ;;
esac

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "MCD installed."
case "$DISTRO" in
  linux)
    echo "Run 'systemctl --user start mcd' (Linux) to start."
    ;;
  macos)
    echo "Run 'launchctl start com.github.chan4lk.mcd' (macOS) to start."
    ;;
esac
