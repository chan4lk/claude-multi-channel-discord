<#
.SYNOPSIS
  Run the MCD server in the foreground on native Windows (headless backend).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bin\Start-Mcd.ps1
#>
param(
  [string]$StateDir = (Join-Path $HOME '.claude\channels\discord-multi')
)

$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $PSScriptRoot
# Pick up bun/git installed after this shell started.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Test-Path (Join-Path $StateDir '.env'))) {
  throw "$StateDir has no .env - run bin\Setup-McdWindows.ps1 first"
}

$env:MCD_CHANNELS_DIR = $StateDir
Set-Location $RepoDir
& bun install --no-summary
& bun server.ts
