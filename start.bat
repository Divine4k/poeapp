@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing, this takes a few minutes the first time...
  call npm install
  if errorlevel 1 (
    echo Install failed. Check your internet connection and run this file again.
    pause
    exit /b 1
  )
)
rem Start the app on its own, so this window closes straight away.
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "%~dp0."
) else (
  call npm start
)
