# scripts/Install-QueryDeps.ps1
# Installs TanStack Query + persist client + idb-keyval (safe if re-run)
# Shell: PowerShell (normal) | Working dir: project root

$pm = "npm"
if (Test-Path "pnpm-lock.yaml") {
  $pm = "pnpm"
} elseif (Test-Path "yarn.lock") {
  $pm = "yarn"
}

if ($pm -eq "pnpm") {
  pnpm add @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-sync-storage-persister idb-keyval
} elseif ($pm -eq "yarn") {
  yarn add @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-sync-storage-persister idb-keyval
} else {
  npm install @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-sync-storage-persister idb-keyval --save
}
