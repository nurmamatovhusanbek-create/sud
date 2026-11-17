@echo off
rem Sud tizimi - double-click to start the app and open it in the browser.
rem Needs: bun and node on PATH (the same ones Git Bash uses). Close the minimized "Sud tizimi server" window to stop,
rem or run Sud-toxtat.bat. Text is plain ASCII on purpose: cmd.exe garbles other characters.
setlocal
title Sud tizimi
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo [XATO] bun topilmadi. https://bun.sh dan o'rnating, so'ng qayta ochasiz.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [XATO] node topilmadi. https://nodejs.org dan o'rnating, so'ng qayta ochasiz.
  pause
  exit /b 1
)

set "URL=http://127.0.0.1:3000"

rem Already running? Then just open it.
curl.exe -s -o nul --max-time 3 "%URL%/api/settings/version"
if not errorlevel 1 goto open

echo Server ishga tushmoqda. Birinchi marta 1-3 daqiqa ketishi mumkin, kuting...
start "Sud tizimi server" /min cmd /c "bun run dev"

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

:open
start "" "%URL%"
exit /b 0
