# scripts/Stop-Emulators.ps1
# Cleanly free Firebase Emulator ports and kill stray processes.
# Safe to re-run. Only targets typical emulator ports for your project.

$ports = 4000, 4400, 4500, 8080, 9150, 9199

function Stop-PortOwner {
  param([int]$Port)
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($pid in $pids) {
        try {
          $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
          if ($proc) {
            Write-Host "Stopping PID $pid ( $($proc.ProcessName) ) on port $Port..."
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
          }
        } catch {}
      }
    }
  } catch {}
}

# Kill by ports (primary)
foreach ($p in $ports) { Stop-PortOwner -Port $p }

# Best-effort cleanup of emulator child processes
Get-Process node, java -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -match "firebase-tools|cloud-firestore-emulator|cloud-storage-rules-runtime"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Firebase emulators stopped (ports freed): $($ports -join ', ')"
