@echo off
title SceneShop
cd /d "%~dp0"
setlocal
set NODEVER=v22.22.2
set NODEDIR=%~dp0runtime\node-%NODEVER%-win-x64

rem 1) Node.js 20 ou mais novo instalado no computador? Usa ele.
where node >nul 2>nul && node -e "process.exit(Number(process.versions.node.split('.')[0])<20?1:0)" >nul 2>nul && goto temnode

rem 2) Senao, usa (ou baixa uma vez) uma copia portatil do Node dentro desta pasta
if exist "%NODEDIR%\node.exe" goto portatil
echo.
echo  Primeira vez: baixando o Node.js portatil (cerca de 30 MB, so uma vez)...
echo  Nada e instalado no Windows; ele fica na pasta "runtime" do SceneShop.
echo.
if not exist runtime mkdir runtime
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://nodejs.org/dist/%NODEVER%/node-%NODEVER%-win-x64.zip' -OutFile 'runtime\node.zip'; Expand-Archive 'runtime\node.zip' -DestinationPath 'runtime' -Force; Remove-Item 'runtime\node.zip'"
if not exist "%NODEDIR%\node.exe" (
  echo.
  echo  Nao consegui baixar o Node.js. Verifique a internet ou instale o Node.js 22 pelo site https://nodejs.org
  pause
  exit /b 1
)
:portatil
set "PATH=%NODEDIR%;%PATH%"

:temnode
rem 3) Configuracoes opcionais em sceneshop.env (uma por linha: NOME=valor; # comenta)
if exist sceneshop.env (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("sceneshop.env") do if not "%%A"=="" set "%%A=%%B"
  echo  Configuracoes lidas de sceneshop.env
)
if "%PORT%"=="" set PORT=3000

rem 4) As dependencias ja vem no pacote (pasta node_modules); instala so se faltar
if not exist node_modules\express (echo Instalando dependencias... & call npm install --omit=dev --no-audit --no-fund)

echo.
echo  Iniciando o SceneShop em http://localhost:%PORT% ...
echo  O navegador abre sozinho quando estiver pronto. Para parar, feche esta janela.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:%PORT%/api/health -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:%PORT%/studio.html'; break}catch{Start-Sleep -Milliseconds 500}}"
node server\index.js
echo.
echo  O SceneShop parou. Se apareceu um erro acima, envie uma foto desta janela para o suporte.
pause
