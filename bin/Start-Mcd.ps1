<#
.SYNOPSIS
  Run the MCD server on native Windows (headless backend).

.DESCRIPTION
  Foreground by default. With -LogFile, output goes to that file (previous
  run rotated to .1) and stderr to <LogFile>.err (used by the scheduled task
  from Install-McdService.ps1); the server's exit code is passed through so
  the task's restart-on-failure kicks in after a crash.

  Single instance: the server's pid is kept in <StateDir>\mcd-server.pid.
  Stopping a scheduled task only ends this wrapper, leaving bun and its
  claude children running, so every start (and -Stop) first kills the
  recorded server's whole process tree.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bin\Start-Mcd.ps1
  powershell -ExecutionPolicy Bypass -File bin\Start-Mcd.ps1 -Stop
#>
param(
  [string]$StateDir = (Join-Path $HOME '.claude\channels\discord-multi'),
  [string]$LogFile,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $StateDir 'mcd-server.pid'
# Pick up bun/git installed after this shell started.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Stop-RecordedServer {
  if (-not (Test-Path $PidFile)) { return }
  $serverPid = [int](Get-Content $PidFile -Raw)
  Remove-Item $PidFile -Force
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid" -ErrorAction SilentlyContinue
  # Only kill it if the pid still belongs to a bun server (not a recycled pid).
  if ($proc -and $proc.Name -eq 'bun.exe' -and $proc.CommandLine -match 'server\.ts') {
    Write-Host "stopping previous MCD server (pid $serverPid) and its claude children"
    & taskkill.exe /pid $serverPid /T /F | Out-Null
    Start-Sleep -Seconds 1
  }
}

Stop-RecordedServer
if ($Stop) { exit 0 }

if (-not (Test-Path (Join-Path $StateDir '.env'))) {
  throw "$StateDir has no .env - run bin\Setup-McdWindows.ps1 first"
}

$env:MCD_CHANNELS_DIR = $StateDir
Set-Location $RepoDir
$bun = (Get-Command bun).Source

if ($LogFile) {
  # The server logs to stderr; its stdout is near-empty and goes to <LogFile>.out.
  $outFile = "$LogFile.out"
  foreach ($f in $LogFile, $outFile) { if (Test-Path $f) { Move-Item $f "$f.1" -Force } }
  & $bun install --no-summary *> $null
  $server = Start-Process -FilePath $bun -ArgumentList 'server.ts' -WorkingDirectory $RepoDir `
    -RedirectStandardError $LogFile -RedirectStandardOutput $outFile -WindowStyle Hidden -PassThru
} else {
  & $bun install --no-summary
  $server = Start-Process -FilePath $bun -ArgumentList 'server.ts' -WorkingDirectory $RepoDir -NoNewWindow -PassThru
}
# Touch the handle now, or ExitCode reads back empty after WaitForExit().
$null = $server.Handle

Set-Content -Path $PidFile -Value $server.Id -Encoding ascii
$server.WaitForExit()
if ((Test-Path $PidFile) -and ((Get-Content $PidFile -Raw).Trim() -eq "$($server.Id)")) { Remove-Item $PidFile -Force }
exit $server.ExitCode
