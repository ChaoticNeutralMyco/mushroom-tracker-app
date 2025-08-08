$ErrorActionPreference = "Stop"

$dirty = git status --porcelain
if ($dirty) { throw "Commit or stash your changes first." }

if ($args.Count -gt 0) { $newver = $args[0] } else {
  $cur = node -e "console.log(require('./package.json').version)"
  Write-Host "Current version: $cur"
  $newver = Read-Host "Next version (e.g. 1.2.3)"
}

if (-not ($newver -match '^\d+\.\d+\.\d+$')) { throw "Invalid semver." }

npm version $newver --no-git-tag-version
git add package.json
git commit -m "chore(release): v$newver"
git tag "v$newver"
git push origin HEAD --tags
Write-Host "✅ Pushed tag v$newver. GitHub Actions will build web + MSI."
