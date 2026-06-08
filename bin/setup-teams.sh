#!/usr/bin/env bash
# Provision an Azure Bot + App Registration for MCD's MS Teams adapter.
#
# Usage:
#   bin/setup-teams.sh <BOT_NAME> <RESOURCE_GROUP> <MESSAGING_HOST>
#
# Example:
#   bin/setup-teams.sh mcd-teams-bot rg-mcd bot.example.com
#
# Prerequisites:
#   - az CLI installed and logged in (az login)
#   - Permissions: Application.ReadWrite.All (to create app registrations)
#
# Outputs:
#   TEAMS_APP_ID and TEAMS_APP_SECRET — append to .env automatically
#   Teams app manifest ZIP at /tmp/teams-app.zip — upload to Teams Admin Center
set -euo pipefail

BOT_NAME="${1:?Usage: $0 <BOT_NAME> <RESOURCE_GROUP> <MESSAGING_HOST>}"
RESOURCE_GROUP="${2:?Usage: $0 <BOT_NAME> <RESOURCE_GROUP> <MESSAGING_HOST>}"
MESSAGING_HOST="${3:?Usage: $0 <BOT_NAME> <RESOURCE_GROUP> <MESSAGING_HOST>}"
MESSAGING_ENDPOINT="https://$MESSAGING_HOST/teams"
STATE_DIR="${MCD_CHANNELS_DIR:-$HOME/.claude/channels/discord-multi}"
ENV_FILE="$STATE_DIR/.env"

echo "[teams-setup] Checking az login..."
az account show --query "user.name" -o tsv > /dev/null

TENANT_ID=$(az account show --query "tenantId" -o tsv)
echo "[teams-setup] Tenant ID: $TENANT_ID"

echo "[teams-setup] Finding or creating App Registration: $BOT_NAME"
EXISTING_APP_ID=$(az ad app list --display-name "$BOT_NAME" --query "[0].appId" -o tsv 2>/dev/null || true)
if [[ -n "$EXISTING_APP_ID" && "$EXISTING_APP_ID" != "None" ]]; then
  APP_ID="$EXISTING_APP_ID"
  echo "[teams-setup] Reusing existing App ID: $APP_ID"
else
  APP_ID=$(az ad app create \
    --display-name "$BOT_NAME" \
    --sign-in-audience AzureADMyOrg \
    --query "appId" -o tsv)
  echo "[teams-setup] Created App ID: $APP_ID"
fi

echo "[teams-setup] Ensuring service principal exists in tenant..."
az ad sp show --id "$APP_ID" --query "id" -o tsv > /dev/null 2>&1 || \
  az ad sp create --id "$APP_ID" -o none
echo "[teams-setup] Service principal provisioned."

echo "[teams-setup] Resetting client secret (2-year expiry)..."
APP_SECRET=$(az ad app credential reset \
  --id "$APP_ID" \
  --years 2 \
  --query "password" -o tsv)

echo "[teams-setup] Creating resource group: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location eastus -o none

echo "[teams-setup] Finding or creating Azure Bot resource..."
EXISTING_BOT=$(az bot show --resource-group "$RESOURCE_GROUP" --name "$BOT_NAME" --query "name" -o tsv 2>/dev/null || true)
if [[ -n "$EXISTING_BOT" && "$EXISTING_BOT" != "None" ]]; then
  echo "[teams-setup] Bot already exists — updating endpoint..."
  az bot update \
    --resource-group "$RESOURCE_GROUP" \
    --name "$BOT_NAME" \
    --endpoint "$MESSAGING_ENDPOINT" \
    -o none
else
  az bot create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$BOT_NAME" \
    --app-type SingleTenant \
    --appid "$APP_ID" \
    --tenant-id "$TENANT_ID" \
    --endpoint "$MESSAGING_ENDPOINT" \
    --location "global" \
    --sku F0 \
    -o none
fi

echo "[teams-setup] Enabling Microsoft Teams channel (idempotent)..."
az bot msteams create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$BOT_NAME" \
  -o none

echo "[teams-setup] Writing credentials to $ENV_FILE..."
# Remove existing lines, append fresh ones
touch "$ENV_FILE"
chmod 0600 "$ENV_FILE"
grep -v "^TEAMS_APP_ID=\|^TEAMS_APP_SECRET=\|^TEAMS_TENANT_ID=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
echo "TEAMS_APP_ID=$APP_ID" >> "$ENV_FILE.tmp"
echo "TEAMS_APP_SECRET=$APP_SECRET" >> "$ENV_FILE.tmp"
echo "TEAMS_TENANT_ID=$TENANT_ID" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chmod 0600 "$ENV_FILE"

echo "[teams-setup] Building Teams app manifest ZIP..."
MANIFEST_DIR=$(mktemp -d)
cat > "$MANIFEST_DIR/manifest.json" << EOF
{
  "\$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "$APP_ID",
  "packageName": "com.mcd.teamsbot",
  "developer": {
    "name": "MCD",
    "websiteUrl": "https://github.com/chan4lk/claude-multi-channel-discord",
    "privacyUrl": "https://$MESSAGING_HOST/privacy",
    "termsOfUseUrl": "https://$MESSAGING_HOST/terms"
  },
  "name": { "short": "Claude MCD", "full": "Claude Multi-Channel Bot" },
  "description": {
    "short": "Claude Code sessions in Teams",
    "full": "Per-channel isolated Claude Code sessions powered by MCD"
  },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#5865F2",
  "bots": [{
    "botId": "$APP_ID",
    "scopes": ["team", "personal", "groupChat"],
    "isNotificationOnly": false,
    "supportsFiles": false
  }],
  "permissions": ["identity", "messageTeamMembers"],
  "authorization": {
    "permissions": {
      "resourceSpecific": [
        {
          "name": "ChannelMessage.Read.Group",
          "type": "Application"
        }
      ]
    }
  }
}
EOF

# Minimal 192x192 grey PNG (placeholder — replace with real icons before production)
python3 -c "
import struct, zlib
def png(w,h,rgb):
    raw=b''.join(b'\\x00'+bytes(rgb)*w for _ in range(h))
    def chunk(t,d):
        c=zlib.crc32(t+d)&0xffffffff
        return struct.pack('>I',len(d))+t+d+struct.pack('>I',c)
    return b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
open('$MANIFEST_DIR/color.png','wb').write(png(192,192,(88,101,242)))
open('$MANIFEST_DIR/outline.png','wb').write(png(32,32,(255,255,255)))
"

zip -j /tmp/teams-app.zip "$MANIFEST_DIR/manifest.json" "$MANIFEST_DIR/color.png" "$MANIFEST_DIR/outline.png"
rm -rf "$MANIFEST_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Teams bot setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TEAMS_APP_ID:     $APP_ID"
echo "  TEAMS_APP_SECRET: (written to .env)"
echo "  Endpoint:         $MESSAGING_ENDPOINT"
echo ""
echo "  Next steps:"
echo "  1. Upload /tmp/teams-app.zip to Teams Admin Center > Manage apps > Upload"
echo "     (or sideload via Teams client for dev testing)"
echo "  2. Restart MCD:  bin/restart-server.sh"
echo "  3. Add a channel: !project create --platform teams <CONV_ID> <slug>"
echo "     (get CONV_ID from the first Teams message the bot receives)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
