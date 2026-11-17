@echo off
rem Sud tizimi - ONE file for everything. Plain ASCII on purpose: cmd.exe garbles other characters.
rem   double-click, app not running : starts it (through Git Bash, where bun and node are on PATH) and opens the browser
rem   double-click, app running     : a 4-second menu - Open (default) / Stop / make a Desktop shortcut
rem   Sud.bat stop | Sud.bat shortcut : the same two actions without the menu
rem Without Git Bash it falls back to plain cmd, which needs bun and node on the Windows PATH.
setlocal
title Sud tizimi
cd /d "%~dp0"

set "URL=http://127.0.0.1:3000"

if /i "%~1"=="stop" goto stop
if /i "%~1"=="shortcut" goto shortcut

rem Already running? Then offer the menu.
curl.exe -s -o nul --max-time 3 "%URL%/api/settings/version"
if not errorlevel 1 goto menu

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

:menu
echo Sud tizimi ishlayapti.
echo.
echo   [O] Ochish     [S] To'xtatish     [Y] Ish stoliga yorliq yaratish
echo.
choice /c OSY /n /t 4 /d O /m "Tanlang (4 soniyada avtomatik O): "
if errorlevel 3 goto shortcut
if errorlevel 2 goto stop
goto open

:stop
rem the supervisor first (otherwise it would start the server again), found by its command line, with its whole tree
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*supervisor.mjs*' -and $_.ProcessId -ne $PID } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }" >nul 2>nul
rem the server window, if it is still there
taskkill /FI "WINDOWTITLE eq Sud tizimi server*" /T /F >nul 2>nul
rem then whatever still listens on port 3000 (an old run left behind)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /PID %%P /T /F >nul 2>nul
echo Sud tizimi to'xtatildi.
timeout /t 2 /nobreak >nul
exit /b 0

:shortcut
rem A shortcut can be pinned to the taskbar (a bare .bat cannot): right-click it, "Show more options", "Pin to taskbar".
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\Sud tizimi.lnk'); $s.TargetPath=$env:ComSpec; $s.Arguments='/c Sud.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0scripts\sud.ico'; $s.WindowStyle=7; $s.Description='Sud tizimi'; $s.Save(); Write-Host ('Yorliq yaratildi: '+$d+'\Sud tizimi.lnk')"
if errorlevel 1 goto shortcutfail
echo.
echo Endi Ish stolidagi "Sud tizimi" yorlig'ini sichqonchaning o'ng tugmasi bilan bosing,
echo "Show more options", so'ng "Pin to taskbar" ni tanlang.
pause
exit /b 0

:shortcutfail
echo Yorliq yaratilmadi.
pause
exit /b 1
