# Assistente para ligar a IA (Google Gemini) no SceneShop.
# Pede a chave, testa com o Google, escolhe um modelo com cota gratuita e grava sceneshop.env.
# A chave fica só neste computador, no arquivo sceneshop.env.
param([string]$Key, [string]$EnvFile, [switch]$NoTest, [string]$Lang)
$ErrorActionPreference = 'Stop'
$script:lang = if ($Lang) { $Lang.ToLower() } else { try { (Get-UICulture).TwoLetterISOLanguageName } catch { 'en' } }
if (@('pt', 'en', 'es') -notcontains $script:lang) { $script:lang = 'en' }
# Mensagens no idioma do Windows (português, español; outros = English). -Lang pt|en|es força um idioma.
function L([string]$pt, [string]$en, [string]$es) { switch ($script:lang) { 'pt' { $pt } 'es' { $es } default { $en } } }
$root = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root 'sceneshop.env' }

Write-Host ''
Write-Host (L '  SceneShop - ligar a IA (Google Gemini)' '  SceneShop - turn on AI (Google Gemini)' '  SceneShop - activar la IA (Google Gemini)') -ForegroundColor Yellow
Write-Host '  ---------------------------------------'
Write-Host (L '  1. Abra https://aistudio.google.com/apikey e entre com sua conta Google.' '  1. Open https://aistudio.google.com/apikey and sign in with your Google account.' '  1. Abre https://aistudio.google.com/apikey e inicia sesión con tu cuenta de Google.')
Write-Host (L '  2. Clique em "Create API key" e copie a chave (começa com AIza).' '  2. Click "Create API key" and copy the key (it starts with AIza).' '  2. Haz clic en "Create API key" y copia la clave (empieza con AIza).')
Write-Host (L '  3. Cole aqui (clique com o botão direito na janela para colar) e tecle Enter.' '  3. Paste it here (right-click the window to paste) and press Enter.' '  3. Pégala aquí (clic derecho en la ventana para pegar) y presiona Enter.')
Write-Host ''

if (-not $Key) { $Key = Read-Host (L '  Chave do Gemini' '  Gemini key' '  Clave de Gemini') }
$Key = ($Key -replace '["''\s]', '')
if ($Key -match '^GEMINI_API_KEY=') { $Key = $Key.Substring(15) }
if ($Key -notmatch '^AIza[0-9A-Za-z_\-]{30,}$') {
  Write-Host ''
  Write-Host (L '  Isso não parece uma chave do Gemini (ela começa com AIza e tem cerca de 39 caracteres).' '  This does not look like a Gemini key (it starts with AIza and has about 39 characters).' '  Esto no parece una clave de Gemini (empieza con AIza y tiene unos 39 caracteres).') -ForegroundColor Red
  Write-Host (L '  Nada foi alterado. Copie a chave de novo e rode este assistente outra vez.' '  Nothing was changed. Copy the key again and run this assistant again.' '  No se cambió nada. Copia la clave de nuevo y vuelve a ejecutar este asistente.')
  exit 1
}

$model = 'gemini-2.5-flash'
if (-not $NoTest) {
  Write-Host ''
  Write-Host (L '  Testando a chave com o Google...' '  Testing the key with Google...' '  Probando la clave con Google...')
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $r = Invoke-RestMethod -Uri 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200' -Headers @{ 'x-goog-api-key' = $Key } -TimeoutSec 30
    $names = @($r.models | Where-Object { $_.supportedGenerationMethods -contains 'generateContent' } | ForEach-Object { $_.name -replace '^models/', '' })
    if ($names -contains 'gemini-2.5-flash') { $model = 'gemini-2.5-flash' }
    else {
      $flash = @($names | Where-Object { $_ -match '^gemini-[0-9.]+-flash$' } | Sort-Object -Descending)
      if ($flash.Count -gt 0) { $model = $flash[0] }
    }
    Write-Host (L "  Chave aceita pelo Google. Modelo escolhido: $model" "  Key accepted by Google. Model chosen: $model" "  Clave aceptada por Google. Modelo elegido: $model") -ForegroundColor Green
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    Write-Host ''
    if ($code -eq 400 -or $code -eq 401 -or $code -eq 403) {
      Write-Host (L "  O Google recusou esta chave (erro $code). Confira se copiou a chave inteira" "  Google rejected this key (error $code). Check that you copied the whole key" "  Google rechazó esta clave (error $code). Revisa que copiaste la clave completa") -ForegroundColor Red
      Write-Host (L '  ou crie uma nova em https://aistudio.google.com/apikey. Nada foi alterado.' '  or create a new one at https://aistudio.google.com/apikey. Nothing was changed.' '  o crea una nueva en https://aistudio.google.com/apikey. No se cambió nada.')
      exit 1
    }
    Write-Host (L '  Não consegui falar com o Google agora (sem internet ou bloqueio de rede).' '  Could not reach Google right now (no internet or a network block).' '  No pude comunicarme con Google ahora (sin internet o bloqueo de red).') -ForegroundColor Yellow
    Write-Host (L '  Vou gravar a chave mesmo assim; ela será usada quando a internet estiver ok.' '  The key will be saved anyway and used once the internet works.' '  Guardaré la clave de todos modos; se usará cuando internet funcione.')
  }
}

# Mantém as outras configurações do arquivo e troca só as linhas do Gemini.
$lines = @()
if (Test-Path -LiteralPath $EnvFile) {
  $lines = @([IO.File]::ReadAllLines($EnvFile) | Where-Object { $_ -notmatch '^\s*#?\s*GEMINI_(API_KEY|MODEL)\s*=' })
}
$lines += "GEMINI_API_KEY=$Key"
$lines += "GEMINI_MODEL=$model"
# UTF-8 sem BOM: o lançador do Windows lê o arquivo linha a linha.
[IO.File]::WriteAllLines($EnvFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))

Write-Host ''
Write-Host (L '  Pronto! A IA está configurada em sceneshop.env.' '  Done! AI is configured in sceneshop.env.' '  ¡Listo! La IA está configurada en sceneshop.env.') -ForegroundColor Green
Write-Host (L '  Feche as janelas pretas do SceneShop que estiverem abertas e abra' '  Close any open SceneShop black windows and open' '  Cierra las ventanas negras de SceneShop que estén abiertas y abre')
Write-Host (L '  "Iniciar SceneShop.bat" de novo. No estúdio, use "Analisar com Gemini".' '  "Iniciar SceneShop.bat" again. In the Studio, use "Analyze with Gemini".' '  "Iniciar SceneShop.bat" de nuevo. En el Estudio, usa "Analizar con Gemini".')
exit 0
