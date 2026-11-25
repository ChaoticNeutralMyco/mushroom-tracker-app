# scripts/Build-AndroidApk.ps1
# Build the existing Capacitor project using the lockfile, never a fallback APK.
[CmdletBinding()]
param(
    [string]$PackageId = 'com.chaoticneutral.myco',
    [ValidateSet('Debug','Release')][string]$BuildType = 'Release',
    [switch]$InstallAfterBuild,
    [switch]$SkipDependencyInstall,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (-not (Test-Path -LiteralPath $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emu = Join-Path $sdk 'emulator\emulator.exe'
$android = Join-Path $root 'android'
$gradlew = Join-Path $android 'gradlew.bat'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$capCli = Join-Path $root 'node_modules\.bin\cap.cmd'

function Invoke-Step([string]$Executable,[string[]]$Arguments) {
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments | Out-Host
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    if ($code -ne 0) { throw "Command failed (exit $code): $Executable $($Arguments -join ' ')" }
}

Push-Location -LiteralPath $root
try {
    $pkg = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    # Windows PowerShell 5.1 cannot deserialize package-lock's empty root key.
    $lockJson = & node.exe -e "const l=require('./package-lock.json');const p=l.packages;console.log(JSON.stringify({version:l.version,rootVersion:p[''].version,versions:Object.fromEntries(['@capacitor/core','@capacitor/cli','@capacitor/android','@tauri-apps/cli','vite'].map(k=>[k,p['node_modules/'+k].version]))}));"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the dependency lockfile.' }
    $lock = $lockJson | ConvertFrom-Json
    $lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
    $pkgHash = (Get-FileHash -LiteralPath 'package.json' -Algorithm SHA256).Hash
    $cap = Get-Content -LiteralPath 'capacitor.config.json' -Raw | ConvertFrom-Json
    $gradleText = Get-Content -LiteralPath 'android/app/build.gradle' -Raw
    $manifest = Get-Content -LiteralPath 'android/app/src/main/AndroidManifest.xml' -Raw
    if ($cap.appId -ne $PackageId -or $PackageId -ne 'com.chaoticneutral.myco') { throw 'Unexpected application ID.' }
    if ($cap.webDir -ne 'dist' -or $cap.server.url -or $cap.server.androidScheme -ne 'https' -or @($cap.server.allowNavigation | Where-Object { $null -ne $_ }).Count -ne 0) { throw 'Unsafe or unexpected Capacitor configuration.' }
    if ($manifest -notmatch 'android\.permission\.CAMERA' -or $manifest -notmatch 'android\.permission\.INTERNET') { throw 'Required Android manifest permissions missing.' }
    $version = [regex]::Match($gradleText, 'versionName\s+["'']([^"'']+)["'']').Groups[1].Value
    if ($version -ne $pkg.version -or $lock.version -ne $pkg.version -or $lock.rootVersion -ne $pkg.version) { throw 'Android/package/lock version mismatch.' }
    if (-not (Test-Path -LiteralPath $gradlew -PathType Leaf)) { throw 'Existing Android Gradle wrapper is required.' }
    # Release guard runs before any packaging. Debug never falls through to Release.
    if ($BuildType -eq 'Release') {
        Push-Location -LiteralPath $android
        try { Invoke-Step $gradlew @('--no-daemon','--no-configuration-cache','--console=plain',':app:verifyMycoReleaseSigning') }
        finally { Pop-Location }
    }
    if (-not $SkipDependencyInstall) { Invoke-Step $npm @('ci','--no-audit','--no-fund') }
    foreach ($name in @('@capacitor/core','@capacitor/cli','@capacitor/android','vite')) {
        $declared = if ($pkg.dependencies.PSObject.Properties[$name]) { $pkg.dependencies.PSObject.Properties[$name].Value } else { $pkg.devDependencies.PSObject.Properties[$name].Value }
        $locked = $lock.versions.PSObject.Properties[$name].Value
        $actual = (Get-Content -LiteralPath (Join-Path $root "node_modules/$name/package.json") -Raw | ConvertFrom-Json).version
        if ($declared -ne $locked -or $actual -ne $locked) { throw "Local $name does not match the pinned lockfile version." }
    }
    Write-Host 'Building fresh Vite assets...'
    Invoke-Step $npm @('run','build')
    Write-Host 'Synchronizing the existing Android project...'
    Invoke-Step $capCli @('sync','android')
    $variant = $BuildType.ToLowerInvariant()
    $apk = Join-Path $android "app\build\outputs\apk\$variant\app-$variant.apk"
    # Remove only this generated build output so a failed command cannot reuse it.
    if (Test-Path -LiteralPath $apk) { Remove-Item -LiteralPath $apk -Force }
    Push-Location -LiteralPath $android
    try { Invoke-Step $gradlew @('--no-daemon','--no-configuration-cache','--console=plain',":app:assemble$BuildType") }
    finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Expected $BuildType APK not produced; no fallback attempted." }
    # Verify the APK is signed (debug key for Debug, configured release key for Release).
    $tools = @(Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat')) } | Sort-Object { [version]$_.Name } -Descending)
    if ($tools.Count -eq 0) { throw 'Android SDK apksigner not found.' }
    Invoke-Step (Join-Path $tools[0].FullName 'apksigner.bat') @('verify',$apk)
    if ((Get-FileHash -LiteralPath 'package.json' -Algorithm SHA256).Hash -ne $pkgHash -or (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash -ne $lockHash) { throw 'Dependency manifest changed during packaging.' }
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'release\android' }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $filename = if ($BuildType -eq 'Release') { 'mushroom-tracker.apk' } else { 'mushroom-tracker-debug.apk' }
    $dest = Join-Path $OutputDirectory $filename
    Copy-Item -LiteralPath $apk -Destination $dest -Force
    if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash) { throw 'APK copy verification failed.' }
    Write-Host "APK ($BuildType): $dest"
    if ($InstallAfterBuild) {
        # Only the named test emulator; never uninstall or target a physical device.
        & (Join-Path $PSScriptRoot 'Start-MycoCamAvd.ps1') -AvdName 'CNM_API34_CAM' | Out-Null
        $serial = 'emulator-5554'
        Invoke-Step $adb @('-s',$serial,'reverse','tcp:5173','tcp:5173')
        Invoke-Step $adb @('-s',$serial,'reverse','tcp:1420','tcp:1420')
        Invoke-Step $adb @('-s',$serial,'install','-r',$dest)
        Invoke-Step $adb @('-s',$serial,'shell','pm','grant',$PackageId,'android.permission.CAMERA')
        Write-Host 'Installed on test emulator only. App not launched automatically.'
    }
} finally { Pop-Location }
