<#
.SYNOPSIS
  Bootstrap a fresh MCD state dir on native Windows (PowerShell 5.1+).

.DESCRIPTION
  Windows counterpart of bin/setup-new-instance.sh. Prompts for the Discord
  bot token (hidden input, never on argv), your Discord user id and the
  master channel id, then writes .env, access.json, channels.json and the
  master CLAUDE.md under the state dir, restricted to the current user.

  Prereqs (Discord Developer Portal):
    1. New application -> Bot tab: enable "Message Content Intent", Reset Token, copy it.
    2. OAuth2 -> URL Generator: scope "bot"; permissions View Channels, Send Messages,
       Send Messages in Threads, Read Message History, Add Reactions, Manage Channels.
       Open the URL and invite the bot to your server.
    3. Discord Developer Mode on: right-click yourself -> Copy User ID,
       right-click the master channel -> Copy Channel ID.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bin\Setup-McdWindows.ps1
#>
param(
  [string]$StateDir = (Join-Path $HOME '.claude\channels\discord-multi'),
  [string]$Slug = 'master'
)

$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $PSScriptRoot
# Pick up bun/git installed after this shell started.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'bun not found on PATH (winget install Oven-sh.Bun)' }

if ((Test-Path $StateDir) -and (Get-ChildItem -Force $StateDir | Select-Object -First 1)) {
  throw "refusing to overwrite non-empty $StateDir - delete it first if you really mean to start fresh"
}

$UserId = (Read-Host 'Your Discord user ID').Trim()
$Master = (Read-Host 'Master channel ID').Trim()
if ($UserId -notmatch '^\d{15,22}$') { throw "user ID '$UserId' doesn't look like a Discord snowflake" }
if ($Master -notmatch '^\d{15,22}$') { throw "channel ID '$Master' doesn't look like a Discord snowflake" }
$secure = Read-Host 'Discord bot token (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $Token) { throw 'empty token' }

New-Item -ItemType Directory -Force $StateDir | Out-Null
# chmod 700 equivalent: drop inherited ACEs, grant only the current user.
& icacls $StateDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null

Write-Utf8NoBom (Join-Path $StateDir '.env') "DISCORD_BOT_TOKEN=$Token`n"
$Token = $null

$access = @"
{
  "dmPolicy": "allowlist",
  "allowFrom": ["$UserId"],
  "groups": {
    "$Master": {
      "requireMention": false,
      "allowFrom": []
    }
  },
  "pending": {}
}
"@
Write-Utf8NoBom (Join-Path $StateDir 'access.json') ($access -replace "`r`n", "`n")

$env:MCD_CHANNELS_DIR = $StateDir
& bun (Join-Path $RepoDir 'src\init.ts') --master $Master --slug $Slug --prompt 'You are the master controller for the multi-channel-discord bot. Be terse.'
if ($LASTEXITCODE -ne 0) { throw "init.ts failed ($LASTEXITCODE)" }

$template = Join-Path $RepoDir 'templates\master.CLAUDE.md'
if (Test-Path $template) {
  Copy-Item $template (Join-Path $StateDir "projects\$Slug\CLAUDE.md") -Force
  Write-Host 'deployed master CLAUDE.md template'
}

Write-Host ''
Write-Host "Setup complete in: $StateDir" -ForegroundColor Green
Write-Host 'Make sure the claude CLI is logged in (claude auth login), then start the bot with:'
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$RepoDir\bin\Start-Mcd.ps1`""
