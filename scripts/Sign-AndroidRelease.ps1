<# Signs the unsigned release APK using apksigner.
   Input: android/app/build/outputs/apk/release/*-unsigned.apk
   Output: release/android/mushroom-tracker-release-signed.apk
#>
param(
  [string]$KeystorePath = "android\keystore\myco-release.keystore",
  [string]$Alias = "myco",
  [string]$Password = $env:ANDROID_KEYSTORE_PASSWORD
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $KeystorePath)) { throw "Keystore not found at $KeystorePath" }
if (-not $Password) { throw "Provide -Password or set ANDROID_KEYSTORE_PASSWORD" }

# SDK / apksigner
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path $sdk)) { $sdk = $env:ANDROID_SDK_ROOT }
$apksigner = Get-ChildItem "$sdk\build-tools" -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $apksigner) { throw "apksigner not found. Install build-tools via sdkmanager." }

# Find unsigned APK
$unsigned = Get-ChildItem "android\app\build\outputs\apk\release" -Recurse -Include *-unsigned.apk -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $unsigned) { throw "Unsigned release APK not found. Run gradlew :app:assembleRelease first." }

# Output
$outDir = "release\android"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outApk = Join-Path $outDir "mushroom-tracker-release-signed.apk"

# Sign
& $apksigner.FullName sign --ks "$KeystorePath" --ks-key-alias "$Alias" --ks-pass "pass:$Password" --out "$outApk" "$($unsigned.FullName)"

# Verify
& $apksigner.FullName verify --print-certs "$outApk"

Write-Host "`nSigned APK written to: $outApk" -ForegroundColor Green
