<#! 
Pack-src-tauri.ps1 — Create a clean, upload-friendly archive of src-tauri
- Produces a timestamped ZIP in the project root
- Excludes heavy build artifacts by default (Lean mode)
- Optionally include Android gen project (without build caches)
- Writes a MANIFEST and SHA256 alongside the ZIP and also embeds the MANIFEST into the ZIP

USAGE (from project root):
  powershell -ExecutionPolicy Bypass -File .\scripts\Pack-src-tauri.ps1 -Mode Lean
  # Or include the Android gen project (still excludes build caches):
  powershell -ExecutionPolicy Bypass -File .\scripts\Pack-src-tauri.ps1 -Mode Full -IncludeGen
#>

[CmdletBinding()]
param(
  [ValidateSet('Lean','Full')]
  [string]$Mode = 'Lean',
  [string]$Out,
  [switch]$IncludeGen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-RelativePath([string]$Root, [string]$Full) {
  $rootPath = (Resolve-Path -LiteralPath $Root).Path
  $fullPath = (Resolve-Path -LiteralPath $Full).Path
  if ($rootPath -notmatch '[\\/]$') { $rootPath = $rootPath + [IO.Path]::DirectorySeparatorChar }
  $uRoot = New-Object System.Uri($rootPath)
  $uFull = New-Object System.Uri($fullPath)
  $relUri = $uRoot.MakeRelativeUri($uFull)
  $rel = [System.Uri]::UnescapeDataString($relUri.ToString())
  $rel = $rel -replace '\\','/'
  return $rel
}

function Test-MatchAny([string]$path, [string[]]$patterns) {
  $n = $path -replace '\\','/'
  foreach ($p in $patterns) { $pp = $p -replace '\\','/'; if ($n -like $pp) { return $true } }
  return $false
}

$invocationDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $invocationDir 'src-tauri')) {
  $projRoot = $invocationDir
} elseif (Test-Path (Join-Path (Split-Path -Parent $invocationDir) 'src-tauri')) {
  $projRoot = (Split-Path -Parent $invocationDir)
} elseif (Test-Path 'src-tauri') {
  $projRoot = (Resolve-Path '.').Path
} else { throw 'Run this from the repo root or keep it inside scripts/. src-tauri not found.' }

$srcDir = Join-Path $projRoot 'src-tauri'
if (-not (Test-Path $srcDir)) { throw "Missing folder: $srcDir" }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($Out)) {
  $zipName = "src-tauri.bundle.$Mode.$timestamp.zip"
  $OutPath = Join-Path $projRoot $zipName
} else {
  $OutResolved = Resolve-Path -LiteralPath $Out -ErrorAction SilentlyContinue
  if ($OutResolved) {
    if ((Get-Item $OutResolved.Path).PSIsContainer) { $OutPath = Join-Path $OutResolved.Path "src-tauri.bundle.$Mode.$timestamp.zip" }
    else { $OutPath = $OutResolved.Path }
  } else {
    $parent = Split-Path -Parent $Out
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if ($Out.ToLower().EndsWith('.zip')) { $OutPath = $Out } else { $OutPath = Join-Path $Out "src-tauri.bundle.$Mode.$timestamp.zip" }
  }
}

$excludeAllGen = ($Mode -eq 'Lean' -and -not $IncludeGen)
$excludePatterns = @(
  'target/*','**/node_modules/*','**/.git/*','**/.idea/*','**/.vscode/*','**/.DS_Store','**/Thumbs.db',
  '**/.gradle/*','**/.cxx/*','**/build/*','**/intermediates/*','**/outputs/*','**/captures/*','**/*.iml',
  'gen/**/build/*','gen/**/.gradle/*','gen/**/intermediates/*','gen/**/outputs/*'
)
if ($excludeAllGen) { $excludePatterns += 'gen/*' }

$allFiles = Get-ChildItem -LiteralPath $srcDir -Recurse -File -Force
$files = foreach ($f in $allFiles) { $rel = New-RelativePath -Root $srcDir -Full $f.FullName; if (-not (Test-MatchAny -path $rel -patterns $excludePatterns)) { $f } }
if (-not $files -or $files.Count -eq 0) { throw 'No files selected for packaging (filters too strict?)' }

$manifestPath = Join-Path $projRoot "src-tauri.bundle.$Mode.$timestamp.MANIFEST.txt"
$manifest = @("Myco Tracker — src-tauri bundle","Mode: $Mode  | IncludeGen: $IncludeGen","Created: $(Get-Date -Format s)","Root: $srcDir",'','Files:')
$totBytes = 0
foreach ($f in $files) { $rel = New-RelativePath -Root $srcDir -Full $f.FullName; $totBytes += $f.Length; $manifest += ("  " + $rel + "  (" + [math]::Round($f.Length/1MB,2) + ' MB)') }
$manifest += ''; $manifest += ('Total files: ' + $files.Count); $manifest += ('Total size:  ' + [math]::Round($totBytes/1MB,2) + ' MB (pre-compress)')
$manifest | Set-Content -LiteralPath $manifestPath -Encoding UTF8 -NoNewline:$false

$zipModeType = [Type]::GetType('System.IO.Compression.ZipArchiveMode, System.IO.Compression')
$useCompressArchive = $false
if (-not $zipModeType) { try { Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop; Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop; $zipModeType = [Type]::GetType('System.IO.Compression.ZipArchiveMode, System.IO.Compression'); if (-not $zipModeType) { $useCompressArchive = $true } } catch { $useCompressArchive = $true } }

if (-not $useCompressArchive) {
  if (Test-Path $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
  $zip = [System.IO.Compression.ZipFile]::Open($OutPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $manifestEntry = $zip.CreateEntry('BUNDLE-MANIFEST.txt', [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = New-Object System.IO.StreamWriter($manifestEntry.Open()); try { $manifest | ForEach-Object { $writer.WriteLine($_) } } finally { $writer.Dispose() }
    foreach ($f in $files) { $rel = New-RelativePath -Root $srcDir -Full $f.FullName; [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$f.FullName,$rel,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null }
  } finally { $zip.Dispose() }
} else {
  $stage = Join-Path ([IO.Path]::GetTempPath()) ("mtas_" + [guid]::NewGuid().ToString('N').Substring(0,8))
  if (Test-Path $stage) { Remove-Item -Recurse -Force -LiteralPath $stage }
  New-Item -ItemType Directory -Path $stage | Out-Null
  foreach ($f in $files) {
    $rel = New-RelativePath -Root $srcDir -Full $f.FullName
    $dest = Join-Path $stage ($rel -replace '/','\')
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    try { Copy-Item -LiteralPath $f.FullName -Destination $dest -Force } catch { $manifest += ("  [SKIPPED due to path issue] " + $rel) }
  }
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stage 'BUNDLE-MANIFEST.txt') -Force
  if (Test-Path $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $OutPath -Force
  Remove-Item -Recurse -Force -LiteralPath $stage
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $OutPath
$hashPath = $OutPath + '.sha256'
("{0}  {1}" -f $hash.Hash, (Split-Path -Leaf $OutPath)) | Set-Content -LiteralPath $hashPath -Encoding ASCII

Write-Host "`nCreated: $OutPath" -ForegroundColor Green
Write-Host ("Size:    {0} MB" -f ([math]::Round((Get-Item $OutPath).Length/1MB,2)))
Write-Host "SHA256:  $($hash.Hash) (saved to $(Split-Path -Leaf $hashPath))"
Write-Host ("Files:   {0} (pre-compress {1} MB)" -f $files.Count, [math]::Round($totBytes/1MB,2))
Write-Host "Manifest: $manifestPath"
