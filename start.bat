@echo off
setlocal
cd /d "%~dp0"
rem Χωρίς .env ο server ανοίγει σελίδα πρώτης ρύθμισης (ορισμός PIN) στον browser.
set "PORT=auto"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if /i "%%a"=="PORT" set "PORT=%%b"
)
set "PORT=%PORT: =%"
set "PORT=%PORT:"=%"
if "%PORT%"=="" set "PORT=auto"
if not exist "node_modules" (
  echo Installing dependencies for first run...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
rem With a fixed PORT the browser is opened here, so the server must not open a second one.
rem With PORT=auto the server picks the port itself and opens the browser.
if /i "%PORT%"=="auto" goto run
set "AUTO_OPEN_BROWSER=false"
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/admin"
:run
call npm start
pause
