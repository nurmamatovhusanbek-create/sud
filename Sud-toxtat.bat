@echo off
rem Sud tizimi - stops the server that Sud.bat started (and anything still holding port 3000).
setlocal
title Sud tizimi - to'xtatish

rem the supervisor window first (otherwise it would restart the server), with everything it started
taskkill /FI "WINDOWTITLE eq Sud tizimi server*" /T /F >nul 2>nul

rem then whatever still listens on port 3000 (an old run left behind)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /PID %%P /T /F >nul 2>nul

echo Sud tizimi to'xtatildi.
timeout /t 2 /nobreak >nul
