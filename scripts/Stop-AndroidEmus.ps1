<#  Stop-AndroidEmus.ps1
    Cleanly shuts down all running Android emulators and kills adb.

    Usage:
      .\scripts\Stop-AndroidEmus.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'

# Try graceful kill for each running emulator
$sdk = $env:LOCALAPPDATA + '\Android\Sdk'
if (-not (Test-Path $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
$adb = Join-Path $sdk 'platform-tools\adb.exe'

if (Test-Path $adb) {
  $ids = & $adb devices | Select-String '^emulator-\d+\s+device' | ForEach-Object {
    ($_ -split '\s+')[0]
  }
  foreach ($id in $ids) {
    & $adb -s $id emu kill
  }
  Start-Sleep 1
  & $adb kill-server
}

# Fallback: force kill qemu and emulator GUI
taskkill /IM qemu-system-*.exe /F 2>$null | Out-Null
taskkill /IM emulator.exe /F 2>$null | Out-Null

Write-Host "✅ Emulators and adb stopped." -ForegroundColor Green
