# dev.ps1 — one-command Android dev (phone / emulator / auto)
param(
  [ValidateSet('auto','phone','emulator')]
  [string]$device = 'auto'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# --- Env for Vite / Tauri -----------------------------------------------------
if (-not $env:VITE_PORT)      { $env:VITE_PORT = '5173' }           # default Vite port
if (-not $env:TAURI_DEV_HOST) { $env:TAURI_DEV_HOST = '127.0.0.1' } # USB-first
try { $vitePort = [uint16]$env:VITE_PORT } catch { $vitePort = 5173; $env:VITE_PORT = '5173' }
$env:TAURI_DEV_URL = "http://localhost:$($env:VITE_PORT)/"

# --- Android SDK / ADB --------------------------------------------------------
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }

$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) { throw "adb not found at: $adb  (Install Android Studio or platform-tools)" }

# --- Helpers ------------------------------------------------------------------
function Get-PhoneSerial {
  & $adb devices |
    Select-String 'device$' |
    Where-Object { $_ -notmatch '^emulator-' } |
    ForEach-Object { ($_ -split '\s+')[0] } |
    Select-Object -First 1
}
function Get-Emulators {
  & $adb devices |
    Select-String 'device$' |
    Where-Object { $_ -match '^emulator-' } |
    ForEach-Object { ($_ -split '\s+')[0] }
}
function Stop-AllEmulators {
  $emus = Get-Emulators
  foreach ($e in $emus) { try { & $adb @('-s', $e, 'emu', 'kill') 2>$null } catch {} }
  # wait until emulators are gone
  for ($i=0; $i -lt 30; $i++) {
    if ((Get-Emulators).Count -eq 0) { break }
    Start-Sleep -Milliseconds 300
  }
}

# --- Choose device ------------------------------------------------------------
$serial = $null
switch ($device) {
  'phone'    { $serial = Get-PhoneSerial }
  'emulator' { $serial = (Get-Emulators | Select-Object -First 1) }
  default    {
    $serial = Get-PhoneSerial
    if (-not $serial) { $serial = (Get-Emulators | Select-Object -First 1) }
  }
}
if (-not $serial) { throw "No Android device found. Plug in a phone (USB debugging) or start an emulator." }

# If user chose phone, make sure no emulator steals focus
if ($device -eq 'phone') { Stop-AllEmulators }

$env:ANDROID_SERIAL = $serial
Write-Host "Using device: $serial" -ForegroundColor Cyan

# --- ADB reverse tunnels ------------------------------------------------------
try { & $adb @('-s', $serial, 'reverse', '--remove-all') 2>$null } catch {}
& $adb @('-s', $serial, 'reverse', "tcp:$vitePort", "tcp:$vitePort") | Out-Null
& $adb @('-s', $serial, 'reverse', 'tcp:1420', 'tcp:1420') | Out-Null
& $adb @('-s', $serial, 'reverse', '--list')

# --- Free the Vite port if something is listening ----------------------------
$owners = Get-NetTCPConnection -State Listen -LocalPort $vitePort -ErrorAction SilentlyContinue |
          Select-Object -ExpandProperty OwningProcess -Unique
if ($owners) {
  Write-Host "Port $vitePort busy (PID(s): $($owners -join ', ')). Terminating..." -ForegroundColor Yellow
  foreach ($proc in $owners) { try { Stop-Process -Id $proc -Force } catch {} }
}

# --- Launch tauri (let ANDROID_SERIAL pick the target) ------------------------
# IMPORTANT: do NOT pass --device/--emulator here; they get forwarded into cargo build.
Write-Host "Starting: cargo tauri android dev" -ForegroundColor Green
cargo tauri android dev
