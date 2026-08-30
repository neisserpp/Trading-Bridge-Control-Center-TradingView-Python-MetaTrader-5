$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .\.venv\Scripts\python.exe)) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
    py -m venv .venv
}

Write-Host "Installing/updating bridge dependencies..." -ForegroundColor Cyan
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt

Write-Host "Starting TradingView -> MT5 bridge on http://127.0.0.1:5000" -ForegroundColor Green
.\.venv\Scripts\python.exe .\bridge.py
