# scripts/test-subscription-backend.ps1

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$functions = Join-Path $project "functions"
$projectId = if ($env:GCLOUD_PROJECT) { $env:GCLOUD_PROJECT } else { "chaotic-neutral-tracker" }

# Pin the exact local test toolchain so the Functions emulator and every
# backend test process run under the same Node 22 major used in production.
$nodeVersion = "22.23.1"
$npmVersion = "11.9.0"
$firebaseToolsVersion = "15.24.0"
$toolsRoot = Join-Path $env:LOCALAPPDATA "ChaoticNeutralMyco\subscription-backend-tools"
$toolsPackageJson = Join-Path $toolsRoot "package.json"
$toolsNodeModules = Join-Path $toolsRoot "node_modules"

Set-Location $project

if (-not (Test-Path -LiteralPath (Join-Path $functions "package.json"))) {
    throw "Missing functions/package.json. Apply the complete Step 25 package first."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required to bootstrap the pinned Node 22 test toolchain."
}

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw "Java is required by the Firebase Firestore emulator."
}

$toolManifest = [ordered]@{
    name = "cnm-subscription-backend-tools"
    version = "1.0.0"
    private = $true
    dependencies = [ordered]@{
        "firebase-tools" = $firebaseToolsVersion
        "node" = $nodeVersion
        "npm" = $npmVersion
    }
}

$toolManifestJson = $toolManifest | ConvertTo-Json -Depth 5
$existingToolManifest = if (Test-Path -LiteralPath $toolsPackageJson) {
    Get-Content -LiteralPath $toolsPackageJson -Raw
} else {
    ""
}

if ($existingToolManifest.Trim() -ne $toolManifestJson.Trim()) {
    Remove-Item -LiteralPath $toolsNodeModules -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $toolsRoot "package-lock.json") -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
    Set-Content -LiteralPath $toolsPackageJson -Value $toolManifestJson -Encoding UTF8
}

$node22Candidates = @(
    (Join-Path $toolsRoot "node_modules\node\bin\node.exe"),
    (Join-Path $toolsRoot "node_modules\node\bin\node")
)
$node22 = $node22Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$npmCli = Join-Path $toolsRoot "node_modules\npm\bin\npm-cli.js"
$firebaseCli = Join-Path $toolsRoot "node_modules\firebase-tools\lib\bin\firebase.js"

if (-not $node22 -or -not (Test-Path -LiteralPath $npmCli) -or -not (Test-Path -LiteralPath $firebaseCli)) {
    # Tool bootstrap only writes beneath LOCALAPPDATA and is safe to rerun.
    npm --prefix $toolsRoot install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install the pinned Node 22/Firebase CLI test toolchain."
    }

    $node22 = $node22Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $node22 -or -not (Test-Path -LiteralPath $npmCli) -or -not (Test-Path -LiteralPath $firebaseCli)) {
    throw "Pinned backend test tools were not installed correctly under: $toolsRoot"
}

$originalPath = $env:PATH
$originalDiscoveryTimeout = $env:FUNCTIONS_DISCOVERY_TIMEOUT
$originalFunctionsEmulatorHost = $env:CNM_FUNCTIONS_EMULATOR_HOST
$node22Bin = Split-Path -Parent $node22
$env:PATH = "$node22Bin;$originalPath"

try {
    $actualNodeVersion = (& $node22 -p "process.version").Trim()
    $actualNodeMajor = [int](($actualNodeVersion -replace '^v', '').Split('.')[0])

    if ($actualNodeMajor -ne 22) {
        throw "Expected pinned Node.js 22, received $actualNodeVersion."
    }

    Write-Host "Using Node $actualNodeVersion for Functions install, tests, and emulators."

    # Reproduce the exact backend lockfile while omitting unused optional Admin
    # SDK service trees. Firestore remains explicit in functions/package.json.
    & $node22 $npmCli --prefix $functions ci --omit=optional --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Functions dependency installation failed." }

    & $node22 $npmCli --prefix $functions run check:runtime
    if ($LASTEXITCODE -ne 0) { throw "Functions Node runtime check failed." }

    & $node22 $npmCli --prefix $functions run check
    if ($LASTEXITCODE -ne 0) { throw "Functions syntax check failed." }

    & $node22 $npmCli --prefix $functions test
    if ($LASTEXITCODE -ne 0) { throw "Functions unit tests failed." }

    # Report runtime advisories without applying unsafe forced overrides.
    # A confirmed critical finding fails the run. A temporary registry/audit
    # outage is surfaced as a warning rather than breaking emulator coverage.
    $auditJsonPath = Join-Path $env:TEMP "cnm-functions-audit.json"
    $auditErrorPath = Join-Path $env:TEMP "cnm-functions-audit-error.txt"
    Remove-Item -LiteralPath $auditJsonPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $auditErrorPath -Force -ErrorAction SilentlyContinue

    & $node22 $npmCli --prefix $functions audit `
        --omit=dev `
        --omit=optional `
        --audit-level=critical `
        --json 1> $auditJsonPath 2> $auditErrorPath

    $auditExitCode = $LASTEXITCODE
    $auditParsed = $null

    if (Test-Path -LiteralPath $auditJsonPath) {
        try {
            $auditParsed = Get-Content -LiteralPath $auditJsonPath -Raw | ConvertFrom-Json
        } catch {
            $auditParsed = $null
        }
    }

    if ($auditParsed -and $auditParsed.metadata -and $auditParsed.metadata.vulnerabilities) {
        $counts = $auditParsed.metadata.vulnerabilities
        Write-Host ("Runtime audit: low={0} moderate={1} high={2} critical={3}" -f `
            [int]$counts.low, `
            [int]$counts.moderate, `
            [int]$counts.high, `
            [int]$counts.critical)

        if ([int]$counts.critical -gt 0) {
            throw "A critical production-runtime dependency advisory was found."
        }
    } elseif ($auditExitCode -ne 0) {
        $auditError = if (Test-Path -LiteralPath $auditErrorPath) {
            (Get-Content -LiteralPath $auditErrorPath -Raw).Trim()
        } else {
            "No audit details were returned."
        }
        Write-Warning "npm audit could not complete. Backend tests will continue. $auditError"
    }

    # Defer Firebase Admin initialization during discovery and also provide a
    # larger CLI discovery window for first-run Windows dependency loading.
    $env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
    $env:CNM_FUNCTIONS_EMULATOR_HOST = "127.0.0.1:5001"

    # Starts local emulators only. The Firebase CLI itself and each spawned
    # Functions process run through the pinned Node 22 executable. Second-gen
    # scheduled functions are HTTP endpoints, so a Pub/Sub emulator is not used.
    $env:GCLOUD_PROJECT = $projectId
    $emulatorCommand = "`"$node22`" `"$npmCli`" --prefix `"$functions`" run test:emulator"

    & $node22 $firebaseCli emulators:exec `
        --project $projectId `
        --only "auth,firestore,functions" `
        $emulatorCommand

    if ($LASTEXITCODE -ne 0) {
        throw "Subscription backend emulator tests failed."
    }
} finally {
    $env:PATH = $originalPath

    if ($null -eq $originalDiscoveryTimeout) {
        Remove-Item Env:FUNCTIONS_DISCOVERY_TIMEOUT -ErrorAction SilentlyContinue
    } else {
        $env:FUNCTIONS_DISCOVERY_TIMEOUT = $originalDiscoveryTimeout
    }

    if ($null -eq $originalFunctionsEmulatorHost) {
        Remove-Item Env:CNM_FUNCTIONS_EMULATOR_HOST -ErrorAction SilentlyContinue
    } else {
        $env:CNM_FUNCTIONS_EMULATOR_HOST = $originalFunctionsEmulatorHost
    }
}
