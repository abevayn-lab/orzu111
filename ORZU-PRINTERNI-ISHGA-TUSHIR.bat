@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js topilmadi. Node.js LTS ni o'rnating.
  pause
  exit /b 1
)
node orzu-printer-bridge.js %*
pause
