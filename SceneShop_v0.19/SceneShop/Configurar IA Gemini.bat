@echo off
title SceneShop - configurar IA
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configurar-ia.ps1"
echo.
pause
