# scripts/test-subscription-e2e.ps1

param(
    [ValidateSet("subscription", "lifecycle", "sop", "regression")]
    [string]$Suite = "subscription",

    [string]$Reporter = ""
)

$ErrorActionPreference = "Stop"
if ($Reporter -and $Reporter -notin @("line", "list", "dot")) {
    throw "Unsupported Playwright reporter: $Reporter"
}

Set-StrictMode -Version Latest

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$functions = Join-Path $repo "functions"
$projectId = "chaotic-neutral-tracker"

Set-Location $repo

# These suites must never touch production Firebase data.
$env:DEV_PORT = "5180"
$env:E2E_REQUIRE_FIREBASE_EMULATORS = "true"
$env:E2E_REQUIRE_FUNCTIONS_EMULATOR = "true"
$env:VITE_USE_FIREBASE_EMULATORS = "true"
$env:VITE_USE_AUTH_EMULATOR = "true"
$env:VITE_USE_FUNCTIONS_EMULATOR = "true"
$env:VITE_E2E_FAKE_BILLING = "true"
$env:VITE_EMULATOR_FIRESTORE_PORT = "8080"
$env:VITE_EMULATOR_STORAGE_PORT = "9199"
$env:VITE_EMULATOR_AUTH_PORT = "9099"
$env:VITE_EMULATOR_FUNCTIONS_PORT = "5001"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:FUNCTIONS_EMULATOR_HOST = "127.0.0.1:5001"
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60000"
$env:GCLOUD_PROJECT = $projectId

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required to bootstrap the pinned local emulator toolchain."
}

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw "Java is required by the Firestore emulator and was not found in PATH."
}

if (-not (Test-Path -LiteralPath (Join-Path $functions "package.json"))) {
    throw "Missing functions/package.json. Apply the trusted subscription backend files first."
}

# Use the same pinned Node/Firebase CLI toolchain as the backend emulator suite
# so browser tests exercise the Node 22 production runtime instead of whichever
# Node version happens to be installed globally.
$nodeVersion = "22.23.1"
$npmVersion = "11.9.0"
$firebaseToolsVersion = "15.24.0"
$toolsRoot = Join-Path $env:LOCALAPPDATA "ChaoticNeutralMyco\subscription-backend-tools"
$toolsPackageJson = Join-Path $toolsRoot "package.json"
$toolsNodeModules = Join-Path $toolsRoot "node_modules"

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
$node22 = $node22Candidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
$npmCli = Join-Path $toolsRoot "node_modules\npm\bin\npm-cli.js"
$firebaseCli = Join-Path $toolsRoot "node_modules\firebase-tools\lib\bin\firebase.js"

if (
    -not $node22 -or
    -not (Test-Path -LiteralPath $npmCli) -or
    -not (Test-Path -LiteralPath $firebaseCli)
) {
    npm --prefix $toolsRoot install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install the pinned Node 22/Firebase CLI emulator toolchain."
    }

    $node22 = $node22Candidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}

if (
    -not $node22 -or
    -not (Test-Path -LiteralPath $npmCli) -or
    -not (Test-Path -LiteralPath $firebaseCli)
) {
    throw "Pinned browser-test tools were not installed correctly under: $toolsRoot"
}

$originalPath = $env:PATH
$node22Bin = Split-Path -Parent $node22
$env:PATH = "$node22Bin;$originalPath"

try {
    $actualNodeVersion = (& $node22 -p "process.version").Trim()
    $actualNodeMajor = [int](($actualNodeVersion -replace '^v', '').Split('.')[0])

    if ($actualNodeMajor -ne 22) {
        throw "Expected pinned Node.js 22, received $actualNodeVersion."
    }

    Write-Host "Using Node $actualNodeVersion for Functions and browser emulator tests."

    $functionsRuntimePackage = Join-Path $functions "node_modules\firebase-functions\package.json"
    if (-not (Test-Path -LiteralPath $functionsRuntimePackage)) {
        & $node22 $npmCli --prefix $functions ci --omit=optional --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "Functions dependency installation failed."
        }
    }

    $authState = Join-Path $repo "tests\e2e\.auth\user.json"
    Remove-Item -LiteralPath $authState -Force -ErrorAction SilentlyContinue

    $testFiles = switch ($Suite) {
        "subscription" { @("tests/e2e/subscription-access.spec.ts") }
        "lifecycle" { @("tests/e2e/grow-lifecycle.spec.ts") }
        "sop" { @("tests/e2e/sop-workflow.spec.ts") }
        "regression" {
            @(
                "tests/e2e/grow-lifecycle.spec.ts",
                "tests/e2e/sop-workflow.spec.ts"
            )
        }
    }

    $quotedTests = ($testFiles | ForEach-Object { "`"$_`"" }) -join " "
    $reporterArgument = if ($Reporter) { " --reporter=$Reporter" } else { "" }
    $playwrightCommand = (
        "`"$node22`" `"$npmCli`" exec -- playwright test " +
        $quotedTests +
        " --workers=1" +
        $reporterArgument
    )

    & $node22 $firebaseCli emulators:exec `
        --config firebase.json `
        --project $projectId `
        --only "auth,firestore,storage,functions" `
        $playwrightCommand

    if ($LASTEXITCODE -ne 0) {
        throw "Firebase emulator browser suite failed: $Suite"
    }
} finally {
    $env:PATH = $originalPath
}
