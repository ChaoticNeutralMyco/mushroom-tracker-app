# scripts/Run-MycoSigningSecurityAudit.ps1
# Verification only: no release signing, installation, or production service calls.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$stamp = "$(Get-Date -Format yyyyMMdd-HHmmss)-$PID"
$stage = Join-Path $env:TEMP "CNM-SigningAudit-$stamp"
$report = Join-Path "$env:USERPROFILE\Downloads" "MycoTracker-Signing-Report-$stamp.zip"
$oldOverride = $env:MYCO_ANDROID_SIGNING_PROPERTIES
$missingFile = Join-Path $stage 'intentionally-missing.properties'
$results = [ordered]@{
    status = 'FAIL'
    debugBuild = 'NOT_RUN'
    missingCredentialGuard = 'NOT_RUN'
    releaseApkGuardWired = 'NOT_RUN'
    releaseBundleGuardWired = 'NOT_RUN'
    trackedSigningFiles = 'NOT_RUN'
    ignoreRules = 'NOT_RUN'
    localPropertiesPreserved = 'NOT_RUN'
    error = ''
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null

function Invoke-GradleAudit {
    param([string]$Label, [string[]]$Arguments)
    Write-Host "Running $Label..."
    $log = Join-Path $stage "$Label.log"
    # Native stderr is diagnostic output, not a PowerShell terminating error.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & .\gradlew.bat --no-daemon --no-configuration-cache --console=plain @Arguments 2>&1 |
            ForEach-Object { $_.ToString() } | Tee-Object -FilePath $log | Out-Host
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return [int]$code
}

try {
    Set-Location $repo
    # Explicitly override any real credentials for every Gradle test.
    $env:MYCO_ANDROID_SIGNING_PROPERTIES = $missingFile

    $localProperties = Join-Path $repo 'keystore.properties'
    $localExisted = Test-Path -LiteralPath $localProperties -PathType Leaf
    $localHash = $null
    if ($localExisted) {
        $localHash = (Get-FileHash -LiteralPath $localProperties -Algorithm SHA256).Hash
    }

    $tracked = @(& git ls-files -- 'keystore.properties')
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git index.' }
    if ($tracked -contains 'keystore.properties') {
        # Stages removal from the index only. Never deletes the working file.
        & git rm --cached -- keystore.properties
        if ($LASTEXITCODE -ne 0) { throw 'Git refused to untrack keystore.properties; no force used.' }
    }
    if ($localExisted) {
        if (-not (Test-Path -LiteralPath $localProperties -PathType Leaf)) {
            throw 'Local signing properties unexpectedly missing.'
        }
        if ((Get-FileHash -LiteralPath $localProperties -Algorithm SHA256).Hash -ne $localHash) {
            throw 'Local signing properties unexpectedly changed.'
        }
    }
    $results.localPropertiesPreserved = 'PASS'

    $tracked = @(& git ls-files -- '*keystore.properties' '*.jks' '*.keystore' '*.p12' '*.pfx')
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect tracked signing filenames.' }
    # Only names, never contents.
    Set-Content -LiteralPath (Join-Path $stage 'tracked-signing-filenames.txt') -Value ($tracked -join "`n")
    if ($tracked.Count -ne 0) { throw 'Additional signing files are still tracked; manual review required.' }
    $results.trackedSigningFiles = 'PASS'

    foreach ($name in @('keystore.properties','android/app/my-release-key.jks','android/app/test.keystore','android/app/test.p12','android/app/test.pfx','test.p12','test.pfx')) {
        & git check-ignore --no-index -- $name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Signing ignore rule missing: $name" }
    }
    $results.ignoreRules = 'PASS'

    Push-Location (Join-Path $repo 'android')
    try {
        $code = Invoke-GradleAudit -Label 'debug-build' -Arguments @(':app:assembleDebug')
        $results.debugBuild = if ($code -eq 0) { 'PASS' } else { 'FAIL' }

        $code = Invoke-GradleAudit -Label 'missing-credential-guard' -Arguments @(':app:verifyMycoReleaseSigning')
        $guardText = Get-Content -LiteralPath (Join-Path $stage 'missing-credential-guard.log') -Raw
        $results.missingCredentialGuard = if ($code -ne 0 -and $guardText -match 'MYCO_RELEASE_SIGNING_REQUIRED') { 'PASS' } else { 'FAIL' }

        # Dry-run confirms the guard is part of both real release task graphs.
        # Does not execute release tasks or produce a signed/unsigned artifact.
        $code = Invoke-GradleAudit -Label 'release-apk-plan' -Arguments @(':app:assembleRelease','--dry-run')
        $plan = Get-Content -LiteralPath (Join-Path $stage 'release-apk-plan.log') -Raw
        $results.releaseApkGuardWired = if ($code -eq 0 -and $plan -match ':app:verifyMycoReleaseSigning\b') { 'PASS' } else { 'FAIL' }

        $code = Invoke-GradleAudit -Label 'release-bundle-plan' -Arguments @(':app:bundleRelease','--dry-run')
        $plan = Get-Content -LiteralPath (Join-Path $stage 'release-bundle-plan.log') -Raw
        $results.releaseBundleGuardWired = if ($code -eq 0 -and $plan -match ':app:verifyMycoReleaseSigning\b') { 'PASS' } else { 'FAIL' }
    }
    finally {
        Pop-Location
    }
    $checks = @('debugBuild','missingCredentialGuard','releaseApkGuardWired','releaseBundleGuardWired','trackedSigningFiles','ignoreRules','localPropertiesPreserved')
    if (@($checks | Where-Object { $results[$_] -ne 'PASS' }).Count -eq 0) {
        $results.status = 'PASS'
    } else {
        $results.error = 'One or more checks did not pass. See individual results and logs.'
    }
}
catch {
    $results.error = $_.Exception.Message
    Write-Host "Audit failed: $($results.error)" -ForegroundColor Red
}
finally {
    if ($null -eq $oldOverride) {
        Remove-Item Env:MYCO_ANDROID_SIGNING_PROPERTIES -ErrorAction SilentlyContinue
    } else {
        $env:MYCO_ANDROID_SIGNING_PROPERTIES = $oldOverride
    }
    $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'summary.json') -Encoding UTF8
    Compress-Archive -Path "$stage\*" -DestinationPath $report -Force
    Write-Host "Signing security audit: $($results.status)"
    Write-Host "UPLOAD THIS ONE ZIP:"
    Write-Host $report
}
if ($results.status -ne 'PASS') { exit 1 }
