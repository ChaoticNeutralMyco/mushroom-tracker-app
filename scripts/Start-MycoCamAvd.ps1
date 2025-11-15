<#! Start-MycoCamAvd.ps1 — reliable boot + clean serial #>
[CmdletBinding()]
param(
  [string]$AvdName = 'CNM_API34_CAM',
  [int]$BootTimeoutSec = 300
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Quiet($exe, $args) { & cmd.exe /c "`"$exe`" $args 1>nul 2>nul" }

$sdk = "$env:LOCALAPPDATA\Android\Sdk"; if (-not (Test-Path $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emu = Join-Path $sdk 'emulator\emulator.exe'

# Use writable emulator home; clear stale lock
$env:ANDROID_EMULATOR_HOME = Join-Path $env:LOCALAPPDATA 'Android\EmuHome'
if (-not (Test-Path $env:ANDROID_EMULATOR_HOME)) { New-Item -ItemType Directory -Force -Path $env:ANDROID_EMULATOR_HOME | Out-Null }
$env:ANDROID_AVD_HOME = Join-Path $env:USERPROFILE '.android\avd'
$oldHome = Join-Path $env:USERPROFILE '.android'
$lock1 = Join-Path $oldHome 'emu-last-feature-flags.protobuf.lock'
if (Test-Path $lock1) { Remove-Item -LiteralPath $lock1 -Force -ErrorAction SilentlyContinue }

# Clean processes + ADB
Get-Process -Name 'emulator64-*','qemu-system-*','emulator' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Quiet $adb 'kill-server'
Quiet $adb 'start-server'

# Start emulator with stable flags
$emuArgs = @('-avd','CNM_API34_CAM','-gpu','swiftshader_indirect','-camera-back','virtualscene','-no-boot-anim','-no-snapshot-load','-no-snapshot-save')
Start-Process -FilePath $emu -ArgumentList $emuArgs -WindowStyle Minimized | Out-Null

# Wait for device + boot
$deadline = (Get-Date).AddSeconds($BootTimeoutSec)
$serial = $null
do {
  Start-Sleep -Seconds 2
  $lines = & $adb devices 2>$null
  $serial = ($lines | Select-String 'emulator-\d+\s+device' | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
} until ($serial -or (Get-Date) -gt $deadline)
if (-not $serial) { throw "Emulator didn't appear within $BootTimeoutSec sec." }

do {
  $boot = (& $adb -s $serial shell getprop sys.boot_completed 2>$null)
  if ($boot -match '1') { break }
  Start-Sleep -Seconds 2
} until ((Get-Date) -gt $deadline)

# Wake and set up (silence ALL streams so nothing prints)
& $adb -s $serial shell input keyevent 82 *> $null
& $adb -s $serial reverse tcp:5173 tcp:5173  *> $null
& $adb -s $serial reverse tcp:1420 tcp:1420  *> $null
& $adb -s $serial shell pm grant com.chaoticneutral.myco android.permission.CAMERA *> $null

# Print JUST the serial
Write-Output $serial
