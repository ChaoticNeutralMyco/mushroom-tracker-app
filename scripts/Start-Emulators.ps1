# scripts/Start-Emulators.ps1
# Starts Firestore/Storage emulators with persisted data and (optionally) your Android AVD.
# Safe to re-run.

# Re-derive Android SDK tools
$sdk = "$env:LOCALAPPDATA\Android\Sdk"; if (-not (Test-Path $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emu = Join-Path $sdk "emulator\emulator.exe"

# Kill stale adb/emulators (safe if not running)
if (Test-Path $adb) { & $adb kill-server *>$null }
Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue | Stop-Process -Force

# Start adb, ensure device (optional), reverse ports, grant camera (safe no-ops)
if (Test-Path $adb) {
  & $adb start-server *>$null
  $hasDevice = (& $adb devices) -match 'device$'
  if (-not $hasDevice -and (Test-Path $emu)) {
    Start-Process -FilePath $emu -ArgumentList @(
      "-avd","CNM_API34_CAM",
      "-gpu","swiftshader_indirect",
      "-camera-back","virtualscene",
      "-no-snapshot-load","-no-snapshot-save"
    ) | Out-Null
    & $adb wait-for-any-device 2>$null
  }
  & $adb reverse tcp:5173 tcp:5173 2>$null
  & $adb reverse tcp:1420 tcp:1420 2>$null
  & $adb shell pm grant com.chaoticneutral.myco android.permission.CAMERA 2>$null
}

# Ensure Firebase CLI (npx fallback ok)
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  npx --yes firebase-tools --version | Out-Null
}

# Ensure Java for Storage emulator; install Temurin 17 JRE if missing (idempotent)
$javaOk = $false
try { $jout = & java -version 2>&1; if ($LASTEXITCODE -eq 0 -or $jout) { $javaOk = $true } } catch {}
if (-not $javaOk -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  winget install --id EclipseAdoptium.Temurin.17.JRE -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  $possible = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'jre-17' } | Select-Object -First 1
  if ($possible) {
    $env:JAVA_HOME = $possible.FullName
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"
    try { $jout = & java -version 2>&1; if ($LASTEXITCODE -eq 0 -or $jout) { $javaOk = $true } } catch {}
  }
}

# Emulator data dir (persist)
$dataDir = ".firebase_emulators"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

# Auth is optional for now; pass your real project to enable Emulator UI
$project = "chaotic-neutral-tracker"
$only = if ($javaOk) { "firestore,storage" } else { "firestore" }
if (-not $javaOk) { Write-Host "Java missing: starting Firestore emulator only." -ForegroundColor Yellow }

# Start emulators with UI & persisted state
npx firebase emulators:start `
  --project $project `
  --only $only `
  --import $dataDir `
  --export-on-exit $dataDir
