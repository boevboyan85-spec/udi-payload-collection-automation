# Run full Windows collection matrix: 4 tools × Chrome, Edge, Firefox, Brave × headless/headed (when BOTS_COLLECT_DUAL=true).
# Usage (PowerShell): .\run-windows.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example"
}

$env:BOTS_PLATFORM = "win32"
if (-not $env:BOTS_COLLECT_DUAL) { $env:BOTS_COLLECT_DUAL = "true" }

npm run collect
