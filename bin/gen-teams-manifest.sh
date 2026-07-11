#!/usr/bin/env bash
# Generate a Teams app manifest ZIP from an existing App Registration.
# No Azure CLI required.
#
# Usage:
#   bin/gen-teams-manifest.sh <APP_ID> <MESSAGING_HOST> [OUTPUT_ZIP]
#
# Example:
#   bin/gen-teams-manifest.sh 00000000-0000-0000-0000-000000000000 mcd.tecbizsolutions.com
#   bin/gen-teams-manifest.sh <APP_ID> <HOST> /tmp/my-app.zip
set -euo pipefail

APP_ID="${1:?Usage: $0 <APP_ID> <MESSAGING_HOST> [OUTPUT_ZIP]}"
MESSAGING_HOST="${2:?Usage: $0 <APP_ID> <MESSAGING_HOST> [OUTPUT_ZIP]}"
OUTPUT_ZIP="${3:-/tmp/teams-app.zip}"

MANIFEST_DIR=$(mktemp -d)
trap 'rm -rf "$MANIFEST_DIR"' EXIT

cat > "$MANIFEST_DIR/manifest.json" << EOF
{
  "\$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.2",
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
    "supportsFiles": true
  }],
  "permissions": ["identity", "messageTeamMembers"],
  "webApplicationInfo": {
    "id": "$APP_ID",
    "resource": "https://RscBasedStoreApp"
  },
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

python3 - "$MANIFEST_DIR" << 'PYEOF'
import struct, zlib, sys
d = sys.argv[1]
def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, data):
        c = zlib.crc32(t + data) & 0xffffffff
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', c)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))
open(f'{d}/color.png', 'wb').write(png(192, 192, (88, 101, 242)))
open(f'{d}/outline.png', 'wb').write(png(32, 32, (255, 255, 255)))
PYEOF

if command -v zip > /dev/null 2>&1; then
  zip -j "$OUTPUT_ZIP" "$MANIFEST_DIR/manifest.json" "$MANIFEST_DIR/color.png" "$MANIFEST_DIR/outline.png"
else
  python3 - "$MANIFEST_DIR" "$OUTPUT_ZIP" << 'PYEOF'
import sys, zipfile, os
d, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w') as z:
    for name in ('manifest.json', 'color.png', 'outline.png'):
        z.write(os.path.join(d, name), name)
PYEOF
fi

echo "Manifest ZIP: $OUTPUT_ZIP"
echo "Upload to Teams Admin Center > Manage apps > Upload an app"
