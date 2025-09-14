param(
  [string]$AvdName = "CNM_API34_CAM",
  [string]$DevHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

# Resolve repo root from this script location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'

Write-Host "Starting/readying emulator '$AvdName'..." -ForegroundColor Cyan
& (Join-Path $scriptDir 'Start-MycoCamAvd.ps1') -AvdName $AvdName

# Wire ports + camera permission + WebView flags
& $adb reverse tcp:5173 tcp:5173 2>$null | Out-Null
& $adb reverse tcp:1420 tcp:1420 2>$null | Out-Null
& $adb shell pm grant com.chaoticneutral.myco android.permission.CAMERA 2>$null | Out-Null
& $adb shell 'echo "--disable-vulkan --disable-gpu-rasterization --ignore-gpu-blocklist" > /data/local/tmp/webview-command-line' 2>$null | Out-Null

# Run tauri dev
Push-Location $repoRoot
try {
  npx tauri android dev --host $DevHost
} finally {
  Pop-Location
}
