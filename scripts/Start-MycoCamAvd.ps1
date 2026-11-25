# scripts/Start-MycoCamAvd.ps1
# Direct ADB startup sequence verified on Windows PowerShell 5.1.
[CmdletBinding()]
param(
    [string]$AvdName = 'CNM_API34_CAM',
    [ValidateRange(30, 1800)][int]$BootTimeoutSec = 300,
    [string]$StatusLog = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-LaunchStatus([string]$Message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
    Write-Host $line
    if ($StatusLog) { Add-Content -LiteralPath $StatusLog -Value $line -Encoding UTF8 }
}

# Use the direct native command path verified in Windows PowerShell 5.1.
# Normal ADB stderr must not become a terminating PowerShell error.
function Invoke-MycoAdb {
    param(
        [Parameter(Mandatory = $true)][string]$AdbPath,
        [Parameter(Mandatory = $true)][string[]]$AdbArguments
    )
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $AdbPath @AdbArguments)
        $code = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $code; Output = [string]($lines -join "`n") }
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

if ($AvdName -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid AVD name.' }
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path -LiteralPath $sdk) -and $env:ANDROID_SDK_ROOT) {
    $sdk = $env:ANDROID_SDK_ROOT
}
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emu = Join-Path $sdk 'emulator\emulator.exe'
$serial = 'emulator-5554'
foreach ($tool in @($adb, $emu)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Missing SDK tool: $tool" }
}

# Preserve the current AVD data and use the normal Android home directories.
# This is the same fresh startup used in the successful direct probe.
Write-LaunchStatus 'Closing stale emulator and ADB processes.'
Get-Process -Name 'emulator','emulator64-*','qemu-system-*','adb' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-LaunchStatus 'Starting ADB daemon.'
# Run startup directly, without capturing daemon output or inheriting redirected files.
$previousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $adb start-server | Out-Host
    $startCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousPreference
}
Write-LaunchStatus "ADB start-server exit code: $startCode."
if ($startCode -ne 0) { throw 'ADB startup failed.' }
$initial = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('devices', '-l')
Write-LaunchStatus $initial.Output
if ($initial.ExitCode -ne 0 -or $initial.Output -notmatch '(?m)^List of devices attached\s*$') {
    throw 'ADB devices response was not verified.'
}
if ($initial.Output -match '(?m)^emulator-5554\s+') {
    throw 'Port 5554 already has an emulator attached after cleanup.'
}

Write-LaunchStatus "Launching $AvdName with virtualscene and swiftshader_indirect on port 5554."
Start-Process -FilePath $emu -ArgumentList @(
    '-avd', $AvdName, '-port', '5554', '-gpu', 'swiftshader_indirect',
    '-camera-back', 'virtualscene', '-no-snapshot-load', '-no-snapshot-save', '-no-metrics'
) | Out-Null

$deadline = (Get-Date).AddSeconds($BootTimeoutSec)
$booted = $false
$attempt = 0
# ADB may report offline or return an empty boot property during initialization.
# Only a successful device response plus sys.boot_completed=1 proves boot.
do {
    $attempt++
    $devices = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('devices', '-l')
    Write-LaunchStatus "ADB check $attempt (exit $($devices.ExitCode)): $($devices.Output)"
    if ($devices.ExitCode -eq 0 -and $devices.Output -match '(?m)^emulator-5554\s+device(?:\s|$)') {
        $boot = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'shell', 'getprop', 'sys.boot_completed')
        Write-LaunchStatus "Boot property (exit $($boot.ExitCode)): $($boot.Output)"
        if ($boot.ExitCode -eq 0 -and $boot.Output -match '^\s*1\s*$') {
            $booted = $true
            break
        }
    }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
} until ((Get-Date) -ge $deadline)
if (-not $booted) { throw "Android boot was not confirmed for $serial." }
$name = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'emu', 'avd', 'name')
Write-LaunchStatus "AVD identity: $($name.Output)"
if ($name.ExitCode -ne 0 -or $name.Output -notmatch ('(?m)^' + [regex]::Escape($AvdName) + '\s*$')) {
    throw "Unexpected AVD identity for $serial."
}
Write-LaunchStatus "Android boot verified ($serial)."

# Preserve the previous launcher's wake action; no app is launched.
$wake = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'shell', 'input', 'keyevent', '82')
if ($wake.ExitCode -ne 0) { Write-Verbose 'Emulator wake command returned a nonzero exit code.' }
foreach ($port in @('5173', '1420')) {
    $reverse = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'reverse', "tcp:$port", "tcp:$port")
    if ($reverse.ExitCode -ne 0) { throw "ADB reverse failed for port $port." }
    Write-LaunchStatus "Configured reverse tcp:$port."
}
$mappings = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'reverse', '--list')
Write-LaunchStatus "Reverse mappings: $($mappings.Output)"
if ($mappings.ExitCode -ne 0 -or $mappings.Output -notmatch 'tcp:5173\s+tcp:5173' -or
    $mappings.Output -notmatch 'tcp:1420\s+tcp:1420') {
    throw 'Reverse port verification failed.'
}
$appId = 'com.chaoticneutral.myco'
$installed = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'shell', 'pm', 'path', $appId)
if ($installed.ExitCode -eq 0 -and $installed.Output -match '(?m)^package:') {
    $grant = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'shell', 'pm', 'grant', $appId, 'android.permission.CAMERA')
    if ($grant.ExitCode -ne 0) { throw 'CAMERA permission grant failed for the installed app.' }
    Write-LaunchStatus 'CAMERA permission granted to the installed app.'
} else {
    # A missing package may return code 1. Independently confirm absence.
    $packages = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $serial, 'shell', 'pm', 'list', 'packages', $appId)
    if ($packages.ExitCode -ne 0 -or $packages.Output -match '(?m)^package:com\.chaoticneutral\.myco\s*$') {
        throw 'App installation status could not be verified.'
    }
    Write-LaunchStatus 'App is not installed; no CAMERA grant attempted.'
}
Write-LaunchStatus 'Launcher completed successfully.'
# Keep the existing success-stream contract for callers.
Write-Output $serial
