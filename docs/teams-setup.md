# MS Teams Bot Setup via Azure CLI

Claude can execute these steps end-to-end using the `az` CLI. Prerequisites: `az` installed and logged in (`az login`).

## Step 1 — Set variables

```bash
APP_NAME="mcd-teams-bot"          # display name for the App Registration
RESOURCE_GROUP="rg-mcd"           # Azure resource group
BOT_NAME="mcd-teams-bot"          # Azure Bot resource name
LOCATION="eastus"
MESSAGING_ENDPOINT="https://YOUR_HOST/teams"   # replace YOUR_HOST
```

## Step 2 — Ensure logged in

```bash
az account show --query "user.name" -o tsv
# If blank or error: az login
```

## Step 3 — Create resource group (skip if exists)

```bash
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
```

## Step 4 — Create App Registration (multi-tenant)

```bash
APP_ID=$(az ad app create \
  --display-name "$APP_NAME" \
  --sign-in-audience AzureADMultipleOrgs \
  --query "appId" -o tsv)
echo "App ID: $APP_ID"
```

## Step 5 — Create client secret (2-year expiry)

```bash
APP_SECRET=$(az ad app credential reset \
  --id "$APP_ID" \
  --years 2 \
  --query "password" -o tsv)
echo "Secret created (save this — shown once)"
```

## Step 6 — Create Azure Bot resource

```bash
az bot create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$BOT_NAME" \
  --app-type MultiTenant \
  --appid "$APP_ID" \
  --endpoint "$MESSAGING_ENDPOINT" \
  --location "global" \
  --sku F0
```

> **Note:** Azure Bot location must be `"global"` regardless of `$LOCATION`. Resource group location is separate.

## Step 7 — Enable Microsoft Teams channel

```bash
az bot msteams create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$BOT_NAME"
```

## Step 8 — Write credentials to MCD

```bash
# Run from inside the master Discord channel, or:
!project teams-setup $APP_ID $APP_SECRET
```

Or directly on the server:
```bash
echo "TEAMS_APP_ID=$APP_ID" >> ~/.claude/channels/discord-multi/.env
echo "TEAMS_APP_SECRET=$APP_SECRET" >> ~/.claude/channels/discord-multi/.env
chmod 600 ~/.claude/channels/discord-multi/.env
```

## Step 9 — Register Teams app manifest

```bash
# Create manifest directory
mkdir -p /tmp/teams-app

cat > /tmp/teams-app/manifest.json << EOF
{
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "$APP_ID",
  "packageName": "com.mcd.teamsbot",
  "developer": { "name": "MCD", "websiteUrl": "https://github.com/chan4lk/claude-multi-channel-discord", "privacyUrl": "https://example.com", "termsOfUseUrl": "https://example.com" },
  "name": { "short": "Claude MCD", "full": "Claude Multi-Channel Discord Bot" },
  "description": { "short": "Claude Code in Teams", "full": "Per-channel Claude Code sessions via MCD" },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#5865F2",
  "bots": [{
    "botId": "$APP_ID",
    "scopes": ["team", "personal", "groupChat"],
    "isNotificationOnly": false,
    "supportsFiles": false
  }],
  "permissions": ["identity", "messageTeamMembers"]
}
EOF

# Placeholder icons (replace with real ones)
printf '\x89PNG\r\n\x1a\n' > /tmp/teams-app/color.png
cp /tmp/teams-app/color.png /tmp/teams-app/outline.png

cd /tmp/teams-app && zip -j /tmp/teams-app.zip manifest.json color.png outline.png
echo "Upload /tmp/teams-app.zip via Teams Admin Center > Manage apps > Upload"
```

## Step 10 — Restart MCD and register Teams channel

```bash
# On the server (outside the mcd tmux session):
bin/restart-server.sh

# Then in master Discord channel — register the Teams conversation ID:
# (get the conversation ID from the first message the bot receives in Teams)
!project create --platform teams <TEAMS_CONV_ID> <slug>
```

---

## One-liner Claude can run (Steps 2–8, given HOST and creds)

```bash
set -euo pipefail
APP_NAME="${1:-mcd-teams-bot}"
RG="${2:-rg-mcd}"
HOST="${3:?HOST required}"

APP_ID=$(az ad app create --display-name "$APP_NAME" --sign-in-audience AzureADMultipleOrgs --query appId -o tsv)
SECRET=$(az ad app credential reset --id "$APP_ID" --years 2 --query password -o tsv)
az group create --name "$RG" --location eastus -o none
az bot create --resource-group "$RG" --name "$APP_NAME" --app-type MultiTenant --appid "$APP_ID" --endpoint "https://$HOST/teams" --location global --sku F0 -o none
az bot msteams create --resource-group "$RG" --name "$APP_NAME" -o none
echo "TEAMS_APP_ID=$APP_ID"
echo "TEAMS_APP_SECRET=$SECRET"
```

Save as `bin/setup-teams.sh` and run `bin/setup-teams.sh mcd-teams-bot rg-mcd your.host.name`.
