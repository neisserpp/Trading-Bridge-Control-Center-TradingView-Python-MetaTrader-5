$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# ============================================================
# CONFIGURACIÓN
# ============================================================

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$Bridge = Join-Path $PSScriptRoot "bridge.py"
$Requirements = Join-Path $PSScriptRoot "requirements.txt"

$Cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$BridgeUrl = "http://127.0.0.1:5000"

# ============================================================
# PYTHON / VENV
# ============================================================

if (-not (Test-Path $Python)) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
    py -m venv .venv
}

Write-Host "Installing/updating bridge dependencies..." -ForegroundColor Cyan
& $Python -m pip install -r $Requirements

# ============================================================
# START BRIDGE
# ============================================================

Write-Host ""
Write-Host "Starting TradingView -> MT5 bridge..." -ForegroundColor Green

$BridgeProcess = Start-Process `
    -FilePath $Python `
    -ArgumentList "`"$Bridge`"" `
    -WorkingDirectory $PSScriptRoot `
    -PassThru

# ============================================================
# WAIT FOR BRIDGE
# ============================================================

Write-Host "Waiting for bridge on $BridgeUrl ..." -ForegroundColor Yellow

$BridgeReady = $false

for ($i = 0; $i -lt 30; $i++) {

    Start-Sleep -Seconds 1

    try {
        $Health = Invoke-RestMethod "$BridgeUrl/health" -TimeoutSec 2

        if ($Health.ok -eq $true) {
            $BridgeReady = $true
            break
        }
    }
    catch {
        # Bridge todavía arrancando
    }
}

if (-not $BridgeReady) {
    Write-Host ""
    Write-Host "ERROR: Bridge did not start correctly." -ForegroundColor Red

    if (-not $BridgeProcess.HasExited) {
        Stop-Process -Id $BridgeProcess.Id -Force
    }

    exit 1
}

Write-Host "Bridge is ONLINE." -ForegroundColor Green

# ============================================================
# CLOUDFLARED
# ============================================================

if (-not (Test-Path $Cloudflared)) {
    Write-Host ""
    Write-Host "ERROR: cloudflared.exe not found:" -ForegroundColor Red
    Write-Host $Cloudflared -ForegroundColor Red

    exit 1
}

Write-Host ""
Write-Host "Starting Cloudflare Quick Tunnel..." -ForegroundColor Cyan
Write-Host ""

# ============================================================
# START CLOUDFLARED
# ============================================================

& $Cloudflared tunnel --url $BridgeUrl