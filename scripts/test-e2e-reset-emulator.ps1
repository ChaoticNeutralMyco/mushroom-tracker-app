# scripts/test-e2e-reset-emulator.ps1
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$env:DEV_PORT = "5179"
$env:VITE_USE_FIREBASE_EMULATORS = "true"
$env:VITE_EMULATOR_FIRESTORE_PORT = "8080"
$env:VITE_EMULATOR_STORAGE_PORT = "9199"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199"

npx --yes firebase-tools emulators:exec `
  --config firebase.e2e.json `
  --project chaotic-neutral-tracker `
  --only firestore,storage `
  "npx playwright test tests/e2e/setup.auth.ts tests/e2e/reset-direct.spec.ts --workers=1"

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}