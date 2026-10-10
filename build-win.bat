@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo  Klepsydra LAN Timer - Windows EXE Builder
echo ==============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required only to BUILD the EXE.
  echo Install Node.js LTS from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from example.
  echo IMPORTANT: edit .env now and set your own DASHBOARD_PIN (SESSION_SECRET is optional).
  notepad ".env"
  echo After saving .env, run build-win.bat again.
  pause
  exit /b 0
)
if not exist "node_modules" (
  echo Installing dependencies. Internet is required for this first build.
  call npm install
  if errorlevel 1 goto fail
) else (
  echo Checking dependencies...
  call npm install
  if errorlevel 1 goto fail
)
if not exist "dist" mkdir "dist"
echo Building standalone Windows executable...
call npx pkg . --targets node22-win-x64 --output dist\Klepsydra.exe
if errorlevel 1 goto fail
echo.
echo BUILD COMPLETE: %CD%\dist\Klepsydra.exe
echo Copy .env and the data folder next to the EXE before distributing it.
echo Do not share your .env file.
pause
exit /b 0
:fail
echo.
echo Build failed. Check the error above and confirm Internet access.
pause
exit /b 1
