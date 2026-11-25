# scripts/Publish-MycoWeb.ps1
# Publish the reviewed web source through GitHub main -> Vercel Git integration.
# Run only after a successful local release preparation. Does NOT publish native installers.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $root
try {
    $v = (Get-Content package.json -Raw | ConvertFrom-Json).version
    if ((Get-Content dist/app-version.json -Raw | ConvertFrom-Json).version -ne $v) { throw 'Build the matching release first.' }
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Expected main branch.' }
    $remote = (& git remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)ChaoticNeutralMyco/mushroom-tracker-app(\.git)?/?$') { throw 'Unexpected origin repository.' }
    & git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch origin/main.' }
    $head = (& git rev-parse HEAD).Trim()
    $remoteHead = (& git rev-parse origin/main).Trim()
    if ($head -ne $remoteHead) { throw 'Local HEAD and origin/main differ. Review before publishing.' }
    # Explicit allowlist from the verified local work and the updater package.
    $approved = @(
        '.gitignore','android/.gitignore','android/app/build.gradle','capacitor.config.json',
        'keystore.properties','scripts/Build-AndroidApk.ps1','scripts/Build-WindowsInstaller.ps1',
        'scripts/Start-MycoCamAvd.ps1','scripts/test-subscription-e2e.ps1',
        'src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','src-tauri/src/main.rs',
        'src/components/Grow/GrowDetail.jsx','src/components/Grow/GrowForm.jsx','src/components/Grow/GrowList.jsx',
        'src/components/Grow/GrowTimeline.jsx','src/components/Grow/LabelPrint.jsx',
        'src/components/Grow/LabelPrintWrapper.jsx','src/components/Grow/PackagingLabelPreview.jsx',
        'src/components/ui/ScanBarcodeModal.jsx','tests/e2e/grow-lifecycle.spec.ts',
        'tests/e2e/helpers/firestore.ts','tests/e2e/subscription-access.spec.ts',
        'scripts/Run-MycoE2EReport.ps1','scripts/Run-MycoNativeNavigationAudit.ps1',
        'scripts/Run-MycoNativeReadinessAudit.ps1','scripts/Run-MycoSigningSecurityAudit.ps1',
        'tests/e2e/ux-dashboard-grow.spec.ts','tests/e2e/ux-operations-archive.spec.ts',
        'tests/e2e/ux-remaining-modules.spec.ts','package.json','package-lock.json','vite.config.js','vercel.json',
        'src/lib/whatsNew.js','src/lib/appUpdates.js','src/main.jsx','src/pages/Settings.jsx',
        'src/components/ui/AppUpdates.jsx','android/app/src/main/java/com/chaoticneutral/myco/MainActivity.java',
        'android/app/src/main/java/com/chaoticneutral/myco/MycoUpdaterPlugin.java',
        '.github/workflows/tauri-release.yml','tests/unit/appUpdates.test.mjs',
        'scripts/Prepare-MycoRelease.ps1','scripts/Publish-MycoWeb.ps1','scripts/Set-MycoReleaseVersion.mjs'
    )
    $changed = @(& git diff --name-only HEAD)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect working tree.' }
    $unexpected = @($changed | Where-Object { $_ -notin $approved })
    if ($unexpected.Count) { $unexpected | Out-Host; throw 'Unexpected tracked changes; review required.' }
    $staged = @(& git diff --cached --name-only)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect index.' }
    $unexpected = @($staged | Where-Object { $_ -notin $approved })
    if ($unexpected.Count) { $unexpected | Out-Host; throw 'Unexpected staged paths; review required.' }
    # Never stage the legacy properties file, even if it still exists locally.
    $trackedSecrets = @(& git ls-files -- '*.jks' '*.keystore' '*.p12' '*.pfx' '*keystore.properties' '*android-signing.properties')
    if ($LASTEXITCODE -ne 0 -or $trackedSecrets.Count) { throw 'Signing files are still tracked. Stop and review.' }
    $untracked = @(& git ls-files --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect untracked files.' }
    $paths = @($approved | Where-Object { $_ -ne 'keystore.properties' -and ($_ -in $changed -or $_ -in $staged -or $_ -in $untracked) })
    # Check candidate content for high-confidence private credentials; do not print matched content.
    $secretPattern = '(?i)(-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|\b(?:sk_live_|rk_live_|ghp_|github_pat_)[A-Za-z0-9_]{16,}|\b(?:storePassword|keyPassword)\s*(?:=\s*)?[\x22\x27][^\x22\x27\r\n]+[\x22\x27])'
    foreach ($p in $paths) {
        if (Test-Path -LiteralPath $p -PathType Leaf) {
            $candidateText = [IO.File]::ReadAllText((Join-Path $root $p))
            # Exclude only the exact known, non-secret Gradle list of property names.
            # Do not exclude the file or other signing-related lines from scanning.
            if ($p -eq 'android/app/build.gradle') {
                $candidateText = [regex]::Replace($candidateText, '(?m)^[ \t]*def requiredFields = \[''storeFile'', ''storePassword'', ''keyAlias'', ''keyPassword''\][ \t]*\r?$', '')
            }
            if ([regex]::IsMatch($candidateText, $secretPattern)) { throw "Potential credential in $p. Review locally without sharing it." }
        }
    }
    Write-Host "Proposed source commit for version $v (GitHub repository is PUBLIC):"
    $paths | Sort-Object | Out-Host
    if ('keystore.properties' -in $staged) { Write-Host 'keystore.properties - staged deletion only; local file preserved.' }
    Write-Host 'This will push reviewed source to main and trigger the production Vercel build. It will not publish APKs/installers or deploy Firebase.'
    if ((Read-Host 'Type DEPLOY WEB to authorize') -cne 'DEPLOY WEB') { Write-Host 'Deployment canceled. No new files staged.'; return }
    if ($paths.Count) {
        & git add -A -- @paths
        if ($LASTEXITCODE -ne 0) { throw 'Git staging failed.' }
    }
    $stagedNow = @(& git diff --cached --name-only)
    if ($LASTEXITCODE -ne 0 -or @($stagedNow | Where-Object { $_ -notin $approved }).Count) { throw 'Index changed unexpectedly.' }
    $trackedSecrets = @(& git ls-files -- '*.jks' '*.keystore' '*.p12' '*.pfx' '*keystore.properties' '*android-signing.properties')
    if ($LASTEXITCODE -ne 0 -or $trackedSecrets.Count) { throw 'Signing files must not be tracked.' }
    & git diff --cached --stat
    if ($LASTEXITCODE -ne 0) { throw 'Cannot review staged diff.' }
    if (-not $stagedNow.Count) { Write-Host 'No source changes to publish.'; return }
    & git commit -m "Release $v - unified application updates and native improvements"
    if ($LASTEXITCODE -ne 0) { throw 'Commit failed. Nothing pushed.' }
    & git push origin HEAD:main
    if ($LASTEXITCODE -ne 0) { throw 'Push failed. Do not force push.' }
    $sha = (& git rev-parse HEAD).Trim()
    Write-Host "GITHUB_PUSHED: $sha" -ForegroundColor Green
    Write-Host 'Vercel production deployment should trigger from main; verify its READY status separately.'
} finally { Pop-Location }
