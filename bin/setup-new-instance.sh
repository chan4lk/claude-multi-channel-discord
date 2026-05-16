#!/usr/bin/env bash
# Bootstrap a fresh multi-channel-discord install in its own state dir,
# safe to run alongside an existing upstream Discord plugin install.
#
# Prereqs (you do these in the Discord Developer Portal first):
#   1. Create a new Discord application at
#      https://discord.com/developers/applications
#   2. Bot tab: pick a username; enable "Message Content Intent"
#   3. Reset Token, copy it
#   4. OAuth2 → URL Generator: scope=bot, permissions = View Channels,
#      Send Messages, Send Messages in Threads, Read Message History,
#      Add Reactions. Open the URL, invite the bot to your server.
#   5. In Discord, with Developer Mode on, right-click your user → Copy User ID
#      and right-click the channel you'll use as master → Copy Channel ID
#
# Then run this script with those values (token via stdin to avoid argv leak):
#
#   bin/setup-new-instance.sh \
#     --state-dir ~/.claude/channels/discord-multi \
#     --user-id   <your-discord-user-snowflake> \
#     --master    <master-channel-snowflake> \
#     --slug      master \
#     --prompt    "You are the master controller. Be terse." \
#     <<< "$DISCORD_BOT_TOKEN"
#
# The token is read from stdin (last arg above is a here-string). Leaves you
# with everything in $STATE_DIR ready for `MCD_CHANNELS_DIR=$STATE_DIR bun server.ts`.
set -euo pipefail

usage() {
  sed -n '2,/^set -e/p' "$0" | head -n -1
  exit 1
}

STATE_DIR=""
USER_ID=""
MASTER=""
SLUG="master"
PROMPT="You are the master controller for the multi-channel-discord bot. Be terse."

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --user-id)   USER_ID="$2";   shift 2 ;;
    --master)    MASTER="$2";    shift 2 ;;
    --slug)      SLUG="$2";      shift 2 ;;
    --prompt)    PROMPT="$2";    shift 2 ;;
    -h|--help)   usage ;;
    *) echo "unknown flag: $1" >&2; usage ;;
  esac
done

[[ -z "$STATE_DIR" ]] && { echo "--state-dir is required" >&2; exit 1; }
[[ -z "$USER_ID"   ]] && { echo "--user-id is required" >&2; exit 1; }
[[ -z "$MASTER"    ]] && { echo "--master is required" >&2; exit 1; }

if [[ -t 0 ]]; then
  echo "Reading bot token from stdin (paste then Ctrl-D, or pipe via heredoc):" >&2
fi
TOKEN=""
IFS= read -r TOKEN
[[ -z "$TOKEN" ]] && { echo "empty token on stdin" >&2; exit 1; }

# Resolve to absolute path. macOS doesn't ship realpath by default; fall back.
if realpath -m / >/dev/null 2>&1; then
  STATE_DIR=$(realpath -m "$STATE_DIR")
else
  # macOS realpath lacks -m (requires path to exist). Resolve parent only.
  parent_dir="$(dirname "$STATE_DIR")"
  mkdir -p "$parent_dir"
  STATE_DIR="$(cd "$parent_dir" && pwd)/$(basename "$STATE_DIR")"
fi

if [[ -d "$STATE_DIR" ]] && [[ -n "$(ls -A "$STATE_DIR" 2>/dev/null)" ]]; then
  echo "refusing to overwrite non-empty $STATE_DIR" >&2
  echo "delete it first if you really mean to start fresh" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

# .env (token only)
umask 077
printf 'DISCORD_BOT_TOKEN=%s\n' "$TOKEN" > "$STATE_DIR/.env"

# access.json — allow only the operator's user ID to DM. The master channel
# is added to groups so commands work there; pairing remains the default
# policy for any other DM.
cat > "$STATE_DIR/access.json" <<JSON
{
  "dmPolicy": "allowlist",
  "allowFrom": ["$USER_ID"],
  "groups": {
    "$MASTER": {
      "requireMention": false,
      "allowFrom": []
    }
  },
  "pending": {}
}
JSON
chmod 600 "$STATE_DIR/access.json"

# channels.json + projects/<slug>/CLAUDE.md via the existing init script.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCD_CHANNELS_DIR="$STATE_DIR" bun "$REPO_DIR/src/init.ts" \
  --master "$MASTER" \
  --slug   "$SLUG" \
  --prompt "$PROMPT"

# Replace the basic CLAUDE.md from init.ts with the master template that
# documents the full command surface + run_master_command tool. The
# operator can edit it later — it's their per-host config.
TEMPLATE="$REPO_DIR/templates/master.CLAUDE.md"
if [[ -r "$TEMPLATE" ]]; then
  cp "$TEMPLATE" "$STATE_DIR/projects/$SLUG/CLAUDE.md"
  chmod 0600 "$STATE_DIR/projects/$SLUG/CLAUDE.md"
  echo "deployed master CLAUDE.md template"
fi

cat <<DONE

Setup complete in: $STATE_DIR

Files written:
  $STATE_DIR/.env            (mode 0600)
  $STATE_DIR/access.json     (mode 0600)
  $STATE_DIR/channels.json
  $STATE_DIR/projects/$SLUG/CLAUDE.md

Run the new bot with:

  cd $REPO_DIR
  MCD_CHANNELS_DIR=$STATE_DIR bun server.ts
DONE

case "$(uname -s)" in
  Darwin)
    cat <<DONE

Or install as a launchd user agent (macOS):

  bin/install-service.sh
DONE
    ;;
  Linux)
    cat <<DONE

Or as a user systemd service (Linux):

  cp systemd/multi-channel-discord.service ~/.config/systemd/user/
  # edit to add: Environment=MCD_CHANNELS_DIR=$STATE_DIR
  systemctl --user daemon-reload
  systemctl --user enable --now multi-channel-discord
DONE
    ;;
esac
