#!/usr/bin/env bash
# Find and (with --delete) remove guild text channels that aren't in
# channels.json `projects`. Useful after a bug like the May 2026
# "--new-channel created a fresh channel on every retry" incident
# left a pile of orphans.
#
# Usage:
#   bin/cleanup-orphan-channels.sh                          # dry run, prints orphans
#   bin/cleanup-orphan-channels.sh --delete-all             # delete every flagged orphan
#   bin/cleanup-orphan-channels.sh --delete <id> [<id>...]  # delete only the listed ids
#
# Reads the bot token from $MCD_CHANNELS_DIR/.env (default
# ~/.claude/channels/discord-multi/.env). Hits Discord REST directly
# rather than going through the live bot — safer and works even if the
# bot's gateway connection is wedged.
set -euo pipefail

STATE_DIR="${MCD_CHANNELS_DIR:-$HOME/.claude/channels/discord-multi}"
ENV_FILE="$STATE_DIR/.env"
CHANNELS_JSON="$STATE_DIR/channels.json"

DELETE_ALL=0
DELETE_IDS=()
if [[ "${1:-}" == "--delete-all" ]]; then
  DELETE_ALL=1
elif [[ "${1:-}" == "--delete" ]]; then
  shift
  for id in "$@"; do DELETE_IDS+=("$id"); done
fi

[[ -r "$ENV_FILE" ]] || { echo "no .env at $ENV_FILE" >&2; exit 1; }
[[ -r "$CHANNELS_JSON" ]] || { echo "no channels.json at $CHANNELS_JSON" >&2; exit 1; }

TOKEN=$(grep -E '^DISCORD_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[[ -n "$TOKEN" ]] || { echo "DISCORD_BOT_TOKEN missing from $ENV_FILE" >&2; exit 1; }

REGISTERED=$(python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    cfg = json.load(f)
for chat_id in (cfg.get("projects") or {}).keys():
    print(chat_id)
master = (cfg.get("master") or {}).get("chatId")
if master:
    print(master)
' "$CHANNELS_JSON" | sort -u)

# Map of registered slug → its chat_id. Orphans are channels whose name
# equals a registered slug but whose id is NOT that registered chat_id —
# i.e. a #keyflow that isn'"'"'t the live keyflow project channel.
REGISTERED_SLUG_TO_ID=$(python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    cfg = json.load(f)
for chat_id, p in (cfg.get("projects") or {}).items():
    print(p["slug"] + "\t" + chat_id)
' "$CHANNELS_JSON")

# Find guild(s) the bot is in.
GUILDS=$(curl -fsS -H "Authorization: Bot $TOKEN" "https://discord.com/api/v10/users/@me/guilds")

# Use python (always present) for JSON parsing — jq isn't guaranteed.
PARSE_GUILDS='
import json, sys
for g in json.loads(sys.stdin.read()):
    print(g["id"] + "\t" + g["name"])
'
PARSE_CHANNELS='
import json, sys
for c in json.loads(sys.stdin.read()):
    if c.get("type") == 0:  # GUILD_TEXT
        print(c["id"] + "\t" + c.get("name","") + "\t0")
'

ORPHANS=()
ORPHAN_NAMES=()
while IFS=$'\t' read -r GUILD_ID GUILD_NAME; do
  CHANNELS=$(curl -fsS -H "Authorization: Bot $TOKEN" "https://discord.com/api/v10/guilds/$GUILD_ID/channels")
  while IFS=$'\t' read -r CH_ID CH_NAME CH_TYPE; do
    [[ "$CH_TYPE" == "0" ]] || continue
    # Skip if this channel id is itself registered.
    if grep -qx "$CH_ID" <<< "$REGISTERED"; then continue; fi
    # Only flag as orphan if the channel name matches a slug that IS
    # registered to a different chat_id — that's the duplicate-from-retry
    # signature. Channels with names not matching any registered slug
    # (#general, #claude-code, your real channels) are left alone.
    # Look up a registered chat_id for this channel name. Use awk for tab
    # parsing — `grep -P` is GNU-only and missing on macOS BSD grep.
    REGISTERED_ID_FOR_NAME=$(awk -F'\t' -v n="$CH_NAME" '$1==n {print $2; exit}' <<< "$REGISTERED_SLUG_TO_ID")
    [[ -z "$REGISTERED_ID_FOR_NAME" ]] && continue
    [[ "$REGISTERED_ID_FOR_NAME" == "$CH_ID" ]] && continue
    ORPHANS+=("$CH_ID")
    ORPHAN_NAMES+=("$GUILD_NAME / #$CH_NAME ($CH_ID) — slug \"$CH_NAME\" is registered as $REGISTERED_ID_FOR_NAME")
  done < <(python3 -c "$PARSE_CHANNELS" <<< "$CHANNELS")
done < <(python3 -c "$PARSE_GUILDS" <<< "$GUILDS")

if [[ ${#ORPHANS[@]} -eq 0 ]]; then
  echo "no orphan channels found"
  exit 0
fi

echo "Channels NOT registered in channels.json (= candidates for cleanup):"
for line in "${ORPHAN_NAMES[@]}"; do
  echo "  $line"
done
echo

if [[ $DELETE_ALL -eq 0 && ${#DELETE_IDS[@]} -eq 0 ]]; then
  echo "(dry run — pass --delete <id> [<id>...] to delete specific channels,"
  echo "          or --delete-all to remove every flagged orphan)"
  exit 0
fi

# Determine which ids to actually delete.
TO_DELETE=()
if [[ $DELETE_ALL -eq 1 ]]; then
  TO_DELETE=("${ORPHANS[@]}")
else
  for id in "${DELETE_IDS[@]}"; do
    found=0
    for o in "${ORPHANS[@]}"; do
      if [[ "$o" == "$id" ]]; then found=1; break; fi
    done
    if [[ $found -eq 1 ]]; then
      TO_DELETE+=("$id")
    else
      echo "  skip $id (not flagged as orphan)"
    fi
  done
fi

if [[ ${#TO_DELETE[@]} -eq 0 ]]; then
  echo "nothing to delete"
  exit 0
fi

echo "Deleting…"
for ch_id in "${TO_DELETE[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE \
    -H "Authorization: Bot $TOKEN" \
    "https://discord.com/api/v10/channels/$ch_id")
  echo "  $ch_id → HTTP $status"
done
echo "done"
