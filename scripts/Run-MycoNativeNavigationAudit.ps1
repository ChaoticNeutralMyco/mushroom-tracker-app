# scripts/Run-MycoNativeNavigationAudit.ps1
# Build-only verification. No app launch, release signing, deployment, or data reset.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = "$(Get-Date -Format yyyyMMdd-HHmmss)-$PID"
$work = Join-Path $env:TEMP "CNM-Navigation-$stamp"
$stage = Join-Path $work 'report'
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$report = Join-Path $downloads "MycoTracker-Navigation-Report-$stamp.zip"
$oldSigning = $env:MYCO_ANDROID_SIGNING_PROPERTIES
$results = [ordered]@{
    status = 'FAIL'
    sourceNavigation = 'NOT_RUN'
    webBuild = 'NOT_RUN'
    capacitorCopy = 'NOT_RUN'
    generatedNavigation = 'NOT_RUN'
    debugBuild = 'NOT_RUN'
    apkNavigation = 'NOT_RUN'
    apkWebAssets = 'NOT_RUN'
    matchedAssets = 0
    originInventory = 'NOT_RUN'
    runtime = 'NOT_RUN'
    error = ''
}
New-Item -ItemType Directory -Path $stage,$downloads -Force | Out-Null

function Assert-NavigationConfig($config) {
    if ($config.appId -ne 'com.chaoticneutral.myco') { throw 'Unexpected application identifier.' }
    if ($config.server.androidScheme -ne 'https') { throw 'Unexpected Android scheme.' }
    if ($config.server.url) { throw 'Unexpected live-reload server URL.' }
    if (@($config.server.allowNavigation | Where-Object { $null -ne $_ }).Count -ne 0) {
        throw 'External WebView navigation is still allowed.'
    }
}

function Invoke-BuildStep {
    param([string]$Name,[string]$Executable,[string[]]$Arguments,[string]$Directory)
    Write-Host "Running $Name..."
    $log = Join-Path $work "$Name.local.log"
    $prior = $ErrorActionPreference
    Push-Location -LiteralPath $Directory
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = 0
        & $Executable @Arguments *> $log
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prior
        Pop-Location
    }
    # Raw output remains local, not in the uploadable report.
    "Exit code: $code`r`nLocal log: $log" | Set-Content -LiteralPath (Join-Path $stage "$Name.txt") -Encoding UTF8
    Write-Host "$Name exit code: $code"
    return [int]$code
}

function Get-HostInventory {
    # Export DNS hostnames and environment variable NAMES only; never URLs,
    # query strings, tokens, env file contents, source snippets, or user data.
    $files = @()
    $files += @(Get-ChildItem -LiteralPath (Join-Path $repo 'src') -Recurse -File | Where-Object { $_.Extension -in @('.js','.jsx','.ts','.tsx','.css','.html') })
    $files += Get-Item -LiteralPath (Join-Path $repo 'index.html')
    $files += @(Get-ChildItem -LiteralPath (Join-Path $repo 'public') -Recurse -File | Where-Object { $_.Extension -in @('.css','.html','.js','.webmanifest') })
    $files += @(Get-ChildItem -LiteralPath (Join-Path $repo 'dist') -Recurse -File | Where-Object { $_.Extension -in @('.js','.css','.html','.webmanifest') })
    $hosts = New-Object 'System.Collections.Generic.HashSet[string]'
    $envNames = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($file in $files) {
        $content = [System.IO.File]::ReadAllText($file.FullName)
        foreach ($m in [regex]::Matches($content,'(?i)\b(?:https?|wss?)://([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?=[:/\s"''?#`<>)]|$)')) {
            $hostname = $m.Groups[1].Value.ToLowerInvariant()
            if ($hostname -match '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$') { [void]$hosts.Add($hostname) }
        }
        foreach ($m in [regex]::Matches($content,'\bVITE_[A-Z0-9_]+\b')) { [void]$envNames.Add($m.Value) }
    }
    [ordered]@{
        staticHostnames = @($hosts | Sort-Object)
        environmentVariableNames = @($envNames | Sort-Object)
        note = 'Static source and built asset hostname inventory only. Includes documentation and library URLs; dynamic endpoints may be absent. No environment files read.'
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'csp-origin-inventory.json') -Encoding UTF8
}

try {
    Set-Location -LiteralPath $repo
    # Deliberately do not load real signing credentials in any Gradle task.
    $env:MYCO_ANDROID_SIGNING_PROPERTIES = Join-Path $work 'intentionally-missing.properties'
    $cap = Get-Content -LiteralPath (Join-Path $repo 'capacitor.config.json') -Raw | ConvertFrom-Json
    Assert-NavigationConfig $cap
    $results.sourceNavigation = 'PASS'

    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $capCli = Join-Path $repo 'node_modules\.bin\cap.cmd'
    if (-not (Test-Path -LiteralPath $capCli -PathType Leaf)) { throw 'Pinned local Capacitor CLI is missing. No dependencies were installed.' }
    if ((Invoke-BuildStep 'web-build' $npm @('run','build') $repo) -ne 0) { $results.webBuild = 'FAIL'; throw 'Web build failed. See local build log.' }
    $results.webBuild = 'PASS'
    Get-HostInventory
    $results.originInventory = 'PASS'
    if ((Invoke-BuildStep 'capacitor-copy' $capCli @('copy','android') $repo) -ne 0) { $results.capacitorCopy = 'FAIL'; throw 'Capacitor copy failed. See local build log.' }
    $results.capacitorCopy = 'PASS'
    $generatedPath = Join-Path $repo 'android\app\src\main\assets\capacitor.config.json'
    $generated = Get-Content -LiteralPath $generatedPath -Raw | ConvertFrom-Json
    Assert-NavigationConfig $generated
    $results.generatedNavigation = 'PASS'

    $android = Join-Path $repo 'android'
    $gradle = Join-Path $android 'gradlew.bat'
    if ((Invoke-BuildStep 'android-debug' $gradle @('--no-daemon','--no-configuration-cache','--console=plain',':app:assembleDebug') $android) -ne 0) { $results.debugBuild = 'FAIL'; throw 'Android debug build failed. See local build log.' }
    $results.debugBuild = 'PASS'
    $apk = Join-Path $android 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'Expected debug APK was not produced.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $entry = $archive.GetEntry('assets/capacitor.config.json')
        if ($null -eq $entry) { throw 'APK is missing its Capacitor configuration.' }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        try { $embedded = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        Assert-NavigationConfig $embedded
        $results.apkNavigation = 'PASS'
        $dist = (Resolve-Path -LiteralPath (Join-Path $repo 'dist')).Path
        $assetFiles = @(Get-Item -LiteralPath (Join-Path $dist 'index.html'))
        $assetFiles += @(Get-ChildItem -LiteralPath (Join-Path $dist 'assets') -Recurse -File)
        foreach ($asset in $assetFiles) {
            $relative = $asset.FullName.Substring($dist.Length + 1).Replace('\','/')
            $entry = $archive.GetEntry("assets/public/$relative")
            if ($null -eq $entry) { throw "APK missing built web asset: $relative" }
            $stream = $entry.Open()
            try { $actual = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash } finally { $stream.Dispose() }
            if ($actual -ne (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash) { throw "APK web asset hash mismatch: $relative" }
            $results.matchedAssets++
        }
        $results.apkWebAssets = 'PASS'
    } finally { $archive.Dispose() }
    $results.status = 'PASS'
} catch {
    # Avoid copying potentially sensitive exception text or raw build output into report.
    $results.error = 'A verification step failed. Review the console and local logs.'
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($null -eq $oldSigning) { Remove-Item Env:MYCO_ANDROID_SIGNING_PROPERTIES -ErrorAction SilentlyContinue }
    else { $env:MYCO_ANDROID_SIGNING_PROPERTIES = $oldSigning }
    $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'summary.json') -Encoding UTF8
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $report -Force
    Write-Host "STATUS: $($results.status)"
    Write-Host "Local logs (not uploaded): $work"
    Write-Host "UPLOAD THIS ONE ZIP: $report"
}
