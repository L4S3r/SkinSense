# =====================================================
# Meloniq — booth connect helper
# Sets up `adb reverse` so the phone's localhost:3000 tunnels to this
# laptop's server, satisfying the browser's secure-origin requirement
# for camera access. Optionally starts the server too.
#
# Usage:
#   .\booth-connect.ps1              # set up the reverse forward
#   .\booth-connect.ps1 -Serve      # also start `npm start` afterwards
#   .\booth-connect.ps1 -Port 3000  # override the port (default 3000)
#
# Prereq: phone already paired + connected via wireless debugging
#   adb pair <ip>:<pair-port>
#   adb connect <ip>:<debug-port>
# =====================================================

param(
    [int]$Port = 3000,
    [switch]$Serve
)

$ErrorActionPreference = "Stop"

# --- Verify adb is available ---
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    Write-Host "adb not found on PATH. Install Android platform-tools first." -ForegroundColor Red
    exit 1
}

# --- Find a connected, ready device ---
# `adb devices` lists one line per target: "<serial>\tdevice". We want the
# entries whose state is exactly "device" (not "offline"/"unauthorized").
# The phone can register twice (adb-connect session + mDNS/TLS entry); we
# prefer the ip:port session because reverse forwarding is reliable there.
$lines = adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
$serials = $lines | ForEach-Object { ($_ -split "\t")[0] }

if (-not $serials -or $serials.Count -eq 0) {
    Write-Host "No ready device found. Pair + connect first:" -ForegroundColor Red
    Write-Host "  adb pair <ip>:<pair-port>" -ForegroundColor Yellow
    Write-Host "  adb connect <ip>:<debug-port>" -ForegroundColor Yellow
    exit 1
}

# Prefer an ip:port serial (the `adb connect` session) over the mDNS entry.
$serial = $serials | Where-Object { $_ -match "^\d{1,3}(\.\d{1,3}){3}:\d+$" } | Select-Object -First 1
if (-not $serial) { $serial = $serials | Select-Object -First 1 }

Write-Host "Using device: $serial" -ForegroundColor Cyan

# --- Set up the reverse forward ---
adb -s $serial reverse tcp:$Port tcp:$Port
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to set up reverse forward." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Reverse forward active: phone localhost:$Port -> laptop localhost:$Port" -ForegroundColor Green
Write-Host "On the phone's browser, open:  http://localhost:$Port" -ForegroundColor Green
Write-Host "(Use localhost, NOT the LAN IP, so the camera is allowed.)" -ForegroundColor DarkGray
Write-Host ""

# --- Optionally start the server ---
if ($Serve) {
    Write-Host "Starting server (Ctrl+C to stop)..." -ForegroundColor Cyan
    npm start
}
