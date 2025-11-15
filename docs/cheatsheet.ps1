################################################################################
# Mushroom Tracker — Handy Commands (Windows / PowerShell)
# Save as: docs/cheatsheet.ps1  |  Run sections by copying lines you need
################################################################################

# ------------------------------------------------------------------------------
# Project Root (pick ONE)
# ------------------------------------------------------------------------------
# Option A: exact path on your machine (recommended)
cd "C:\Users\vtruj\mushroom-tracker-app"

# Option B: generic (works on any username if folder name matches)
# cd "C:\Users\$env:USERNAME\mushroom-tracker-app"

# Option C: or set it programmatically (edit folder name if yours differs)
# $projectDir = Join-Path $env:USERPROFILE "mushroom-tracker-app"; if (Test-Path $projectDir) { Set-Location $projectDir } else { Write-Host "Update `$projectDir to your repo path." -ForegroundColor Yellow }

# ------------------------------------------------------------------------------
# Local Dev (Vite @ 127.0.0.1)
# ------------------------------------------------------------------------------
# Default at root:
$env:BASE_PATH = "/"
npm run dev  # (or: npx vite --host 127.0.0.1)

# If serving under a base path locally:
# $env:BASE_PATH = "/mushroom-tracker-app/"
# npm run dev

# ------------------------------------------------------------------------------
# Playwright E2E: Install, List, Run, Open Traces
# ------------------------------------------------------------------------------
npm ci
npx playwright install --with-deps

# Single env var for tests (JSON or "email:password" string)
$env:TEST_ACCOUNT = '{"email":"e2e@mushies.local","password":"E2E_Strong!Pass123"}'

# Discover tests:
npx playwright test --list

# Local run (dev server):
$env:BASE_PATH = "/"
npx playwright test

# With base path:
# $env:BASE_PATH = "/mushroom-tracker-app/"
# npx playwright test

# CI-style run (build + preview on 127.0.0.1:4173):
# $env:CI = "1"
# $env:BASE_PATH = "/mushroom-tracker-app/"
# npx playwright test

# If any fail, open traces:
# Get-ChildItem "test-results" -Recurse -Filter trace.zip | ForEach-Object {
#   npx playwright show-trace $_.FullName
# }

# ------------------------------------------------------------------------------
# Windows Installer (Tauri → MSI) — Build Only
# Output: .\release\windows\
# ------------------------------------------------------------------------------
powershell -ExecutionPolicy Bypass -File .\scripts\Build-WindowsInstaller.ps1
# Open the folder:
ii .\release\windows\

# ------------------------------------------------------------------------------
# Android (Capacitor) — Build APK Only (no install)
# Output: .\release\android\mushroom-tracker.apk
# ------------------------------------------------------------------------------
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AndroidApk.ps1 -PackageId "com.chaoticneutral.myco" -InstallAfterBuild:$false
ii .\release\android\

# ------------------------------------------------------------------------------
# Optional: ADB / Emulator Cheats (when you’re ready to install later)
# ------------------------------------------------------------------------------
# Fresh-session Android SDK prelude (find adb/emulator):
$sdk = "$env:LOCALAPPDATA\Android\Sdk"; if (-not (Test-Path $sdk)) { $sdk = $env:ANDROID_SDK_ROOT }
$adb = if ($sdk) { Join-Path $sdk "platform-tools\adb.exe" } else { "adb" }
$emu = if ($sdk) { Join-Path $sdk "emulator\emulator.exe" } else { "emulator" }
$env:PATH = @("$sdk\platform-tools","$sdk\emulator","$sdk\cmdline-tools\latest\bin",$env:PATH) -join ';'

# Kill stale servers; show devices:
& $adb kill-server 2>$null; & $adb start-server | Out-Null; & $adb devices

# Create (once) and launch emulator "CNM_API34_CAM" with camera virtualscene:
$sdkman = if ($sdk) { Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat" } else { "sdkmanager" }
$avdman = if ($sdk) { Join-Path $sdk "cmdline-tools\latest\bin\avdmanager.bat" } else { "avdmanager" }
try { & $sdkman --install "system-images;android-34;google_apis;x86_64" "platform-tools" "platforms;android-34" | Out-Null } catch {}
$avdName="CNM_API34_CAM"; $avdHome=Join-Path $env:USERPROFILE ".android\avd"
if (-not (Test-Path (Join-Path $avdHome "$avdName.avd"))) {
  echo "no" | & $avdman create avd --force --name $avdName --package "system-images;android-34;google_apis;x86_64" --device "pixel_5"
  $config=Join-Path $avdHome "$avdName.avd\config.ini"
  if (Test-Path $config) {
    $kv=@{"hw.camera.back"="virtualscene";"hw.camera.front"="emulated";"hw.gpu.mode"="swiftshader_indirect";"hw.gpu.enabled"="yes";"skin.name"="pixel_5";"showDeviceFrame"="yes"}
    $cur=Get-Content $config
    foreach($k in $kv.Keys){ if($cur -notmatch "^$k="){Add-Content $config "$k=$($kv[$k])"} else {(Get-Content $config) -replace "^$k=.*","$k=$($kv[$k])" | Set-Content $config} }
  }
}
Start-Process -FilePath $emu -ArgumentList @("-avd",$avdName,"-gpu","swiftshader_indirect","-camera-back","virtualscene","-no-snapshot","-no-boot-anim")

# Wait for boot (up to ~3min):
& $adb wait-for-device
for ($i=0;$i -lt 180;$i++){ if ((& $adb shell getprop sys.boot_completed).Trim() -eq "1"){ break } Start-Sleep -s 1 }

# Reverse handy ports (safe anytime):
& $adb reverse tcp:5173 tcp:5173 2>$null
& $adb reverse tcp:1420 tcp:1420 2>$null

# ------------------------------------------------------------------------------
# Install APK later (device/emulator already connected)
# ------------------------------------------------------------------------------
$apk = (Get-ChildItem .\release\android -Filter *.apk | Sort-Object LastWriteTime -Desc | Select-Object -First 1).FullName
& $adb install -r "$apk"
& $adb shell pm grant com.chaoticneutral.myco android.permission.CAMERA 2>$null
& $adb shell monkey -p com.chaoticneutral.myco -c android.intent.category.LAUNCHER 1 2>$null

# ------------------------------------------------------------------------------
# Quick “latest artifact to root” (optional convenience)
# ------------------------------------------------------------------------------
# Copy latest MSI / APK to repo root as easy-to-share files:
$msi = Get-ChildItem .\release\windows -Filter *.msi -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
if ($msi) { Copy-Item $msi.FullName -Destination ".\MushroomTracker-latest.msi" -Force }
$apk = Get-ChildItem .\release\android -Filter *.apk -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
if ($apk) { Copy-Item $apk.FullName -Destination ".\MushroomTracker-latest.apk" -Force }

# ------------------------------------------------------------------------------
# Artifact listing (sanity)
# ------------------------------------------------------------------------------
Write-Host "`nArtifacts:" -ForegroundColor Cyan
Get-ChildItem .\release -Recurse -File | Select-Object FullName, Length | Format-Table -AutoSize
