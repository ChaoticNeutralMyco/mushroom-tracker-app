<#  Build Android APK and copy to .\release\android
    - Bootstraps Capacitor if missing (uses JSON config; no TS required).
    - Converts/remove capacitor.config.ts if TypeScript isn’t installed.
    - Adds android platform (no --yes), builds web, syncs, assembles Release (fallback Debug).
    - Copies APK to .\release\android\mushroom-tracker.apk
    - Optionally installs to a device/emulator and grants CAMERA.
    Safe to re-run.
#>

param(
  [string]$PackageId = "com.chaoticneutral.myco",
  [switch]$InstallAfterBuild = $true
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) { try { $global:PSStyle.OutputRendering = "PlainText" } catch {} }

# ---- Android SDK prelude (idempotent)
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path $sdk)) { $sdk = $env:ANDROID_SDK_ROOT }
$adb = if ($sdk) { Join-Path $sdk "platform-tools\adb.exe" } else { "adb" }
$emu = if ($sdk) { Join-Path $sdk "emulator\emulator.exe" } else { "emulator" }
if (-not (Get-Command $adb -ErrorAction SilentlyContinue)) {
  Write-Host "ADB not found. Please install Android SDK Platform Tools." -ForegroundColor Red
  exit 1
}

# ---- Project root
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Ensure-NpmPackage {
  param([string]$pkg, [string]$flags = "")
  $ok = $false
  try { $null = npm ls $pkg --depth=0 2>$null; $ok = $LASTEXITCODE -eq 0 } catch {}
  if (-not $ok) {
    Write-Host "Installing $pkg ..." -ForegroundColor Yellow
    if ($flags) { npm i $pkg $flags | Out-Host } else { npm i $pkg | Out-Host }
  }
}

# ---- Ensure Capacitor deps
Ensure-NpmPackage "@capacitor/core@latest"
Ensure-NpmPackage "@capacitor/cli@latest" "-D"
Ensure-NpmPackage "@capacitor/android@latest" "-D"

# ---- Prefer JSON config to avoid TS requirement
$cfgJson = Join-Path $root "capacitor.config.json"
$cfgTs   = Join-Path $root "capacitor.config.ts"

$hasTsConfig = Test-Path $cfgTs
$hasTsPkg = $false
try { $null = npm ls typescript --depth=0 2>$null; $hasTsPkg = $LASTEXITCODE -eq 0 } catch {}

if ($hasTsConfig -and -not $hasTsPkg) {
  Write-Host "TypeScript config detected but 'typescript' is not installed; switching to JSON config..." -ForegroundColor Yellow
  try { Remove-Item $cfgTs -Force } catch {}
}

if (-not (Test-Path $cfgJson)) {
  Write-Host "Creating capacitor.config.json ..." -ForegroundColor Yellow
@"
{
  "appId": "$PackageId",
  "appName": "Mushroom Tracker",
  "webDir": "dist",
  "bundledWebRuntime": false,
  "server": { "androidScheme": "https", "allowNavigation": ["*"] }
}
"@ | Set-Content -Encoding UTF8 $cfgJson
}

# ---- Add android platform if missing
$androidDir = $null
foreach ($d in @("android","android-app")) {
  $g1 = Join-Path $d "app\build.gradle"
  $g2 = Join-Path $d "app\build.gradle.kts"
  if ( (Test-Path $g1) -or (Test-Path $g2) ) { $androidDir = $d; break }
}
if (-not $androidDir) {
  Write-Host "`n==> Adding Capacitor Android platform..." -ForegroundColor Cyan
  $addOk = $true
  try {
    # No --yes (older/newer CLIs don’t support it); JSON config prevents prompts.
    npx cap add android | Out-Host
  } catch {
    $addOk = $false
  }
  if (-not $addOk) {
    Write-Host "cap add android failed, attempting init+add..." -ForegroundColor Yellow
    npx cap init "Mushroom Tracker" "$PackageId" --web-dir dist --npm-client npm | Out-Host
    npx cap add android | Out-Host
  }
  # Recheck
  foreach ($d in @("android","android-app")) {
    $g1 = Join-Path $d "app\build.gradle"
    $g2 = Join-Path $d "app\build.gradle.kts"
    if ( (Test-Path $g1) -or (Test-Path $g2) ) { $androidDir = $d; break }
  }
  if (-not $androidDir) {
    Write-Host "Failed to create the Android project (android/). See logs above." -ForegroundColor Red
    exit 1
  }
}

# ---- Build web & sync
Write-Host "`n==> Building Vite web bundle..." -ForegroundColor Cyan
npm ci --no-audit | Out-Host
npm run build | Out-Host

Write-Host "`n==> Syncing web bundle to Android project..." -ForegroundColor Cyan
npx cap sync android | Out-Host

# ---- Add CAMERA permission (idempotent)
$manifest = Join-Path $root "android\app\src\main\AndroidManifest.xml"
if (Test-Path $manifest) {
  $xml = Get-Content $manifest -Raw
  if ($xml -notmatch 'android\.permission\.CAMERA') {
    Write-Host "Adding CAMERA permission to AndroidManifest.xml ..." -ForegroundColor Yellow
    $xml = $xml -replace '(<application\b)', "<uses-permission android:name=`"android.permission.CAMERA`" />`r`n`$1"
    Set-Content -Encoding UTF8 $manifest $xml
  }
}

# ---- Build APK
if (-not (Test-Path "android")) {
  Write-Host "Android project folder missing after sync. Aborting." -ForegroundColor Red
  exit 1
}

Push-Location "android"
$gradlew = if (Test-Path ".\gradlew.bat") { ".\gradlew.bat" } else { ".\gradlew" }

Write-Host "`n==> Cleaning project..." -ForegroundColor Cyan
& $gradlew clean | Out-Host

Write-Host "`n==> Building APK (release preferred)..." -ForegroundColor Cyan
$builtRelease = $true
try { & $gradlew :app:assembleRelease | Out-Host } catch { $builtRelease = $false }

# Pick release APK if exists
$apkRelease = $null
try {
  $apkRelease = Get-ChildItem "app\build\outputs\apk\release" -Recurse -Include *-release.apk,app-release.apk -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
} catch {}

if (-not $apkRelease) { $builtRelease = $false }

if (-not $builtRelease) {
  Write-Host "Release APK not found or unsigned; building Debug instead..." -ForegroundColor Yellow
  & $gradlew :app:assembleDebug | Out-Host
}

# Choose final APK
$apk = $apkRelease
if (-not $apk) {
  $apk = Get-ChildItem "app\build\outputs\apk\debug" -Recurse -Include *-debug.apk,app-debug.apk -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

Pop-Location

if (-not $apk) {
  Write-Host "No APK produced. Check Gradle errors above." -ForegroundColor Red
  exit 1
}

# ---- Copy near repo root
$releaseOut = Join-Path $root "release\android"
New-Item -ItemType Directory -Force -Path $releaseOut | Out-Null
$dest = Join-Path $releaseOut "mushroom-tracker.apk"
Copy-Item $apk.FullName -Destination $dest -Force

Write-Host "`n==> Android artifact copied to: $dest" -ForegroundColor Green

# ---- Optional install to device/emulator
if ($InstallAfterBuild) {
  Write-Host "`n==> Checking devices..." -ForegroundColor Cyan
  & $adb kill-server | Out-Null
  & $adb start-server | Out-Null
  & $adb devices

  & $adb reverse tcp:5173 tcp:5173 2>$null
  & $adb reverse tcp:1420 tcp:1420 2>$null

  Write-Host "`n==> Installing APK..." -ForegroundColor Cyan
  & $adb install -r "$dest" | Out-Host

  Write-Host "==> Granting CAMERA permission (if declared)..." -ForegroundColor Cyan
  & $adb shell pm grant $PackageId android.permission.CAMERA 2>$null

  Write-Host "==> Launching app (best-effort)..." -ForegroundColor Cyan
  & $adb shell monkey -p $PackageId -c android.intent.category.LAUNCHER 1 2>$null
}
