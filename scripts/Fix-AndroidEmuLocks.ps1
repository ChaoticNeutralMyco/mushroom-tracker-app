# Best-effort cleanup of stale lock files in the default .android folder.
# Not strictly required when using the portable-home, but handy if needed.

$and = Join-Path $env:USERPROFILE '.android'
Write-Host "Clearing stale emulator locks in $and ..." -ForegroundColor Cyan
try {
  Get-ChildItem $and -Filter '*.lock' -Recurse -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
  Write-Host "Android emulator locks cleared." -ForegroundColor Green
} catch {
  Write-Warning "Could not clear some locks: $($_.Exception.Message)"
}
