@echo off
rem Sud tizimi - stops the server that Sud.bat started, with everything it started.
setlocal
title Sud tizimi - to'xtatish

rem the supervisor first (otherwise it would start the server again), found by its command line, with its whole tree
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*supervisor.mjs*' -and $_.ProcessId -ne $PID } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }" >nul 2>nul

rem the server window, if it is still there
taskkill /FI "WINDOWTITLE eq Sud tizimi server*" /T /F >nul 2>nul

rem then whatever still listens on port 3000 (an old run left behind)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /PID %%P /T /F >nul 2>nul

echo Sud tizimi to'xtatildi.
timeout /t 2 /nobreak >nul
