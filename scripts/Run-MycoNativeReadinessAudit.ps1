# scripts/Run-MycoNativeReadinessAudit.ps1
# Local-only native readiness checks; NEVER builds a signed release or launches the app.
# Writes one uploadable report ZIP directly to Downloads. PowerShell 5.1 compatible.
[CmdletBinding()]
param(
    [switch]$SkipWebBuild,
    [switch]$SkipAndroidDebug,
    [switch]$SkipTauriCompile,
    [switch]$SkipEmulator,
    [switch]$VerifyReleasePackaging
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Packaging mode performs only the dedicated build-only packaging checks.
if ($VerifyReleasePackaging) {
    $SkipWebBuild = $true
    $SkipAndroidDebug = $true
    $SkipTauriCompile = $true
    $SkipEmulator = $true
}

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$downloads = Join-Path $env:USERPROFILE 'Downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$id = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID
$work = Join-Path $downloads ('.MycoTracker-Native-temp-' + $id)
$reportDir = Join-Path $work 'report'
$zipPath = Join-Path $downloads ('MycoTracker-Native-Report-' + $id + '.zip')
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

$findings = New-Object System.Collections.ArrayList
$checks = New-Object System.Collections.ArrayList
$results = [ordered]@{
    webBuild = 'NOT_RUN'
    androidDebug = 'NOT_RUN'
    tauriCompile = 'NOT_RUN'
    emulator = 'NOT_RUN'
}
if ($VerifyReleasePackaging) {
    $results.androidReleaseGuard = 'NOT_RUN'
    $results.androidPackaging = 'NOT_RUN'
    $results.windowsPackaging = 'NOT_RUN'
}
$toolchain = [ordered]@{}
$secretValues = New-Object System.Collections.ArrayList
$unexpectedError = ''

function Add-Finding {
    param([string]$Severity, [string]$Code, [string]$Path, [string]$Message)
    [void]$findings.Add([ordered]@{
        severity = $Severity
        code = $Code
        path = $Path
        message = $Message
    })
}

function Add-Check {
    param([string]$Name, [string]$Result, [string]$Detail)
    [void]$checks.Add([ordered]@{ name = $Name; result = $Result; detail = $Detail })
}

function Redact-Text([string]$Content) {
    if ($null -eq $Content) { return '' }
    foreach ($secret in $secretValues) {
        if ($secret -and [string]$secret -ne '') {
            $Content = $Content.Replace([string]$secret, '[REDACTED]')
        }
    }
    $Content = [regex]::Replace($Content, '(?im)\b(storePassword|keyPassword|STRIPE_SECRET_KEY|FIREBASE_TOKEN|E2E_PASSWORD)\s*[:=]\s*[^\r\n]+', '$1=[REDACTED]')
    $Content = [regex]::Replace($Content, '(?i)Bearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]')
    $Content = [regex]::Replace($Content, 'eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED JWT]')
    return $Content
}

function Invoke-Logged {
    param(
        [string]$Name,
        [string]$Executable,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [switch]$Live
    )
    $raw = Join-Path $work ($Name + '-raw.log')
    $safe = Join-Path $reportDir ($Name + '.log')
    $exitCode = -1
    $errorText = ''
    $previousPreference = $ErrorActionPreference
    try {
        Push-Location -LiteralPath $WorkingDirectory
        try {
            $ErrorActionPreference = 'Continue'
            $global:LASTEXITCODE = 0
            if ($Live) { & $Executable @Arguments *>&1 | Tee-Object -FilePath $raw | Out-Host }
            else { & $Executable @Arguments *> $raw }
            $exitCode = [int]$global:LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
            Pop-Location
        }
    } catch {
        $errorText = [string]$_.Exception.Message
    }
    $contents = ''
    if (Test-Path -LiteralPath $raw) {
        $contents = Get-Content -LiteralPath $raw -Raw -ErrorAction SilentlyContinue
    }
    $safeContent = "CHECK: $Name`r`nEXIT CODE: $exitCode`r`n" + (Redact-Text ($errorText + "`r`n" + $contents))
    Set-Content -LiteralPath $safe -Value $safeContent -Encoding UTF8
    Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
    return [int]$exitCode
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

function Read-JsonFile([string]$Path) {
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-ToolPath([string]$Name) {
    $tool = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $tool) { return [string]$tool.Source }
    return ''
}

function Get-ToolVersion([string]$Name) {
    $path = Get-ToolPath $Name
    if (-not $path) { return 'NOT_FOUND' }
    try {
        $output = & $path --version 2>&1 | Select-Object -First 1
        return ([string]$output).Trim()
    } catch { return 'VERSION_UNAVAILABLE' }
}

$packagePath = Join-Path $repo 'package.json'
$capPath = Join-Path $repo 'capacitor.config.json'
$tauriPath = Join-Path $repo 'src-tauri\tauri.conf.json'
$gradlePath = Join-Path $repo 'android\app\build.gradle'
$manifestPath = Join-Path $repo 'android\app\src\main\AndroidManifest.xml'
$androidBuilderPath = Join-Path $repo 'scripts\Build-AndroidApk.ps1'
$windowsBuilderPath = Join-Path $repo 'scripts\Build-WindowsInstaller.ps1'
$avdLauncherPath = Join-Path $repo 'scripts\Start-MycoCamAvd.ps1'

try {
    Write-Host 'MYCO TRACKER — NATIVE READINESS AUDIT'
    Write-Host 'No release signing, app launching, production deployments, or Firebase writes.'
    foreach ($path in @($packagePath, $capPath, $tauriPath, $gradlePath, $manifestPath)) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Missing required source: $path" }
    }

    $package = Read-JsonFile $packagePath
    $cap = Read-JsonFile $capPath
    $tauri = Read-JsonFile $tauriPath
    $gradle = Get-Content -LiteralPath $gradlePath -Raw
    $manifest = Get-Content -LiteralPath $manifestPath -Raw

    # Collect signing values only in memory so build logs can be scrubbed. Never export them.
    foreach ($match in [regex]::Matches($gradle, '(?m)\b(?:storePassword|keyPassword)\s+["'']([^"'']+)["'']')) {
        [void]$secretValues.Add([string]$match.Groups[1].Value)
    }

    $appId = [string]$cap.appId
    if ($appId -eq [string]$tauri.identifier -and $gradle -match [regex]::Escape($appId)) {
        Add-Check 'Android and Tauri identifier' 'PASS' 'App IDs are consistent.'
    } else {
        Add-Finding 'HIGH' 'APP_ID_MISMATCH' 'capacitor.config.json' 'Native identifiers are inconsistent.'
    }
    if ($manifest -match 'android\.permission\.CAMERA' -and $manifest -match 'android\.permission\.INTERNET') {
        Add-Check 'Android manifest permissions' 'PASS' 'CAMERA and INTERNET are declared.'
    } else {
        Add-Finding 'HIGH' 'ANDROID_PERMISSIONS' 'android/app/src/main/AndroidManifest.xml' 'CAMERA or INTERNET permission is missing.'
    }

    if ($gradle -match '(?m)\b(?:storePassword|keyPassword)\s+["'']') {
        Add-Finding 'CRITICAL' 'INLINE_SIGNING_SECRETS' 'android/app/build.gradle' 'Release-signing passwords are hardcoded in project source. Do not distribute signed releases until signing configuration is secured and the key is reviewed.'
    }
    if (@($cap.server.allowNavigation) -contains '*') {
        Add-Finding 'HIGH' 'CAPACITOR_ALLOW_ALL' 'capacitor.config.json' 'Wildcard allowNavigation is not appropriate for a production WebView.'
    }
    if ($null -eq $tauri.app.security.csp) {
        Add-Finding 'HIGH' 'TAURI_CSP_DISABLED' 'src-tauri/tauri.conf.json' 'Tauri CSP is disabled; review application resource policy before distribution.'
    }
    $targetNames = @($tauri.bundle.targets)
    $windowsBuilder = if (Test-Path -LiteralPath $windowsBuilderPath) { Get-Content -LiteralPath $windowsBuilderPath -Raw } else { '' }
    if (($targetNames -contains 'nsis') -and ($windowsBuilder -match 'bundle[\\/]msi|bundle[\\/]windows|\$msiDir')) {
        Add-Finding 'HIGH' 'WINDOWS_BUNDLE_MISMATCH' 'scripts/Build-WindowsInstaller.ps1' 'Tauri targets NSIS; the copy script searches for MSI or a portable executable instead of the NSIS setup executable.'
    }
    $androidBuilder = if (Test-Path -LiteralPath $androidBuilderPath) { Get-Content -LiteralPath $androidBuilderPath -Raw } else { '' }
    if ($androidBuilder -match '@latest|fallback Debug|npx\s+cap\s+add' -or $androidBuilder -notmatch 'verifyMycoReleaseSigning' -or $androidBuilder -notmatch 'mushroom-tracker-debug\.apk') {
        Add-Finding 'HIGH' 'ANDROID_BUILDER_NONDETERMINISTIC' 'scripts/Build-AndroidApk.ps1' 'The Android builder lacks explicit guarded release/debug packaging or may mutate pinned dependencies.'
    }
    $externalSigningPath = if ($env:MYCO_ANDROID_SIGNING_PROPERTIES) { $env:MYCO_ANDROID_SIGNING_PROPERTIES } else { Join-Path $env:USERPROFILE '.myco-tracker\android-signing.properties' }
    if (-not [IO.Path]::IsPathRooted($externalSigningPath) -or -not (Test-Path -LiteralPath $externalSigningPath -PathType Leaf) -or [IO.Path]::GetFullPath($externalSigningPath).StartsWith(($repo.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Add-Finding 'HIGH' 'EXTERNAL_SIGNING_PENDING' 'android/app/build.gradle' 'External signing configuration is not available outside the repository. Key review and password rotation remain release gates.'
    } else {
        Add-Check 'External signing properties' 'PRESENT_UNVERIFIED' 'External file exists; no contents read and no signing identity verified.'
    }
    $nativeVersion = [regex]::Match($gradle, 'versionName\s+["'']([^"'']+)["'']').Groups[1].Value
    if ([string]$package.version -ne [string]$tauri.version) {
        Add-Finding 'HIGH' 'TAURI_VERSION_MISMATCH' 'src-tauri/tauri.conf.json' 'Tauri version does not match package.json.'
    }
    if (-not $nativeVersion -or $nativeVersion -ne [string]$package.version) {
        Add-Finding 'MEDIUM' 'ANDROID_VERSION_MISMATCH' 'android/app/build.gradle' "Android versionName differs from the web and Tauri version ($($package.version))."
    }

    $toolchain.node = Get-ToolVersion 'node.exe'
    $toolchain.npm = Get-ToolVersion 'npm.cmd'
    $toolchain.java = Get-ToolVersion 'java.exe'
    $toolchain.rustc = Get-ToolVersion 'rustc.exe'
    $toolchain.cargo = Get-ToolVersion 'cargo.exe'
    $toolchain.expectedNode = [string]$package.engines.node
    $toolchain.webVersion = [string]$package.version
    $toolchain.tauriVersion = [string]$tauri.version
    $toolchain.androidVersionName = [string]$nativeVersion
    $toolchain.applicationId = $appId
    $nodeMajor = 0
    if ($toolchain.node -match '^v(\d+)') { $nodeMajor = [int]$Matches[1] }
    if ($nodeMajor -ne 24) {
        Add-Finding 'MEDIUM' 'NODE_VERSION' 'package.json' "Current Node version ($($toolchain.node)) is outside the project engine requirement ($($package.engines.node))."
    }

    $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (-not (Test-Path -LiteralPath $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    $emu = Join-Path $sdk 'emulator\emulator.exe'
    $gradlew = Join-Path $repo 'android\gradlew.bat'
    $viteCli = Join-Path $repo 'node_modules\.bin\vite.cmd'
    $tauriCli = Join-Path $repo 'node_modules\.bin\tauri.cmd'
    $npm = Get-ToolPath 'npm.cmd'
    $toolchain.androidSdkPresent = [bool](Test-Path -LiteralPath $sdk)
    $toolchain.adbPresent = [bool](Test-Path -LiteralPath $adb)
    $toolchain.emulatorPresent = [bool](Test-Path -LiteralPath $emu)
    $toolchain.gradleWrapperPresent = [bool](Test-Path -LiteralPath $gradlew)
    $toolchain.localVitePresent = [bool](Test-Path -LiteralPath $viteCli)
    $toolchain.localTauriPresent = [bool](Test-Path -LiteralPath $tauriCli)

    $git = Get-ToolPath 'git.exe'
    if ($git) {
        try { $toolchain.gitCommit = [string](& $git -C $repo rev-parse HEAD 2>$null | Select-Object -First 1) }
        catch { $toolchain.gitCommit = 'UNAVAILABLE' }
    }

    $avdConfig = Join-Path $env:USERPROFILE '.android\avd\CNM_API34_CAM.avd\config.ini'
    if (Test-Path -LiteralPath $avdConfig) {
        $avdText = Get-Content -LiteralPath $avdConfig -Raw
        if ($avdText -match '(?m)^hw\.camera\.back\s*=\s*virtualscene\s*$') {
            Add-Check 'Persisted AVD back camera' 'PASS' 'CNM_API34_CAM config.ini sets virtualscene.'
        } else {
            Add-Finding 'MEDIUM' 'AVD_CAMERA_PERSISTENCE' '.android/avd/CNM_API34_CAM.avd/config.ini' 'Back camera is not persistently configured as virtualscene; startup flags may override it.'
        }
    } else {
        Add-Finding 'MEDIUM' 'AVD_CONFIG_NOT_FOUND' '.android/avd/CNM_API34_CAM.avd/config.ini' 'Cannot locate the requested AVD configuration in the expected user profile.'
    }

    # Check last synchronized Android HTML without changing Capacitor generated source.
    $androidIndex = Join-Path $repo 'android\app\src\main\assets\public\index.html'
    $distIndex = Join-Path $repo 'dist\index.html'
    if (Test-Path -LiteralPath $androidIndex) {
        Add-Check 'Capacitor bundled HTML' 'PRESENT' 'Bundled index.html exists; packaging mode refreshes it before APK verification.'
    } else {
        Add-Finding 'MEDIUM' 'ANDROID_WEB_ASSETS_MISSING' 'android/app/src/main/assets/public/index.html' 'Bundled web entry is missing; an Android debug build alone cannot prove the latest React app is included.'
    }

    if (-not $SkipWebBuild) {
        if (-not $npm -or -not (Test-Path -LiteralPath $viteCli)) {
            $results.webBuild = 'NOT_RUN_MISSING_TOOLS'
            Add-Finding 'HIGH' 'WEB_TOOLCHAIN_MISSING' 'package.json' 'npm or the locally installed Vite CLI is missing. Audit will not install packages automatically.'
        } else {
            Write-Host 'Checking Vite production compile (no deployment)...'
            $code = Invoke-Logged -Name 'web-build' -Executable $npm -Arguments @('run', 'build') -WorkingDirectory $repo
            $results.webBuild = if ($code -eq 0) { 'PASS' } else { "FAIL_EXIT_$code" }
            if ($code -ne 0) { Add-Finding 'HIGH' 'WEB_BUILD_FAILED' 'package.json' 'Vite compile failed; see web-build.log.' }
        }
    }
    if (-not $VerifyReleasePackaging -and (Test-Path -LiteralPath $distIndex) -and (Test-Path -LiteralPath $androidIndex)) {
        $webHash = (Get-FileHash -LiteralPath $distIndex -Algorithm SHA256).Hash
        $nativeHash = (Get-FileHash -LiteralPath $androidIndex -Algorithm SHA256).Hash
        if ($webHash -ne $nativeHash) {
            Add-Finding 'MEDIUM' 'ANDROID_WEB_BUNDLE_STALE' 'android/app/src/main/assets/public/index.html' 'Android bundled index.html differs from current dist; no automatic sync is performed to protect tracked files.'
        } else {
            Add-Check 'Bundled web index consistency' 'PASS' 'Android index.html matches current dist index.html.'
        }
    }

    if (-not $SkipAndroidDebug) {
        if (-not (Test-Path -LiteralPath $gradlew)) {
            $results.androidDebug = 'NOT_RUN_MISSING_GRADLE_WRAPPER'
            Add-Finding 'HIGH' 'GRADLE_WRAPPER_MISSING' 'android/gradlew.bat' 'Android Gradle wrapper is missing.'
        } elseif ($toolchain.java -eq 'NOT_FOUND') {
            $results.androidDebug = 'NOT_RUN_JAVA_MISSING'
            Add-Finding 'HIGH' 'JAVA_MISSING' 'android/' 'Java was not found in PATH.'
        } else {
            Write-Host 'Compiling Android DEBUG APK only (no install, sync, or release signing)...'
            $code = Invoke-Logged -Name 'android-debug-build' -Executable $gradlew -Arguments @(':app:assembleDebug', '--no-daemon') -WorkingDirectory (Join-Path $repo 'android')
            $results.androidDebug = if ($code -eq 0) { 'PASS' } else { "FAIL_EXIT_$code" }
            if ($code -ne 0) { Add-Finding 'HIGH' 'ANDROID_DEBUG_BUILD_FAILED' 'android/' 'Gradle debug compile failed; see android-debug-build.log.' }
            if ($code -eq 0) {
                $apk = Join-Path $repo 'android\app\build\outputs\apk\debug\app-debug.apk'
                if (Test-Path -LiteralPath $apk) {
                    $toolchain.debugApkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
                    Add-Check 'Android debug APK' 'PASS' 'Debug APK exists; the binary is not included in the report.'
                } else {
                    Add-Finding 'HIGH' 'ANDROID_DEBUG_APK_MISSING' 'android/app/build/outputs/apk/debug/' 'Gradle exited successfully but app-debug.apk is missing.'
                }
            }
        }
    }

    if (-not $SkipTauriCompile) {
        if (-not (Test-Path -LiteralPath $tauriCli) -or $toolchain.cargo -eq 'NOT_FOUND') {
            $results.tauriCompile = 'NOT_RUN_MISSING_TOOLS'
            Add-Finding 'HIGH' 'TAURI_TOOLCHAIN_MISSING' 'src-tauri/' 'Local Tauri CLI or Rust cargo is missing; audit will not install them automatically.'
        } else {
            Write-Host 'Compiling Windows Tauri executable without installer bundling...'
            $code = Invoke-Logged -Name 'tauri-compile' -Executable $tauriCli -Arguments @('build', '--no-bundle') -WorkingDirectory $repo
            $results.tauriCompile = if ($code -eq 0) { 'PASS' } else { "FAIL_EXIT_$code" }
            if ($code -ne 0) { Add-Finding 'HIGH' 'TAURI_COMPILE_FAILED' 'src-tauri/' 'Tauri no-bundle compile failed; see tauri-compile.log.' }
        }
    }

    if (-not $SkipEmulator) {
        if (-not (Test-Path -LiteralPath $adb) -or -not (Test-Path -LiteralPath $emu) -or -not (Test-Path -LiteralPath $avdLauncherPath)) {
            $results.emulator = 'NOT_RUN_MISSING_SDK_OR_LAUNCHER'
            Add-Finding 'HIGH' 'EMULATOR_TOOLCHAIN_MISSING' 'scripts/Start-MycoCamAvd.ps1' 'ADB, emulator.exe, or AVD launcher is unavailable.'
        } else {
            Write-Host 'Starting CNM_API34_CAM system emulator; the app will NOT be installed or launched...'
            # Invoke the launcher in this PowerShell process. Its success stream
            # contains only the serial; host progress stays visible. There is no
            # nested native PowerShell capture to keep open after the emulator launches.
            $statusPath = Join-Path $work 'emulator-start-status.log'
            $launcherError = ''
            $device = $null
            try {
                $device = & $avdLauncherPath -AvdName 'CNM_API34_CAM' -StatusLog $statusPath
                if ($device -isnot [string] -or $device -notmatch '^emulator-\d+$') {
                    throw 'Launcher did not return exactly one emulator serial.'
                }
            } catch {
                $launcherError = [string]$_.Exception.Message
                $device = $null
                Write-Warning "Emulator startup failed: $(Redact-Text $launcherError)"
            } finally {
                $statusText = if (Test-Path -LiteralPath $statusPath) { [string](Get-Content -LiteralPath $statusPath -Raw) } else { '' }
                Set-Content -LiteralPath (Join-Path $reportDir 'emulator-start.log') `
                    -Value (Redact-Text ($statusText + "`r`n" + $launcherError)) -Encoding UTF8
            }
            if ($device) {
                Write-Host "Launcher returned $device; independently checking emulator identity, boot, reverse ports and camera."
                try {
                    $name = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'emu', 'avd', 'name')
                    if ($name.ExitCode -ne 0 -or $name.Output -notmatch '(?m)^CNM_API34_CAM\s*$') {
                        throw 'The returned emulator does not match CNM_API34_CAM.'
                    }
                        $boot = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'shell', 'getprop', 'sys.boot_completed')
                        $bootOk = ($boot.ExitCode -eq 0 -and $boot.Output.Trim() -eq '1')
                        $reverse = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'reverse', '--list')
                        $reverse5173 = ($reverse.ExitCode -eq 0 -and $reverse.Output -match '(?m)(?:^|\s)tcp:5173\s+tcp:5173\s*$')
                        $reverse1420 = ($reverse.ExitCode -eq 0 -and $reverse.Output -match '(?m)(?:^|\s)tcp:1420\s+tcp:1420\s*$')
                        $features = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'shell', 'pm', 'list', 'features')
                        $cameraFeatures = @($features.Output -split '\r?\n' | Where-Object { $_ -match '^feature:android\.hardware\.camera(?:\.|$)' })
                        $cameraOk = ($features.ExitCode -eq 0 -and $cameraFeatures.Count -gt 0)
                        $installed = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'shell', 'pm', 'path', $appId)
                        $grantStatus = 'NOT_INSTALLED'
                        if ($installed.ExitCode -eq 0 -and $installed.Output -match '(?m)^package:') {
                            $grant = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'shell', 'pm', 'grant', $appId, 'android.permission.CAMERA')
                            $grantStatus = if ($grant.ExitCode -eq 0) { 'GRANTED' } else { 'GRANT_FAILED' }
                        } else {
                            $packages = Invoke-MycoAdb -AdbPath $adb -AdbArguments @('-s', $device, 'shell', 'pm', 'list', 'packages', $appId)
                            if ($packages.ExitCode -ne 0 -or $packages.Output -match '(?m)^package:com\.chaoticneutral\.myco\s*$') {
                                $grantStatus = 'GRANT_FAILED'
                            }
                        }
                        $summaryLines = @(
                            "AVD: CNM_API34_CAM"
                            "Serial: $device"
                            "Raw AVD response: $($name.Output)"
                            "Raw boot property: $($boot.Output)"
                            "Raw reverse mappings: $($reverse.Output)"
                            "Boot completed: $bootOk"
                            "ADB reverse 5173 configured: $reverse5173"
                            "ADB reverse 1420 configured: $reverse1420"
                            "Camera features reported: $($cameraFeatures.Count)"
                            "Package camera grant: $grantStatus"
                            'App deliberately NOT installed or launched by this audit.'
                        )
                        $summaryLines += $cameraFeatures
                        $summaryLines | Set-Content -LiteralPath (Join-Path $reportDir 'emulator-summary.txt') -Encoding UTF8
                        $allOk = $bootOk -and $reverse5173 -and $reverse1420 -and $cameraOk -and ($grantStatus -ne 'GRANT_FAILED')
                        $results.emulator = if ($allOk) { 'PASS' } else { 'FAIL_SYSTEM_CHECK' }
                        if (-not $allOk) {
                            Add-Finding 'HIGH' 'EMULATOR_SYSTEM_CHECK_FAILED' 'scripts/Start-MycoCamAvd.ps1' 'One or more boot, reverse-port, camera-feature, or permission checks failed; see emulator-summary.txt.'
                        }
                        Add-Check 'Android emulator system' $results.emulator 'Verified named AVD, boot, both reverse ports, camera features, and conditional CAMERA grant; no app launch.'
                    Write-Host "Emulator verification: $($results.emulator)"
                } catch {
                    $results.emulator = 'FAIL_SYSTEM_CHECK'
                    $detail = Redact-Text ([string]$_.Exception.Message)
                    Add-Content -LiteralPath (Join-Path $reportDir 'emulator-start.log') -Value $detail -Encoding UTF8
                    Add-Finding 'HIGH' 'EMULATOR_SYSTEM_CHECK_FAILED' 'scripts/Start-MycoCamAvd.ps1' 'Independent emulator verification failed; see emulator-start.log.'
                    Write-Warning $detail
                }
            } else {
                $results.emulator = 'FAIL_STARTUP'
                Add-Finding 'HIGH' 'EMULATOR_START_FAILED' 'scripts/Start-MycoCamAvd.ps1' 'AVD startup failed; see emulator-start.log.'
            }
        }
    }

    if ($VerifyReleasePackaging) {
        $results.androidReleaseGuard = 'NOT_RUN'
        $results.androidPackaging = 'NOT_RUN'
        $results.windowsPackaging = 'NOT_RUN'
        $originalSigning = $env:MYCO_ANDROID_SIGNING_PROPERTIES
        $env:MYCO_ANDROID_SIGNING_PROPERTIES = Join-Path $work 'intentionally-missing.properties'
        $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
        $androidAuditOut = Join-Path $work 'android-audit'
        $windowsAuditOut = Join-Path $work 'windows-audit'
        $common = @('-NoProfile','-ExecutionPolicy','Bypass','-File')
        try {
            Write-Host 'Verifying the Android release builder rejects missing credentials...'
            $code = Invoke-Logged -Name 'android-release-guard' -Executable $powershell -Arguments ($common + @($androidBuilderPath,'-BuildType','Release','-SkipDependencyInstall','-OutputDirectory',$androidAuditOut)) -WorkingDirectory $repo
            $guardLog = Get-Content -LiteralPath (Join-Path $reportDir 'android-release-guard.log') -Raw
            if ($code -ne 0 -and $guardLog -match 'MYCO_RELEASE_SIGNING_REQUIRED' -and -not (Test-Path -LiteralPath (Join-Path $androidAuditOut 'mushroom-tracker.apk'))) {
                $results.androidReleaseGuard = 'PASS'
                Add-Check 'Release builder missing credentials' 'PASS' 'Release guard rejects missing external credentials before packaging; no debug fallback.'
            } else {
                $results.androidReleaseGuard = 'FAIL'
                Add-Finding 'HIGH' 'ANDROID_RELEASE_GUARD_FAILED' 'scripts/Build-AndroidApk.ps1' 'Release builder did not demonstrate the expected signing rejection; see android-release-guard.log.'
            }
            try {
                Write-Host 'Running corrected Android builder in explicit Debug mode (fresh locked dependencies and web assets)...'
                $code = Invoke-Logged -Name 'android-package-debug' -Executable $powershell -Arguments ($common + @($androidBuilderPath,'-BuildType','Debug','-OutputDirectory',$androidAuditOut)) -WorkingDirectory $repo -Live
                if ($code -ne 0) { throw "Debug builder exited $code." }
                $apk = Join-Path $androidAuditOut 'mushroom-tracker-debug.apk'
                if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'Debug output missing.' }
                if (Test-Path -LiteralPath (Join-Path $androidAuditOut 'mushroom-tracker.apk')) { throw 'Unexpected release artifact in audit output.' }
                $tools = @(Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'aapt.exe')) } | Sort-Object { [version]$_.Name } -Descending)
                if ($tools.Count -eq 0) { throw 'Android SDK aapt.exe not found.' }
                $code = Invoke-Logged -Name 'android-apk-badging' -Executable (Join-Path $tools[0].FullName 'aapt.exe') -Arguments @('dump','badging',$apk) -WorkingDirectory $repo
                $badging = Get-Content -LiteralPath (Join-Path $reportDir 'android-apk-badging.log') -Raw
                if ($code -ne 0 -or $badging -notmatch ("package: name='" + [regex]::Escape($appId) + "' versionCode='2' versionName='" + [regex]::Escape([string]$package.version) + "'") -or $badging -notmatch 'application-debuggable') { throw 'APK version, application ID, or debug marker did not match.' }
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
                try {
                    $entry = $archive.GetEntry('assets/capacitor.config.json')
                    if ($null -eq $entry) { throw 'APK missing embedded Capacitor configuration.' }
                    $reader = New-Object System.IO.StreamReader($entry.Open())
                    try { $embedded = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
                    if ($embedded.appId -ne $appId -or $embedded.server.androidScheme -ne 'https' -or $embedded.server.PSObject.Properties['url'] -or @($embedded.server.allowNavigation | Where-Object { $null -ne $_ }).Count -ne 0) { throw 'APK navigation configuration is not the expected secure local configuration.' }
                    $dist = (Resolve-Path -LiteralPath (Join-Path $repo 'dist')).Path
                    $assetFiles = @(Get-Item -LiteralPath (Join-Path $dist 'index.html'))
                    $assetFiles += @(Get-ChildItem -LiteralPath (Join-Path $dist 'assets') -Recurse -File)
                    if ($assetFiles.Count -lt 2) { throw 'Missing frontend assets.' }
                    foreach ($asset in $assetFiles) {
                        $relative = $asset.FullName.Substring($dist.Length + 1).Replace('\','/')
                        $entry = $archive.GetEntry("assets/public/$relative")
                        if ($null -eq $entry) { throw "APK missing built asset: $relative" }
                        $stream = $entry.Open()
                        try { $actual = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash } finally { $stream.Dispose() }
                        if ($actual -ne (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash) { throw "APK asset mismatch: $relative" }
                    }
                    $toolchain.packagedWebAssetsMatched = $assetFiles.Count
                } finally { $archive.Dispose() }
                $toolchain.debugApkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
                $results.androidPackaging = 'PASS'
                Add-Check 'Android debug packaging' 'PASS' 'Correct app ID, version 1.1.4/code 2, debug marker, secure navigation, and fresh web assets; no release APK.'
            } catch {
                $results.androidPackaging = 'FAIL'
                Add-Finding 'HIGH' 'ANDROID_PACKAGING_FAILED' 'scripts/Build-AndroidApk.ps1' (Redact-Text ([string]$_.Exception.Message))
            }
            try {
                Write-Host 'Running corrected Windows NSIS builder in unsigned audit mode...'
                $code = Invoke-Logged -Name 'windows-package-nsis' -Executable $powershell -Arguments ($common + @($windowsBuilderPath,'-UnsignedAudit','-SkipDependencyInstall','-OutputDirectory',$windowsAuditOut)) -WorkingDirectory $repo -Live
                if ($code -ne 0) { throw "NSIS builder exited $code." }
                $setups = @(Get-ChildItem -LiteralPath $windowsAuditOut -Filter '*-setup-UNSIGNED-AUDIT.exe' -File)
                if ($setups.Count -ne 1) { throw 'Expected exactly one audit NSIS installer.' }
                $signature = Get-AuthenticodeSignature -LiteralPath $setups[0].FullName
                if ([string]$signature.Status -ne 'NotSigned') { throw 'Audit installer unexpectedly carries a signature.' }
                $toolchain.windowsInstallerName = $setups[0].Name
                $toolchain.windowsInstallerSha256 = (Get-FileHash -LiteralPath $setups[0].FullName -Algorithm SHA256).Hash
                $toolchain.windowsInstallerBytes = $setups[0].Length
                $results.windowsPackaging = 'PASS'
                Add-Check 'Windows NSIS packaging' 'PASS' 'New versioned NSIS setup copied and verified unsigned; no installation or distribution.'
            } catch {
                $results.windowsPackaging = 'FAIL'
                Add-Finding 'HIGH' 'WINDOWS_PACKAGING_FAILED' 'scripts/Build-WindowsInstaller.ps1' (Redact-Text ([string]$_.Exception.Message))
            }
        } finally {
            if ($null -eq $originalSigning) { Remove-Item Env:MYCO_ANDROID_SIGNING_PROPERTIES -ErrorAction SilentlyContinue } else { $env:MYCO_ANDROID_SIGNING_PROPERTIES = $originalSigning }
        }
    }

} catch {
    $unexpectedError = [string]$_.Exception.Message
    Add-Finding 'HIGH' 'AUDIT_EXCEPTION' 'scripts/Run-MycoNativeReadinessAudit.ps1' 'An audit step raised an exception; see summary.json for a sanitized diagnostic.'
} finally {
    try {
        $releasable = (@($findings | Where-Object { $_.severity -in @('CRITICAL', 'HIGH') }).Count -eq 0) -and (-not $unexpectedError)
        $releaseStatus = if ($releasable) { 'REVIEW_REQUIRED' } else { 'RELEASE_BLOCKED' }
        $summary = [ordered]@{
            app = 'Chaotic Neutral Myco Tracker'
            timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
            releaseStatus = $releaseStatus
            note = 'Build checks do not approve release. Production services were not used.'
            codeChanges = 'Local native diagnostic results; compilation and packaging are not release approval.'
            toolchain = $toolchain
            checks = @($checks)
            builds = $results
            packagingStatus = if ($VerifyReleasePackaging) { if ($results.androidReleaseGuard -eq 'PASS' -and $results.androidPackaging -eq 'PASS' -and $results.windowsPackaging -eq 'PASS') { 'PASS' } else { 'FAIL' } } else { 'NOT_RUN' }
            findings = @($findings)
            error = (Redact-Text $unexpectedError)
        }
        $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportDir 'summary.json') -Encoding UTF8
        @'
MYCO TRACKER — NATIVE READINESS REPORT
======================================
Upload this ONE ZIP to ChatGPT for review.

Checks: source configuration, local toolchain, optional Vite compile,
Android DEBUG Gradle compile, Windows Tauri executable compile with
--no-bundle, and API 34 virtual camera emulator preflight.

Optional packaging mode verifies a rejected release guard, refreshes Android assets,
builds a debug APK and an unsigned Windows NSIS installer in temporary audit output.

DOES NOT: perform release signing,
install or launch the application, deploy Firebase/Vercel, touch Stripe,
commit/push Git, or reset Firestore.

Important: Even passing compilation is NOT production release approval.
Signing secrets and native security findings must be resolved first.
No source files, keystore bytes, environment values, or APK binaries
are collected. Review all logs before sharing outside this chat.
'@ | Set-Content -LiteralPath (Join-Path $reportDir 'READ-ME.txt') -Encoding UTF8
        Compress-Archive -Path (Join-Path $reportDir '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
        Write-Host ''
        Write-Host "STATUS: $releaseStatus"
        Write-Host "WEB: $($results.webBuild) | ANDROID DEBUG: $($results.androidDebug) | TAURI: $($results.tauriCompile) | EMULATOR: $($results.emulator)"
        if ($VerifyReleasePackaging) { Write-Host "PACKAGING: Android guard $($results.androidReleaseGuard) | Android debug $($results.androidPackaging) | Windows NSIS $($results.windowsPackaging)" }
        Write-Host "UPLOAD THIS ONE ZIP: $zipPath"
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warning "Report packaging failed: $($_.Exception.Message)"
        Write-Host "Unpacked report: $reportDir"
    }
}
