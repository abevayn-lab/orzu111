@echo off
chcp 65001 >nul
title ORZU KASSA ISHGA TUSHIRISH
cd /d "%~dp0"

echo.
echo ==========================================
echo       ORZU RESTORAN - KASSA
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo XATO: Node.js topilmadi.
  echo Avval Node.js LTS ni o'rnating.
  pause
  exit /b 1
)

REM Printer bridge ishlayotganini tekshirish
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:17891/health' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul

if errorlevel 1 (
  echo Printer xizmati ishga tushirilmoqda...
  start "ORZU PRINTER XIZMATI" cmd /k "cd /d ""%~dp0"" && node orzu-printer-bridge.js %*"
  timeout /t 3 /nobreak >nul
) else (
  echo Printer xizmati avvaldan ishlab turibdi.
)

echo Kassa sahifasi ochilmoqda...
start "" "https://orzu111-production.up.railway.app/cashier"

echo.
echo Tayyor! Kassa oynasiga kirib ishlatishingiz mumkin.
echo Printer terminal oynasini yopmang.
timeout /t 5
exit
