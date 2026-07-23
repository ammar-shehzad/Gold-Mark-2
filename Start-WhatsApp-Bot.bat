@echo off
title MallPay WhatsApp Bot
color 0A
rem ============================================================
rem  MallPay WhatsApp Bot launcher - just double-click this file.
rem  Keep the window open while you want messages to send.
rem  Close the window to stop the bot (messages will queue and
rem  send automatically the next time it starts).
rem ============================================================
set "PATH=C:\Program Files\nodejs;%PATH%"
if not exist "%~dp0whatsapp-bot\" (
  color 0C
  echo.
  echo  ERROR: The "whatsapp-bot" folder was not found next to this file.
  echo.
  echo  This launcher must stay in the folder that contains "whatsapp-bot".
  echo  To start it from the Desktop, do NOT copy this file - make a
  echo  SHORTCUT instead:  right-click this file ^> Send to ^> Desktop.
  echo.
  pause
  exit /b 1
)
cd /d "%~dp0whatsapp-bot"

if not exist dist\index.js (
  echo First-time setup: building the bot...
  call npm run build
)

:loop
echo.
echo ==========================================
echo  WhatsApp bot starting - keep this window open
echo ==========================================
node dist/index.js
echo.
echo Bot stopped or crashed. Restarting in 5 seconds...
echo (Close this window if you want it to stay stopped.)
timeout /t 5 /nobreak >nul
goto loop
