#!/usr/bin/env bash
set -euo pipefail

if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Commit or stash your changes first."
  exit 1
fi

NEW_VER=${1:-}
if [[ -z "$NEW_VER" ]]; then
  echo "Current version: $(node -p "require('./package.json').version")"
  read -rp "Next version (e.g. 1.2.3): " NEW_VER
fi

if [[ ! "$NEW_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid semver."
  exit 1
fi

npm version "$NEW_VER" --no-git-tag-version
git add package.json
git commit -m "chore(release): v$NEW_VER"
git tag "v$NEW_VER"
git push origin HEAD --tags

echo "✅ Pushed tag v$NEW_VER. GitHub Actions will build web + MSI."
