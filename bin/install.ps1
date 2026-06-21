#Requires -Version 7.0
<#
.SYNOPSIS
  One-liner installer for multi-channel-discord (MCD) on Windows.

.DESCRIPTION
  Installs bun and git via winget (if not present), clones or updates the
  MCD repo, runs the setup wizard via Git Bash (if not already configured),
  and registers a Windows service via sc.exe (or NSSM if available).

.EXAMPLE
  irm https://raw.githubusercontent.com/chan4lk/claude-multi-channel-discord/main/bin/install.ps1 | iex

.NOTES
  Requires PowerShell 7+, Windows 11. Run as the user who will own the service.
  For service registration, the script attempts sc.exe first; falls back to NSSM
  if the NSSM binary is found on PATH or in $env:NSSM_PATH.
#>

$ErrorActionPreference = 'Stop'

$REPO_URL  = 'https://github.com/chan4lk/claude-multi-channel-discord'
$INSTALL_DIR = if ($env:MCD_INSTALL_DIR) { $env:MCD_INSTALL_DIR } else { Join-Path $HOME 'multi-channel-discord' }
$STATE_DIR   = if ($env:MCD_STATE_DIR)   { $env:MCD_STATE_DIR   } else { Join-Path $HOME '.claude\channels\discord-multi' }
$SERVICE_NAME = 'mcd'

function Write-Info  { param([string]$Msg) Write-Host "[mcd-install] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[mcd-install] $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "[mcd-install] $Msg" -ForegroundColor Red; exit 1 }

function Have-Command { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# ---------------------------------------------------------------------------
# 1. Require PowerShell 7+
# ---------------------------------------------------------------------------
if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Err "PowerShell 7+ is required. Download from https://aka.ms/pscore6"
}

Write-Info "Running on PowerShell $($PSVersionTable.PSVersion)"

# ---------------------------------------------------------------------------
# 2. Install bun via winget if missing
# ---------------------------------------------------------------------------
if (Have-Command 'bun') {
  Write-Info "bun already installed"
} else {
  Write-Info "Installing bun via winget..."
  winget install --id Oven-sh.Bun --exact --accept-source-agreements --accept-package-agreements
  # Refresh PATH
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Have-Command 'bun')) {
    Write-Warn "bun not found on PATH after install. You may need to restart your shell."
  }
}

# ---------------------------------------------------------------------------
# 3. Install git via winget if missing
# ---------------------------------------------------------------------------
if (Have-Command 'git') {
  Write-Info "git already installed"
} else {
  Write-Info "Installing git via winget..."
  winget install --id Git.Git --exact --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Have-Command 'git')) {
    Write-Warn "git not found on PATH after install. You may need to restart your shell."
  }
}

# ---------------------------------------------------------------------------
# 4. Clone or update repo
# ---------------------------------------------------------------------------
if (Test-Path (Join-Path $INSTALL_DIR '.git')) {
  Write-Info "Repo already cloned at $INSTALL_DIR — pulling latest..."
  & git -C $INSTALL_DIR pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Warn "git pull failed (local changes?), skipping" }
} else {
  Write-Info "Cloning $REPO_URL to $INSTALL_DIR..."
  & git clone $REPO_URL $INSTALL_DIR
  if ($LASTEXITCODE -ne 0) { Write-Err "git clone failed" }
}

Push-Location $INSTALL_DIR
& bun install --no-summary
if ($LASTEXITCODE -ne 0) { Write-Err "bun install failed" }

# ---------------------------------------------------------------------------
# 5. Run setup wizard via Git Bash if not already configured
# ---------------------------------------------------------------------------
$EnvFile = Join-Path $STATE_DIR '.env'
if (Test-Path $EnvFile) {
  Write-Info "Already configured ($EnvFile exists). Skipping setup wizard."
} else {
  $GitBash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
  if (-not (Test-Path $GitBash)) {
    $GitBash = Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'
  }

  $Token  = $env:MCD_BOT_TOKEN
  $UserId = $env:MCD_USER_ID
  $Master = $env:MCD_MASTER_CHANNEL

  if ($Token -and $UserId -and $Master) {
    if (Test-Path $GitBash) {
      Write-Info "Running setup wizard via Git Bash..."
      $SetupScript = Join-Path $INSTALL_DIR 'bin\setup-new-instance.sh'
      # Pipe token via stdin; pass other values as arguments
      $SetupCmd = "echo '$Token' | '$SetupScript' --state-dir '$STATE_DIR' --user-id '$UserId' --master '$Master' --slug master --prompt 'You are the master controller. Be terse.'"
      & $GitBash -c $SetupCmd
      if ($LASTEXITCODE -ne 0) { Write-Warn "Setup wizard exited with code $LASTEXITCODE" }
    } else {
      Write-Warn "Git Bash not found at $GitBash. Run bin\setup-new-instance.sh manually in Git Bash."
    }
  } else {
    Write-Warn "Set MCD_BOT_TOKEN, MCD_USER_ID, MCD_MASTER_CHANNEL to auto-configure."
    Write-Warn "Or run bin\setup-new-instance.sh manually in Git Bash."
  }
}

# ---------------------------------------------------------------------------
# 6. Register Windows service (idempotent)
# ---------------------------------------------------------------------------
$BunPath = (Get-Command 'bun' -ErrorAction SilentlyContinue)?.Source
if (-not $BunPath) {
  $BunPath = Join-Path $HOME '.bun\bin\bun.exe'
}

$ServiceExists = (& sc.exe query $SERVICE_NAME 2>&1) -match 'SERVICE_NAME'

if ($ServiceExists) {
  Write-Info "Windows service '$SERVICE_NAME' already registered. Skipping."
} else {
  # Try NSSM first (more robust for long-running processes)
  $NssmPath = if ($env:NSSM_PATH) { $env:NSSM_PATH } else { (Get-Command 'nssm' -ErrorAction SilentlyContinue)?.Source }

  if ($NssmPath -and (Test-Path $NssmPath)) {
    Write-Info "Registering service via NSSM..."
    & $NssmPath install $SERVICE_NAME $BunPath 'server.ts'
    & $NssmPath set $SERVICE_NAME AppDirectory $INSTALL_DIR
    & $NssmPath set $SERVICE_NAME AppEnvironmentExtra "MCD_CHANNELS_DIR=$STATE_DIR"
    & $NssmPath set $SERVICE_NAME Start SERVICE_DEMAND_START
    & $NssmPath set $SERVICE_NAME AppStdout (Join-Path $STATE_DIR 'mcd.log')
    & $NssmPath set $SERVICE_NAME AppStderr (Join-Path $STATE_DIR 'mcd-error.log')
    Write-Info "Service '$SERVICE_NAME' registered via NSSM."
  } else {
    # Fall back to sc.exe (basic, no stdout capture)
    Write-Info "Registering service via sc.exe (install NSSM for better process management)..."
    $BinPath = "`"$BunPath`" server.ts"
    & sc.exe create $SERVICE_NAME binPath= $BinPath start= demand DisplayName= "multi-channel-discord"
    & sc.exe description $SERVICE_NAME "MCD: project-aware Discord bot running isolated Claude subprocesses"
    if ($LASTEXITCODE -eq 0) {
      Write-Info "Service '$SERVICE_NAME' registered via sc.exe."
    } else {
      Write-Warn "sc.exe service registration failed (may need elevated privileges)."
      Write-Warn "Run this script as Administrator or use NSSM: https://nssm.cc/download"
    }
  }
}

Pop-Location

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "MCD installed. Run 'Start-Service mcd' to start." -ForegroundColor Green
