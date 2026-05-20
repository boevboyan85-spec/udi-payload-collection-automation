# Install Chrome, Edge, and Firefox on Windows via winget (optional; idempotent).
# Requires winget. Run: powershell -ExecutionPolicy Bypass -File scripts/install-os-browsers-windows.ps1
$ErrorActionPreference = "Continue"

function Install-WingetApp {
    param([string]$Id, [string]$Label)
    $installed = winget list --id $Id -e 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "${Label}: already installed ($Id)"
        return
    }
    Write-Host "${Label}: installing via winget ($Id) …"
    winget install --id $Id -e --accept-package-agreements --accept-source-agreements
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Warning "winget not found. Install Chrome, Edge, and Firefox manually, or set CHROME_BIN / EDGE_BIN / FIREFOX_BIN in .env"
    exit 0
}

Install-WingetApp "Google.Chrome" "Google Chrome"
Install-WingetApp "Microsoft.Edge" "Microsoft Edge"
Install-WingetApp "Mozilla.Firefox" "Mozilla Firefox"

Write-Host ""
Write-Host "Verify:"
Get-Command chrome, msedge, firefox -ErrorAction SilentlyContinue | Format-Table Name, Source
