<#  Build Windows installer (Tauri) and copy MSI to .\release\windows
    Requirements:
      - Node 20.x
      - Rust toolchain (stable)
      - Visual Studio 2022 BuildTools (C++ workload)
      - WiX Toolset v3 (Tauri uses WiX for MSI)
    Safe to re-run.
#>

$ErrorActionPreference = "Stop"

# PowerShell 5-safe: only touch PSStyle on PS7+
if ($PSVersionTable.PSVersion.Major -ge 7) {
  try { $global:PSStyle.OutputRendering = "PlainText" } catch {}
}

# Project root (script lives in /scripts)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "`n==> Building Vite app (web)..." -ForegroundColor Cyan
npm ci --no-audit | Out-Host
npm run build | Out-Host

Write-Host "`n==> Ensuring Rust & Tauri CLI..." -ForegroundColor Cyan
# Rustup (skip if present)
if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
  Write-Host "Installing rustup..." -ForegroundColor Yellow
  $tmp = Join-Path $env:TEMP "rustup-init.exe"
  Invoke-WebRequest https://win.rustup.rs/x86_64 -OutFile $tmp
  Start-Process -FilePath $tmp -ArgumentList "-y" -NoNewWindow -Wait
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
rustup default stable | Out-Host

# Tauri CLI via npx is fine; this checks it runs
npx tauri -V 2>$null | Out-Null

Write-Host "`n==> Checking prerequisites (WiX)..." -ForegroundColor Cyan
# WiX (candle.exe) in PATH?
if (-not (Get-Command candle.exe -ErrorAction SilentlyContinue)) {
  try {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Host "Installing WiX Toolset via winget..." -ForegroundColor Yellow
      winget install --id "WiXToolset.WiXToolset" -e --accept-package-agreements --accept-source-agreements | Out-Null
    } else {
      Write-Host "Winget not available. Please install WiX Toolset v3 manually if build fails." -ForegroundColor Yellow
    }
  } catch {
    Write-Host "WiX install check skipped." -ForegroundColor Yellow
  }
}

Write-Host "`n==> Building Tauri bundle..." -ForegroundColor Cyan
# Tauri v2+: produces MSI under src-tauri\target\release\bundle\msi\
npx tauri build | Out-Host

# Collect artifacts
$bundleRoot = Join-Path $root "src-tauri\target\release\bundle"
$msiDir = Join-Path $bundleRoot "msi"
$exeDir = Join-Path $bundleRoot "windows"   # portable exe (if produced)
$releaseOut = Join-Path $root "release\windows"
New-Item -ItemType Directory -Force -Path $releaseOut | Out-Null

$copied = @()

if (Test-Path $msiDir) {
  Get-ChildItem $msiDir -Filter *.msi |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 |
    ForEach-Object {
      Copy-Item $_.FullName -Destination $releaseOut -Force
      $copied += $_.Name
    }
}

if (Test-Path $exeDir) {
  $portable = Get-ChildItem $exeDir -Include *.exe -Recurse |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($portable) {
    Copy-Item $portable.FullName -Destination $releaseOut -Force
    $copied += $portable.Name
  }
}

Write-Host "`n==> Windows artifacts copied to: $releaseOut" -ForegroundColor Green
$copied | ForEach-Object { Write-Host " - $_" }

Write-Host "`nOpen folder:" -ForegroundColor Cyan
try { Invoke-Item $releaseOut } catch {}
