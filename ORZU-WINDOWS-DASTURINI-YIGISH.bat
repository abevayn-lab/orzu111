@echo off
chcp 65001 >nul
title ORZU KASSA - WINDOWS DASTURINI YIG'ISH
cd /d "%~dp0"

echo.
echo ==========================================
echo      ORZU KASSA - WINDOWS SETUP
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo XATO: Node.js topilmadi.
  echo Node.js 22 LTS o'rnating: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo XATO: npm topilmadi. Node.js ni qayta o'rnating.
  pause
  exit /b 1
)

echo [1/2] Kerakli kutubxonalar o'rnatilmoqda...
call npm install
if errorlevel 1 (
  echo XATO: npm install bajarilmadi.
  pause
  exit /b 1
)

echo.
echo [2/2] ORZU KASSA Windows o'rnatish fayli yig'ilmoqda...
call npm run dist:win
if errorlevel 1 (
  echo XATO: Windows dasturini yig'ishda muammo yuz berdi.
  pause
  exit /b 1
)

echo.
echo TAYYOR! O'rnatish fayli release papkasida.
echo ORZU-KASSA-Setup-1.0.0.exe faylini ishga tushiring.
pause
