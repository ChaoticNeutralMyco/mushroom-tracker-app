@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-MycoCamAvd.ps1" %*
endlocal
