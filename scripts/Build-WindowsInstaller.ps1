# scripts/Build-WindowsInstaller.ps1
# Package the configured Tauri NSIS target using the local locked CLI.
[CmdletBinding()]
param(
    [switch]$UnsignedAudit,
    [switch]$SkipDependencyInstall,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$cli = Join-Path $root 'node_modules\.bin\tauri.cmd'
$target = Join-Path $root 'src-tauri\target'
$bundle = Join-Path $target 'release\bundle\nsis'
$oldTarget = $env:CARGO_TARGET_DIR
$override = $null

function Invoke-Step([string]$Executable,[string[]]$Arguments) {
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments | Out-Host
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    if ($code -ne 0) { throw "Command failed (exit $code): $Executable $($Arguments -join ' ')" }
}

Push-Location -LiteralPath $root
try {
    $pkg = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    # Windows PowerShell 5.1 cannot deserialize package-lock's empty root key.
    $lockJson = & node.exe -e "const l=require('./package-lock.json');const p=l.packages;console.log(JSON.stringify({version:l.version,rootVersion:p[''].version,versions:Object.fromEntries(['@capacitor/core','@capacitor/cli','@capacitor/android','@tauri-apps/cli','vite'].map(k=>[k,p['node_modules/'+k].version]))}));"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the dependency lockfile.' }
    $lock = $lockJson | ConvertFrom-Json
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $cargoText = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw
    $cargoVersion = [regex]::Match($cargoText, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    $pkgHash = (Get-FileHash -LiteralPath 'package.json' -Algorithm SHA256).Hash
    $lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
    if ($pkg.version -ne $config.version -or $pkg.version -ne $cargoVersion -or $lock.version -ne $pkg.version -or $lock.rootVersion -ne $pkg.version) { throw 'Windows/package/lock version mismatch.' }
    if (@($config.bundle.targets).Count -ne 1 -or $config.bundle.targets[0] -ne 'nsis' -or -not $config.bundle.active) { throw 'Expected active NSIS bundle target.' }
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw 'Rust cargo must already be installed.' }
    if (-not $SkipDependencyInstall) { Invoke-Step $npm @('ci','--no-audit','--no-fund') }
    foreach ($name in @('@tauri-apps/cli','vite')) {
        $declared = $pkg.devDependencies.PSObject.Properties[$name].Value
        $locked = $lock.versions.PSObject.Properties[$name].Value
        $actual = (Get-Content -LiteralPath (Join-Path $root "node_modules/$name/package.json") -Raw | ConvertFrom-Json).version
        if ($declared -ne $locked -or $actual -ne $locked) { throw "Local $name does not match the pinned lockfile version." }
    }
    $env:CARGO_TARGET_DIR = $target
    $argsList = @('build','--bundles','nsis','--ci')
    if ($UnsignedAudit) {
        # Tauri's no-sign flag skips platform code signing; explicitly disable updater artifacts too.
        $override = Join-Path ([IO.Path]::GetTempPath()) ('myco-tauri-audit-' + [guid]::NewGuid().ToString('N') + '.json')
        [IO.File]::WriteAllText($override, '{"bundle":{"createUpdaterArtifacts":false}}')
        $argsList += @('--no-sign','--config',$override)
    }
    # The configured beforeBuildCommand builds Vite automatically.
    $started = [DateTime]::UtcNow
    Write-Host 'Building Tauri NSIS installer...'
    Invoke-Step $cli $argsList
    $setups = @(Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -ge $started -and $_.Name -match ('_' + [regex]::Escape([string]$pkg.version) + '_') })
    if ($setups.Count -ne 1) { throw "Expected exactly one newly generated NSIS setup for version $($pkg.version); found $($setups.Count)." }
    if ((Get-FileHash -LiteralPath 'package.json' -Algorithm SHA256).Hash -ne $pkgHash -or (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash -ne $lockHash) { throw 'Dependency manifest changed during packaging.' }
    if (-not $OutputDirectory) { $OutputDirectory = if ($UnsignedAudit) { Join-Path $root 'release\windows\unsigned-audit' } else { Join-Path $root 'release\windows' } }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $name = if ($UnsignedAudit) { $setups[0].BaseName + '-UNSIGNED-AUDIT.exe' } else { $setups[0].Name }
    $dest = Join-Path $OutputDirectory $name
    Copy-Item -LiteralPath $setups[0].FullName -Destination $dest -Force
    if ((Get-FileHash -LiteralPath $setups[0].FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash) { throw 'Installer copy verification failed.' }
    Write-Host "NSIS setup: $dest"
    if ($UnsignedAudit) {
        Write-Host 'UNSIGNED AUDIT ONLY - not approved for distribution.'
    } else {
        $signature = $setups[0].FullName + '.sig'
        if (-not (Test-Path -LiteralPath $signature -PathType Leaf) -or (Get-Item -LiteralPath $signature).LastWriteTimeUtc -lt $started) {
            throw 'Fresh signed updater artifact is missing.'
        }
        Copy-Item -LiteralPath $signature -Destination ($dest + '.sig') -Force
    }
} finally {
    if ($override) { Remove-Item -LiteralPath $override -Force -ErrorAction SilentlyContinue }
    if ($null -eq $oldTarget) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $oldTarget }
    Pop-Location
}
