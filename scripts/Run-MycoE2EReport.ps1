# scripts/Run-MycoE2EReport.ps1
# Emulator-only Playwright regression runner. Delivers ONE uploadable ZIP in Downloads.
# No commits, deployments, production Firebase writes, or Stripe operations.
param(
    [ValidateSet('regression', 'lifecycle', 'sop', 'subscription', 'ux', 'operations', 'modules')]
    [string]$Suite = 'regression'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    throw 'Run this saved .ps1 using powershell -File. Do not paste its contents into the console.'
}

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repo 'scripts\test-subscription-e2e.ps1'
$packagePath = Join-Path $repo 'package.json'
$lockPath = Join-Path $repo 'package-lock.json'
$localPlaywrightCli = Join-Path $repo 'node_modules\playwright\cli.js'
$localPlaywrightPackage = Join-Path $repo 'node_modules\@playwright\test\package.json'

$downloads = Join-Path $env:USERPROFILE 'Downloads'
try {
    $folderGuid = '{374DE290-123F-4565-9164-39C4925E467B}'
    $folderKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
    $setting = (Get-ItemProperty -Path $folderKey -Name $folderGuid -ErrorAction Stop).$folderGuid
    if (-not [string]::IsNullOrWhiteSpace($setting)) {
        $downloads = [Environment]::ExpandEnvironmentVariables($setting)
    }
} catch { }
New-Item -ItemType Directory -Path $downloads -Force | Out-Null

$id = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID
$work = Join-Path $downloads ('.MycoTracker-E2E-temp-' + $id)
$bundle = Join-Path $work 'report'
$zipPath = Join-Path $downloads ('MycoTracker-E2E-Report-' + $id + '.zip')
New-Item -ItemType Directory -Path $bundle -Force | Out-Null

$phase = 'initializing'
$npmExit = $null
$browserExit = $null
$testExit = $null
$started = $false
$errorMessage = ''
$priorReports = @()
$reportPackaged = $false

function Redact-Log([string]$value) {
    $value = [regex]::Replace($value, '(?im)\b(E2E_PASSWORD|TEST_ACCOUNT|STRIPE_SECRET_KEY|FIREBASE_TOKEN)\s*[:=]\s*[^\r\n]+', '$1=[REDACTED]')
    $value = [regex]::Replace($value, '(?i)Bearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]')
    $value = [regex]::Replace($value, 'eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED JWT]')
    return $value
}

function Invoke-Logged {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [string]$LogName
    )
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.WorkingDirectory = $repo
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $quoted = foreach ($arg in $Arguments) {
        if ($arg -match '[\s"]') { '"' + $arg.Replace('"', '\"') + '"' }
        else { $arg }
    }
    $info.Arguments = $quoted -join ' '

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $info
    try {
        if (-not $proc.Start()) { throw "Unable to start $Executable" }
        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
        $stderrTask = $proc.StandardError.ReadToEndAsync()
        $proc.WaitForExit()
        $contents = "COMMAND: $Executable $($info.Arguments)`r`nEXIT CODE: $($proc.ExitCode)`r`n"
        $contents += "`r`n--- STDOUT ---`r`n" + $stdoutTask.Result
        $contents += "`r`n--- STDERR ---`r`n" + $stderrTask.Result
        [IO.File]::WriteAllText((Join-Path $bundle $LogName), (Redact-Log $contents))
        return [int]$proc.ExitCode
    } finally {
        $proc.Dispose()
    }
}

try {
    Write-Host "Myco Tracker $Suite diagnostic run"
    if (-not (Test-Path -LiteralPath $launcher)) { throw "Missing test launcher: $launcher" }
    if (-not (Test-Path -LiteralPath $packagePath)) { throw "Missing package.json: $packagePath" }
    if (-not (Test-Path -LiteralPath $lockPath)) { throw 'Missing package-lock.json; refusing unpinned dependency installation.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $manifest = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $expected = [string]$manifest.devDependencies.'@playwright/test'
    if ([string]::IsNullOrWhiteSpace($expected)) { throw 'package.json does not specify @playwright/test.' }

    $installed = ''
    if (Test-Path -LiteralPath $localPlaywrightPackage) {
        $installed = [string](Get-Content -LiteralPath $localPlaywrightPackage -Raw | ConvertFrom-Json).version
    }
    if (-not (Test-Path -LiteralPath $localPlaywrightCli) -or $installed -ne $expected) {
        $phase = 'installing project-locked dependencies'
        Write-Host 'Restoring pinned project dependencies with npm ci...'
        $npmExit = Invoke-Logged -Executable $env:ComSpec -Arguments @('/d', '/c', 'npm', 'ci', '--no-audit', '--no-fund') -LogName 'dependency-install.log'
        if ($npmExit -ne 0) { throw "npm ci failed (exit $npmExit)." }
    }
    if (-not (Test-Path -LiteralPath $localPlaywrightCli)) { throw 'Local Playwright CLI missing after dependency check.' }

    $phase = 'installing pinned Chromium'
    Write-Host "Checking the Chromium browser for Playwright $expected..."
    $browserExit = Invoke-Logged -Executable $node -Arguments @($localPlaywrightCli, 'install', 'chromium') -LogName 'browser-install.log'
    if ($browserExit -ne 0) { throw "Pinned Chromium installation failed (exit $browserExit)." }

    $phase = 'running Firebase emulator regression'
    # Existing Playwright outputs are moved aside, then restored when the ZIP is ready.
    foreach ($name in @('playwright-report', 'test-results')) {
        $source = Join-Path $repo $name
        if (Test-Path -LiteralPath $source) {
            $backup = Join-Path $work ('previous-' + $name)
            Move-Item -LiteralPath $source -Destination $backup
            $priorReports += @{ Name = $name; Backup = $backup }
        }
    }
    Write-Host 'Running the existing emulator-isolated E2E launcher...'
    $started = $true
    $testExit = Invoke-Logged -Executable 'powershell.exe' -Arguments @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher, '-Suite', $Suite
    ) -LogName 'e2e-run.log'
    if ($testExit -ne 0) { throw "E2E suite failed (exit $testExit). See e2e-run.log and test artifacts." }
    $phase = 'completed tests'
} catch {
    $errorMessage = [string]$_.Exception.Message
    Write-Host "Diagnostic result: $errorMessage"
} finally {
    try {
        if ($started) {
            foreach ($name in @('playwright-report', 'test-results')) {
                $source = Join-Path $repo $name
                if (Test-Path -LiteralPath $source) {
                    Copy-Item -LiteralPath $source -Destination (Join-Path $bundle $name) -Recurse -Force
                }
            }
        }
        $commit = ''
        try { $commit = [string](& git.exe -C $repo rev-parse HEAD 2>$null | Select-Object -First 1) } catch { }
        $status = if ($started -and $testExit -eq 0 -and -not $errorMessage) { 'PASS' } else { 'FAIL_OR_INCOMPLETE' }
        $summary = [ordered]@{
            app = 'Chaotic Neutral Myco Tracker'
            timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
            suite = $Suite
            gitCommit = $commit
            status = $status
            phase = $phase
            npmInstallExitCode = $npmExit
            chromiumInstallExitCode = $browserExit
            e2eTestsStarted = $started
            e2eExitCode = $testExit
            error = $errorMessage
            isolation = 'Local Firebase Auth, Firestore, Storage, and Functions emulators'
        }
        $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundle 'summary.json') -Encoding UTF8
        @"
MYCO TRACKER E2E DIAGNOSTIC REPORT
=================================
Status: $status
Suite: $Suite
Git commit: $commit
Phase: $phase
Dependencies install exit: $npmExit
Chromium install exit: $browserExit
E2E tests started: $started
E2E test exit: $testExit
Error: $errorMessage

Upload this ENTIRE ZIP to ChatGPT. Do not paste the script into PowerShell.
Test logs: e2e-run.log
Screenshots, videos, traces: test-results folder (when produced)
Interactive HTML report: playwright-report folder (when produced)
Auth state, .env files, and secret configuration are excluded.
Review screenshots and attachments before sharing outside this chat.
"@ | Set-Content -LiteralPath (Join-Path $bundle 'READ-ME.txt') -Encoding UTF8

        Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
        if (-not (Test-Path -LiteralPath $zipPath)) { throw 'ZIP was not created.' }
        $reportPackaged = $true
        Write-Host ''
        Write-Host "RESULT: $status"
        Write-Host "UPLOAD THIS ONE FILE: $zipPath"
    } catch {
        Write-Host "Report packaging failed: $($_.Exception.Message)"
        Write-Host "Unpacked diagnostics are in: $bundle"
    }

    if ($reportPackaged) {
        # Restore the previous reports; keep the newly produced report only inside Downloads ZIP.
        if ($started -or $priorReports.Count -gt 0) {
            foreach ($name in @('playwright-report', 'test-results')) {
                $backedUp = @($priorReports | Where-Object { $_.Name -eq $name }).Count -gt 0
                if ($started -or $backedUp) {
                    $current = Join-Path $repo $name
                    if (Test-Path -LiteralPath $current) { Remove-Item -LiteralPath $current -Recurse -Force }
                }
            }
            foreach ($item in $priorReports) {
                Move-Item -LiteralPath $item.Backup -Destination (Join-Path $repo $item.Name)
            }
        }
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}

if (-not $reportPackaged -or $errorMessage -or $testExit -ne 0) { exit 1 }
exit 0
