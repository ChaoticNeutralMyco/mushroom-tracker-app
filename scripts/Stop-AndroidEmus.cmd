@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-AndroidEmus.ps1" %*
endlocal
