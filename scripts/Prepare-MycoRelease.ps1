# scripts/Prepare-MycoRelease.ps1
# Build and verify the next release locally. Never publish or install by default.
[CmdletBinding()]
param(
    [string]$Version,
    [string[]]$ReleaseNotes
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$secure = Join-Path $env:USERPROFILE '.myco-tracker'
$stamp = "$(Get-Date -Format yyyyMMdd-HHmmss)-$PID"
$report = Join-Path $downloads "MycoTracker-Unified-Release-$stamp.txt"
$results = New-Object 'System.Collections.Generic.List[string]'
$status = 'FAIL'
$phase = 'Preflight'
function Run-Step([string]$exe,[string[]]$argsList) {
    $old = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; & $exe @argsList | Out-Host; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    if ($code -ne 0) { throw "Command failed: $exe (exit $code)" }
}
function Record([string]$line) { $results.Add($line); Write-Host $line }
Push-Location -LiteralPath $root
try {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    if ($Version) {
        if (-not $ReleaseNotes -or $ReleaseNotes.Count -eq 0) { throw 'Release notes are required for a version bump.' }
        Run-Step $node (@('scripts/Set-MycoReleaseVersion.mjs',$Version) + $ReleaseNotes)
    }
    $pkg = Get-Content package.json -Raw | ConvertFrom-Json
    $v = [string]$pkg.version
    if ($v -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable x.y.z version is required.' }
    $out = Join-Path $downloads "MycoTracker-$v-Prepared-$stamp"
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    Record 'MYCO TRACKER - UNIFIED RELEASE PREPARATION'
    Record "Version: $v"
    Record "Output: $out"
    # Preserve the verified Android certificate and package ID.
    $gradle = Get-Content android/app/build.gradle -Raw
    $versionCode = [regex]::Match($gradle,'(?m)^\s*versionCode\s+(\d+)').Groups[1].Value
    if ([int]$versionCode -lt 3) { throw 'Android versionCode must be at least 3 for the updater-enabled release.' }
    Record "Android versionCode: $versionCode"
    $phase = 'Updater unit tests'
    Run-Step $node @('--test','tests/unit/appUpdates.test.mjs')
    Record 'Updater logic tests: PASS'
    $phase = 'Locked dependencies and web build'
    Run-Step $npm @('ci','--no-audit','--no-fund')
    Run-Step $npm @('run','build')
    $manifest = Get-Content dist/app-version.json -Raw | ConvertFrom-Json
    if ($manifest.version -ne $v) { throw 'Built web version manifest does not match package version.' }
    Record 'Web compilation and version manifest: PASS'
    $phase = 'Android signed release packaging'
    & (Join-Path $PSScriptRoot 'Build-AndroidApk.ps1') -BuildType Release -SkipDependencyInstall -OutputDirectory $out
    $apk = Join-Path $out 'mushroom-tracker.apk'
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'Release APK missing.' }
    $sdk = "$env:LOCALAPPDATA\Android\Sdk"
    if (-not (Test-Path -LiteralPath $sdk) -and $env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    $emu = Join-Path $sdk 'emulator\emulator.exe'
    $bt = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path (Join-Path $_.FullName 'apksigner.bat')) -and (Test-Path (Join-Path $_.FullName 'aapt.exe')) } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $bt) { throw 'Android build tools missing.' }
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $sig = (& (Join-Path $bt.FullName 'apksigner.bat') verify --print-certs $apk 2>&1) -join "`n"
        $sigExit = $LASTEXITCODE
        $badging = (& (Join-Path $bt.FullName 'aapt.exe') dump badging $apk 2>&1) -join "`n"
        $aaptExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    $certs = [regex]::Matches($sig,'(?im)^Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f:]+)\s*$')
    $expected = 'E75033D8AB849BF121CAF2BB56326EB0313DBF0289FDA756E977A0572AF2AFE0'
    if ($sigExit -ne 0 -or $certs.Count -ne 1 -or $certs[0].Groups[1].Value.Replace(':','').ToUpperInvariant() -ne $expected) { throw 'APK certificate mismatch or invalid signature.' }
    if ($aaptExit -ne 0 -or $badging -notmatch "package: name='com\.chaoticneutral\.myco' versionCode='$versionCode' versionName='$([regex]::Escape($v))'") { throw 'APK version or application ID mismatch.' }
    $apkName = "MycoTracker-$v-Android.apk"
    Move-Item -LiteralPath $apk -Destination (Join-Path $out $apkName)
    Record 'Android release APK signature, package and version: PASS'
    Record "Android SHA256: $((Get-FileHash (Join-Path $out $apkName) -Algorithm SHA256).Hash)"
    $phase = 'Windows packaging'
    # Never generate or replace the updater private key. An absent key means
    # the Windows installer is for personal testing only; no latest.json is created.
    $hasKey = -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)
    Record "Tauri updater signing key configured in environment: $hasKey"
    if ($hasKey) {
        & (Join-Path $PSScriptRoot 'Build-WindowsInstaller.ps1') -SkipDependencyInstall -OutputDirectory $out
        $setups = @(Get-ChildItem -LiteralPath $out -Filter '*-setup.exe' -File)
        if ($setups.Count -ne 1) { throw 'Expected one signed-updater Windows installer.' }
        $setup = $setups[0]; $signature = $setup.FullName + '.sig'
        if (-not (Test-Path -LiteralPath $signature -PathType Leaf)) { throw 'Windows updater signature missing.' }
        $stableName = "MycoTracker-$v-Windows-x64-setup.exe"
        $signatureText = (Get-Content -LiteralPath $signature -Raw).Trim()
        if (-not $signatureText) { throw 'Windows updater signature empty.' }
        Move-Item -LiteralPath $setup.FullName -Destination (Join-Path $out $stableName)
        Move-Item -LiteralPath $signature -Destination (Join-Path $out "$stableName.sig")
        $update = [ordered]@{ version=$v; notes=($pkg.mycoReleaseNotes -join "`n"); pub_date=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'); platforms=@{'windows-x86_64'=@{signature=$signatureText; url="https://github.com/ChaoticNeutralMyco/mushroom-tracker-app/releases/download/v$v/$stableName"}} }
        [IO.File]::WriteAllText((Join-Path $out 'latest.json'),($update | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
        Record 'Windows updater artifact and candidate manifest: CREATED (runtime verification pending)'
        Record "Windows SHA256: $((Get-FileHash (Join-Path $out $stableName) -Algorithm SHA256).Hash)"
        $status = 'ARTIFACTS_PREPARED'
    } else {
        & (Join-Path $PSScriptRoot 'Build-WindowsInstaller.ps1') -UnsignedAudit -SkipDependencyInstall -OutputDirectory $out
        $setups = @(Get-ChildItem -LiteralPath $out -Filter '*-UNSIGNED-AUDIT.exe' -File)
        if ($setups.Count -ne 1) { throw 'Expected one Windows audit installer.' }
        Record 'Windows personal-use installer: PASS (not updater-signed)'
        Record "Windows SHA256: $((Get-FileHash $setups[0].FullName -Algorithm SHA256).Hash)"
        Record 'Windows automatic update publication blocked until the matching updater private key is available.'
        $status = 'WEB_ANDROID_PREPARED_WINDOWS_SIGNING_PENDING'
    }
    [IO.File]::WriteAllText((Join-Path $out 'release-notes.md'),("# Myco Tracker $v`n`n" + (($pkg.mycoReleaseNotes | ForEach-Object { '- ' + $_ }) -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    Record 'Builds completed. Nothing published or installed.'
} catch {
    Record "Failed phase: $phase"
    Write-Host "FAILED during $phase. See console for the specific error." -ForegroundColor Red
    # Error details may contain environment paths; do not include signing logs or secrets in the report.
    Write-Host $_.Exception.Message
} finally {
    Record "Status: $status"
    Record 'No Git commit/push, Vercel deployment, Firebase deployment, Stripe operation, or application installation performed.'
    $results | Set-Content -LiteralPath $report -Encoding UTF8
    Pop-Location
    Write-Host "UPLOAD ONLY: $report"
}
if ($status -eq 'FAIL') { exit 1 }
