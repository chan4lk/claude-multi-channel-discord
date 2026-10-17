# Install-McdService.ps1
# Run multi-channel-discord in the background on native Windows as a
# scheduled task: starts at logon, runs as the current user, hidden, never
# times out, and restarts after a crash. Output goes to <StateDir>\mcd.log.
#
# It runs as YOU (not LocalSystem) on purpose: the claude login lives in
# your profile (~\.claude), as do bun and the desktop app's bundled CLI.
# No elevation is needed.
#
#   powershell -ExecutionPolicy Bypass -File bin\Install-McdService.ps1
#   powershell -ExecutionPolicy Bypass -File bin\Install-McdService.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File bin\Install-McdService.ps1 -Uninstall
#
# Use -Stop rather than Stop-ScheduledTask: the latter only ends the
# PowerShell wrapper and leaves bun + its claude children running (the
# next start cleans them up, but they keep answering until then).
#
# Prereqs: bin\Setup-McdWindows.ps1 has written <StateDir>\.env, and
# `claude auth login` has been done once.

param(
    [string]$RepoDir = (Split-Path -Parent $PSScriptRoot),
    [string]$StateDir = (Join-Path $HOME '.claude\channels\discord-multi'),
    [string]$TaskName = 'multi-channel-discord',
    [switch]$Stop,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$startScript = Join-Path $RepoDir 'bin\Start-Mcd.ps1'

if ($Stop -or $Uninstall) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    # Kill the recorded server's process tree (bun + claude children).
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript -StateDir $StateDir -Stop
    if ($Uninstall -and $task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task: $TaskName"
    } elseif ($Stop) {
        Write-Host "Stopped $TaskName"
    }
    exit 0
}

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'bun not found on PATH (winget install Oven-sh.Bun)' }
if (-not (Test-Path (Join-Path $RepoDir 'server.ts'))) { throw "Repo not found at $RepoDir" }
if (-not (Test-Path (Join-Path $StateDir '.env'))) { throw "$StateDir has no .env - run bin\Setup-McdWindows.ps1 first" }

$logFile = Join-Path $StateDir 'mcd.log'

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -StateDir `"$StateDir`" -LogFile `"$logFile`"" `
    -WorkingDirectory $RepoDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

# ExecutionTimeLimit 0 = no limit (the default would kill the bot after 72h).
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'multi-channel-discord (MCD) bot, headless backend' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName (runs at logon as $env:USERNAME)"
Write-Host "Start now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Stop:       powershell -ExecutionPolicy Bypass -File bin\Install-McdService.ps1 -Stop"
Write-Host "Logs:       Get-Content '$logFile' -Wait -Tail 50"
Write-Host "Remove:     powershell -ExecutionPolicy Bypass -File bin\Install-McdService.ps1 -Uninstall"
