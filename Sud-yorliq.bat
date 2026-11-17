@echo off
rem Sud tizimi - puts a "Sud tizimi" shortcut (with the app icon) on your Desktop. Run it once, from this folder.
rem A shortcut can be pinned to the taskbar (a bare .bat file cannot): right-click it, "Show more options", "Pin to taskbar".
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\Sud tizimi.lnk'); $s.TargetPath=$env:ComSpec; $s.Arguments='/c Sud.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0scripts\sud.ico'; $s.WindowStyle=7; $s.Description='Sud tizimi'; $s.Save(); Write-Host ('Yorliq yaratildi: '+$d+'\Sud tizimi.lnk')"
if errorlevel 1 (
  echo Yorliq yaratilmadi.
  pause
  exit /b 1
)
echo.
echo Endi Ish stolidagi "Sud tizimi" yorlig'ini sichqonchaning o'ng tugmasi bilan bosing,
echo "Show more options", so'ng "Pin to taskbar" ni tanlang.
pause
