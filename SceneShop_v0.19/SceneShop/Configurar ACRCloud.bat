@echo off
title SceneShop - configurar ACRCloud
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configurar-acrcloud.ps1"
echo.
pause
