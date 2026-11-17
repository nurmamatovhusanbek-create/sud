@echo off
rem Sud tizimi - double-click to start the app and open it in the browser.
rem It starts the server through Git Bash (the same place you start it by hand), because that is where bun and node
rem are on PATH. Without Git Bash it falls back to plain cmd, which needs bun and node on the Windows PATH.
rem Close the minimized "Sud tizimi server" window to stop, or run Sud-toxtat.bat. Plain ASCII on purpose: cmd.exe garbles
rem other characters.
setlocal
title Sud tizimi
cd /d "%~dp0"

set "URL=http://127.0.0.1:3000"

rem Already running? Then just open it.
curl.exe -s -o nul --max-time 3 "%URL%/api/settings/version"
if not errorlevel 1 goto open

set "GITBASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined GITBASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined GITBASH if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "GITBASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if defined GITBASH goto viabash

rem ---- no Git Bash: plain cmd ----
where bun >nul 2>nul
if errorlevel 1 goto nobun
where node >nul 2>nul
if errorlevel 1 goto nonode
echo Server ishga tushmoqda. Birinchi marta 1-3 daqiqa ketishi mumkin, kuting...
start "Sud tizimi server" /min cmd /c "bun run dev"
goto waiting

:viabash
echo Server ishga tushmoqda (Git Bash orqali). Birinchi marta 1-3 daqiqa ketishi mumkin, kuting...
rem CHERE_INVOKING keeps the login shell in this folder instead of jumping to the home folder
set "CHERE_INVOKING=1"
start "Sud tizimi server" /min "%GITBASH%" -lc "bun run dev"

:waiting
set /a tries=0
:wait
set /a tries+=1
if %tries% gtr 150 goto slow
rem the page answers only after it is compiled, so the browser opens onto a ready page
curl.exe -s -o nul --max-time 5 "%URL%/"
if not errorlevel 1 goto open
timeout /t 2 /nobreak >nul
goto wait

:slow
echo.
echo Server uzoq javob bermadi. Pastdagi "Sud tizimi server" oynasini oching va xabarlarni o'qing.
pause
exit /b 1

:nobun
echo [XATO] bun topilmadi. Git Bash ham topilmadi. https://bun.sh dan o'rnating.
pause
exit /b 1

:nonode
echo [XATO] node topilmadi. Git Bash topilmadi. https://nodejs.org dan o'rnating.
pause
exit /b 1

:open
start "" "%URL%"
exit /b 0
