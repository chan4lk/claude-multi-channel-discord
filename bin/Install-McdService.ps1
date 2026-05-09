# Install-McdService.ps1
# Install multi-channel-discord as a Windows scheduled task that runs at logon
# and restarts on crash. Requires `bun` on PATH (https://bun.sh/install).
#
# Run from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File bin/Install-McdService.ps1
#
# Note: tmux on Windows works only inside WSL or MSYS. On native Windows,
# the per-project Claude subprocesses won't have a PTY — phase 5+ assumes
# tmux. If you must run native, install WSL2 + Ubuntu and run server.ts
# under that environment instead. This script is a starting point for
# operators who want a Windows-managed launcher anyway.

param(
    [string]$RepoDir = "$HOME\dev\multi-channel-discord",
    [string]$StateDir = "$HOME\.claude\channels\discord-multi",
    [string]$BunPath = "$HOME\.bun\bin\bun.exe",
    [string]$TaskName = "multi-channel-discord"
)

if (-not (Test-Path $BunPath)) {
    Write-Error "Bun not found at $BunPath. Install Bun and pass -BunPath if elsewhere."
    exit 1
}
if (-not (Test-Path "$RepoDir\server.ts")) {
    Write-Error "Repo not found at $RepoDir."
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute $BunPath `
    -Argument "$RepoDir\server.ts" `
    -WorkingDirectory $RepoDir

$trigger = New-ScheduledTaskTrigger -AtLogon

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

# Pass MCD_CHANNELS_DIR via the user environment. Adjust if you need it
# scoped narrower (a wrapper batch file is the safer route for secrets).
[Environment]::SetEnvironmentVariable("MCD_CHANNELS_DIR", $StateDir, "User")

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Start it now with:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "View logs in Task Scheduler or by running it in the foreground:"
Write-Host "  & '$BunPath' '$RepoDir\server.ts'"
