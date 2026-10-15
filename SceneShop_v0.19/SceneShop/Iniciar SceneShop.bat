@echo off
title SceneShop
cd /d "%~dp0"
setlocal
set NODEVER=v22.22.2
set NODEDIR=%~dp0runtime\node-%NODEVER%-win-x64

rem 0) Idioma das mensagens: o do Windows (pt, es); outros = ingles. / Messages follow the Windows language.
set "SSL=en"
for /f "usebackq delims=" %%L in (`powershell -NoProfile -Command "(Get-UICulture).TwoLetterISOLanguageName" 2^>nul`) do set "SSL=%%L"
if /i not "%SSL%"=="pt" if /i not "%SSL%"=="es" set "SSL=en"
set "SCENESHOP_LANG=%SSL%"

set "M_FIRST1=First run: downloading portable Node.js - about 30 MB, only once..."
set "M_FIRST2=Nothing is installed in Windows; it stays in the SceneShop runtime folder."
set "M_NODEFAIL=Could not download Node.js. Check the internet or install Node.js 22 from https://nodejs.org"
set "M_ENV=Settings read from sceneshop.env"
set "M_GEM_ON=Gemini AI: key configured"
set "M_GEM_OFF=Gemini AI: no key. To turn it on, open Configurar IA Gemini.bat"
set "M_ACR_ON=Audio recognition: ACRCloud configured"
set "M_ACR_OFF=Audio recognition: ACRCloud not configured. To turn it on, open Configurar ACRCloud.bat"
set "M_DEPS=Installing dependencies..."
set "M_START=Starting SceneShop at"
set "M_OPEN=The browser opens by itself when ready. To stop, close this window."
set "M_STOP=SceneShop stopped. If an error appeared above, send a photo of this window to support."

if /i "%SSL%"=="pt" set "M_FIRST1=Primeira vez: baixando o Node.js portatil - cerca de 30 MB, so uma vez..."
if /i "%SSL%"=="pt" set "M_FIRST2=Nada e instalado no Windows; ele fica na pasta runtime do SceneShop."
if /i "%SSL%"=="pt" set "M_NODEFAIL=Nao consegui baixar o Node.js. Verifique a internet ou instale o Node.js 22 pelo site https://nodejs.org"
if /i "%SSL%"=="pt" set "M_ENV=Configuracoes lidas de sceneshop.env"
if /i "%SSL%"=="pt" set "M_GEM_ON=IA Gemini: chave configurada"
if /i "%SSL%"=="pt" set "M_GEM_OFF=IA Gemini: sem chave. Para ligar, abra Configurar IA Gemini.bat"
if /i "%SSL%"=="pt" set "M_ACR_ON=Reconhecimento por audio: ACRCloud configurada"
if /i "%SSL%"=="pt" set "M_ACR_OFF=Reconhecimento por audio: ACRCloud nao configurada. Para ligar, abra Configurar ACRCloud.bat"
if /i "%SSL%"=="pt" set "M_DEPS=Instalando dependencias..."
if /i "%SSL%"=="pt" set "M_START=Iniciando o SceneShop em"
if /i "%SSL%"=="pt" set "M_OPEN=O navegador abre sozinho quando estiver pronto. Para parar, feche esta janela."
if /i "%SSL%"=="pt" set "M_STOP=O SceneShop parou. Se apareceu um erro acima, envie uma foto desta janela para o suporte."

if /i "%SSL%"=="es" set "M_FIRST1=Primera vez: descargando Node.js portatil - unos 30 MB, solo una vez..."
if /i "%SSL%"=="es" set "M_FIRST2=No se instala nada en Windows; queda en la carpeta runtime de SceneShop."
if /i "%SSL%"=="es" set "M_NODEFAIL=No se pudo descargar Node.js. Revisa internet o instala Node.js 22 desde https://nodejs.org"
if /i "%SSL%"=="es" set "M_ENV=Configuracion leida de sceneshop.env"
if /i "%SSL%"=="es" set "M_GEM_ON=IA Gemini: clave configurada"
if /i "%SSL%"=="es" set "M_GEM_OFF=IA Gemini: sin clave. Para activarla, abre Configurar IA Gemini.bat"
if /i "%SSL%"=="es" set "M_ACR_ON=Reconocimiento por audio: ACRCloud configurada"
if /i "%SSL%"=="es" set "M_ACR_OFF=Reconocimiento por audio: ACRCloud no configurada. Para activarlo, abre Configurar ACRCloud.bat"
if /i "%SSL%"=="es" set "M_DEPS=Instalando dependencias..."
if /i "%SSL%"=="es" set "M_START=Iniciando SceneShop en"
if /i "%SSL%"=="es" set "M_OPEN=El navegador se abre solo cuando este listo. Para detenerlo, cierra esta ventana."
if /i "%SSL%"=="es" set "M_STOP=SceneShop se detuvo. Si aparecio un error arriba, envia una foto de esta ventana a soporte."

rem 1) Node.js 20 ou mais novo instalado no computador? Usa ele.
where node >nul 2>nul && node -e "process.exit(Number(process.versions.node.split('.')[0])<20?1:0)" >nul 2>nul && goto temnode

rem 2) Senao, usa (ou baixa uma vez) uma copia portatil do Node dentro desta pasta
if exist "%NODEDIR%\node.exe" goto portatil
echo.
echo  %M_FIRST1%
echo  %M_FIRST2%
echo.
if not exist runtime mkdir runtime
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://nodejs.org/dist/%NODEVER%/node-%NODEVER%-win-x64.zip' -OutFile 'runtime\node.zip'; Expand-Archive 'runtime\node.zip' -DestinationPath 'runtime' -Force; Remove-Item 'runtime\node.zip'"
if not exist "%NODEDIR%\node.exe" (
  echo.
  echo  %M_NODEFAIL%
  pause
  exit /b 1
)
:portatil
set "PATH=%NODEDIR%;%PATH%"

:temnode
rem 3) Configuracoes opcionais em sceneshop.env (uma por linha: NOME=valor; # comenta)
if exist sceneshop.env (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("sceneshop.env") do if not "%%A"=="" set "%%A=%%B"
  echo  %M_ENV%
)
if defined GEMINI_API_KEY (echo  %M_GEM_ON%) else (echo  %M_GEM_OFF%)
if defined ACRCLOUD_ACCESS_KEY (echo  %M_ACR_ON%) else (echo  %M_ACR_OFF%)
if "%PORT%"=="" set PORT=3000

rem 4) As dependencias ja vem no pacote (pasta node_modules); instala so se faltar
if not exist node_modules\express (echo %M_DEPS% & call npm install --omit=dev --no-audit --no-fund)

echo.
echo  %M_START% http://localhost:%PORT% ...
echo  %M_OPEN%
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:%PORT%/api/health -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:%PORT%/studio.html'; break}catch{Start-Sleep -Milliseconds 500}}"
node server\index.js
echo.
echo  %M_STOP%
pause
