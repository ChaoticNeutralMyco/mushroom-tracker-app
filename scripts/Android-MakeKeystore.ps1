<# Creates a release keystore and prints how to add GH secrets.
   Output: android\keystore\myco-release.keystore and .b64
#>
param(
  [string]$Alias = "myco",
  [string]$KeystorePath = "android\keystore\myco-release.keystore",
  [string]$DName = "CN=Mushroom Tracker,O=Chaotic Neutral,L=Local,S=CO,C=US",
  [int]$ValidityDays = 36500,
  [string]$Password = $env:ANDROID_KEYSTORE_PASSWORD
)

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $KeystorePath
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Find keytool
$keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
if (-not (Test-Path $keytool)) { $keytool = "keytool" }

if (-not $Password) {
  $Password = Read-Host -AsSecureString "Enter keystore password" | ForEach-Object { [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }
}

# Create keystore
& $keytool -genkeypair -v `
  -keystore $KeystorePath `
  -storepass $Password `
  -keypass $Password `
  -alias $Alias `
  -keyalg RSA -keysize 2048 `
  -validity $ValidityDays `
  -dname "$DName"

# Emit base64 for GitHub secrets
$b64Path = "$KeystorePath.b64"
[IO.File]::WriteAllText($b64Path, [Convert]::ToBase64String([IO.File]::ReadAllBytes($KeystorePath)))

Write-Host "`nKeystore created:" -ForegroundColor Green
Write-Host "  $KeystorePath"
Write-Host "Base64 file:" -ForegroundColor Green
Write-Host "  $b64Path"

Write-Host "`nAdd these GitHub Secrets for CI signing:" -ForegroundColor Cyan
Write-Host "  ANDROID_KEYSTORE_B64 = (contents of $b64Path)"
Write-Host "  ANDROID_KEYSTORE_ALIAS = $Alias"
Write-Host "  ANDROID_KEYSTORE_PASSWORD = <your password>"
