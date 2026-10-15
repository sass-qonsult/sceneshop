# Assistente para ligar o reconhecimento de vídeos pelo som (ACRCloud) no SceneShop.
# Pede os dados do painel da ACRCloud, testa cada um com a ACRCloud e grava sceneshop.env.
# As credenciais ficam só neste computador, no arquivo sceneshop.env.
param([string]$AcrHost, [string]$AccessKey, [string]$AccessSecret, [string]$BucketId, [string]$Token,
      [string]$ConsoleUrl, [string]$EnvFile, [switch]$NoTest, [string]$Lang)
$ErrorActionPreference = 'Stop'
$script:lang = if ($Lang) { $Lang.ToLower() } else { try { (Get-UICulture).TwoLetterISOLanguageName } catch { 'en' } }
if (@('pt', 'en', 'es') -notcontains $script:lang) { $script:lang = 'en' }
# Mensagens no idioma do Windows (português, español; outros = English). -Lang pt|en|es força um idioma.
function L([string]$pt, [string]$en, [string]$es) { switch ($script:lang) { 'pt' { $pt } 'es' { $es } default { $en } } }
$root = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root 'sceneshop.env' }

function Ask([string]$value, [string]$label) {
  if ($value) { return $value.Trim() }
  return ((Read-Host "  $label") -replace '["'']', '').Trim()
}
function Fail([string]$msg) {
  Write-Host ''
  Write-Host "  $msg" -ForegroundColor Red
  Write-Host (L '  Nada foi alterado. Confira no painel da ACRCloud e rode este assistente de novo.' '  Nothing was changed. Check the ACRCloud dashboard and run this assistant again.' '  No se cambió nada. Revisa el panel de ACRCloud y vuelve a ejecutar este asistente.')
  exit 1
}

Write-Host ''
Write-Host (L '  SceneShop - reconhecer os vídeos pelo som (ACRCloud)' '  SceneShop - recognize videos by sound (ACRCloud)' '  SceneShop - reconocer los videos por el sonido (ACRCloud)') -ForegroundColor Yellow
Write-Host '  ----------------------------------------------------'
Write-Host (L '  Antes, no site console.acrcloud.com (o passo a passo está no guia, seção A9):' '  First, at console.acrcloud.com (step by step in the guide, section A9):' '  Antes, en console.acrcloud.com (paso a paso en la guía, sección A9):')
Write-Host (L '   1. crie um bucket do tipo "Audio & Video";' '   1. create a bucket of type "Audio & Video";' '   1. crea un bucket de tipo "Audio & Video";')
Write-Host (L '   2. crie um projeto de reconhecimento ligado a esse bucket;' '   2. create a recognition project attached to that bucket;' '   2. crea un proyecto de reconocimiento vinculado a ese bucket;')
Write-Host (L '   3. crie um token em Account > Developer settings.' '   3. create a token in Account > Developer settings.' '   3. crea un token en Account > Developer settings.')
Write-Host (L '  Copie cada dado do painel e cole aqui (botão direito cola). Tecle Enter a cada um.' '  Copy each value from the dashboard and paste it here (right-click pastes). Press Enter after each.' '  Copia cada dato del panel y pégalo aquí (clic derecho pega). Presiona Enter después de cada uno.')
Write-Host ''

$AcrHost = (Ask $AcrHost (L 'Host do projeto (ex.: identify-eu-west-1.acrcloud.com)' 'Project host (e.g. identify-eu-west-1.acrcloud.com)' 'Host del proyecto (ej.: identify-eu-west-1.acrcloud.com)')) -replace '^https://', '' -replace '/+$', ''
$AccessKey = Ask $AccessKey (L 'Access Key do projeto' 'Project Access Key' 'Access Key del proyecto')
$AccessSecret = Ask $AccessSecret (L 'Access Secret do projeto' 'Project Access Secret' 'Access Secret del proyecto')
$BucketId = Ask $BucketId (L 'ID do bucket (número)' 'Bucket ID (a number)' 'ID del bucket (número)')
$Token = Ask $Token (L 'Token da Console API' 'Console API token' 'Token de la Console API')

if ($AcrHost -notmatch '^[A-Za-z0-9.\-:]+$' -and $AcrHost -notmatch '^http://127\.0\.0\.1') { Fail (L 'O host deve ser só o endereço, por exemplo identify-eu-west-1.acrcloud.com.' 'The host must be just the address, for example identify-eu-west-1.acrcloud.com.' 'El host debe ser solo la dirección, por ejemplo identify-eu-west-1.acrcloud.com.') }
if ($AccessKey.Length -lt 8 -or $AccessSecret.Length -lt 8) { Fail (L 'Access Key e Access Secret parecem incompletos.' 'Access Key and Access Secret look incomplete.' 'Access Key y Access Secret parecen incompletos.') }
if ($BucketId -notmatch '^\d+$') { Fail (L 'O ID do bucket é um número (aparece na lista de buckets).' 'The bucket ID is a number (shown in the bucket list).' 'El ID del bucket es un número (aparece en la lista de buckets).') }
if ($Token.Length -lt 12) { Fail (L 'O token da Console API parece incompleto.' 'The Console API token looks incomplete.' 'El token de la Console API parece incompleto.') }

$base = if ($AcrHost -match '^https?://') { $AcrHost } else { "https://$AcrHost" }
if (-not $ConsoleUrl) {
  if ($AcrHost -match '^identify-([a-z0-9\-]+)\.acrcloud\.com$') { $ConsoleUrl = "https://api-$($Matches[1]).acrcloud.com" } else { $ConsoleUrl = 'https://api-v2.acrcloud.com' }
}

if (-not $NoTest) {
  Write-Host ''
  Write-Host (L '  Testando com a ACRCloud...' '  Testing with ACRCloud...' '  Probando con ACRCloud...')
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Add-Type -AssemblyName System.Net.Http
  $http = New-Object System.Net.Http.HttpClient
  $http.Timeout = [TimeSpan]::FromSeconds(30)
  $offline = $false
  try {
    # 1) Projeto: identifica 1 s de silêncio. "Sem resultado" (1001) prova que chave e segredo estão certos.
    $ts = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $toSign = "POST`n/v1/identify`n$AccessKey`naudio`n1`n$ts"
    $hmac = New-Object System.Security.Cryptography.HMACSHA1 (,[Text.Encoding]::UTF8.GetBytes($AccessSecret))
    $sig = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($toSign)))
    $wav = New-Object byte[] (44 + 16000)
    $hdr = [Text.Encoding]::ASCII
    $hdr.GetBytes('RIFF').CopyTo($wav, 0); [BitConverter]::GetBytes([int](36 + 16000)).CopyTo($wav, 4); $hdr.GetBytes('WAVEfmt ').CopyTo($wav, 8)
    [BitConverter]::GetBytes([int]16).CopyTo($wav, 16); [BitConverter]::GetBytes([int16]1).CopyTo($wav, 20); [BitConverter]::GetBytes([int16]1).CopyTo($wav, 22)
    [BitConverter]::GetBytes([int]8000).CopyTo($wav, 24); [BitConverter]::GetBytes([int]16000).CopyTo($wav, 28); [BitConverter]::GetBytes([int16]2).CopyTo($wav, 32)
    [BitConverter]::GetBytes([int16]16).CopyTo($wav, 34); $hdr.GetBytes('data').CopyTo($wav, 36); [BitConverter]::GetBytes([int]16000).CopyTo($wav, 40)
    # Multipart montado com cuidado: boundary sem aspas e cabeçalhos simples, aceitos por qualquer servidor.
    $boundary = [Guid]::NewGuid().ToString('N')
    $form = New-Object System.Net.Http.MultipartFormDataContent $boundary
    $ct = New-Object System.Net.Http.Headers.MediaTypeHeaderValue 'multipart/form-data'
    $ct.Parameters.Add((New-Object System.Net.Http.Headers.NameValueHeaderValue 'boundary', $boundary))
    $form.Headers.ContentType = $ct
    $file = New-Object System.Net.Http.ByteArrayContent (,$wav)
    $file.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('audio/wav')
    $file.Headers.ContentDisposition = [System.Net.Http.Headers.ContentDispositionHeaderValue]::Parse('form-data; name="sample"; filename="sample.wav"')
    $form.Add($file)
    foreach ($kv in @(@('access_key', $AccessKey), @('sample_bytes', [string]$wav.Length), @('timestamp', $ts), @('signature', $sig), @('data_type', 'audio'), @('signature_version', '1'))) {
      $part = New-Object System.Net.Http.StringContent $kv[1]
      $part.Headers.ContentType = $null
      $part.Headers.ContentDisposition = [System.Net.Http.Headers.ContentDispositionHeaderValue]::Parse('form-data; name="' + $kv[0] + '"')
      $form.Add($part)
    }
    $resp = $http.PostAsync("$($base.TrimEnd('/'))/v1/identify", $form).GetAwaiter().GetResult()
    $raw = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $body = $null
    try { $body = $raw | ConvertFrom-Json } catch {}
    if (-not $body -or -not $body.status -or $null -eq $body.status.code) { Fail (L "Resposta inesperada da ACRCloud (HTTP $([int]$resp.StatusCode)). Confira o Host do projeto." "Unexpected reply from ACRCloud (HTTP $([int]$resp.StatusCode)). Check the project Host." "Respuesta inesperada de ACRCloud (HTTP $([int]$resp.StatusCode)). Revisa el Host del proyecto.") }
    $code = [int]$body.status.code
    if ($code -ne 0 -and $code -ne 1001) { Fail (L "A ACRCloud recusou o projeto: $($body.status.msg) (código $code). Confira Host, Access Key e Access Secret." "ACRCloud rejected the project: $($body.status.msg) (code $code). Check Host, Access Key and Access Secret." "ACRCloud rechazó el proyecto: $($body.status.msg) (código $code). Revisa Host, Access Key y Access Secret.") }
    Write-Host (L '  Projeto de reconhecimento: OK' '  Recognition project: OK' '  Proyecto de reconocimiento: OK') -ForegroundColor Green

    # 2) Bucket e token: lista um arquivo do bucket.
    $req = New-Object System.Net.Http.HttpRequestMessage 'GET', "$($ConsoleUrl.TrimEnd('/'))/api/buckets/$BucketId/files?per_page=1"
    $req.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue 'Bearer', $Token
    $req.Headers.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::Parse('application/json'))
    $r2 = $http.SendAsync($req).GetAwaiter().GetResult()
    $s2 = [int]$r2.StatusCode
    if ($s2 -eq 401 -or $s2 -eq 403) { Fail (L 'A ACRCloud recusou o token da Console API. Crie outro em Account > Developer settings.' 'ACRCloud rejected the Console API token. Create another one in Account > Developer settings.' 'ACRCloud rechazó el token de la Console API. Crea otro en Account > Developer settings.') }
    if ($s2 -eq 404) { Fail (L "Bucket $BucketId não encontrado nessa região ($ConsoleUrl). Confira o ID e a região do bucket." "Bucket $BucketId not found in this region ($ConsoleUrl). Check the bucket ID and region." "Bucket $BucketId no encontrado en esta región ($ConsoleUrl). Revisa el ID y la región del bucket.") }
    if ($s2 -ge 400) { Fail (L "A Console API da ACRCloud respondeu $s2." "The ACRCloud Console API answered $s2." "La Console API de ACRCloud respondió $s2.") }
    Write-Host (L '  Bucket e token: OK' '  Bucket and token: OK' '  Bucket y token: OK') -ForegroundColor Green
  } catch {
    $offline = $true
    Write-Host ''
    Write-Host (L '  Não consegui falar com a ACRCloud agora (sem internet ou bloqueio de rede).' '  Could not reach ACRCloud right now (no internet or a network block).' '  No pude comunicarme con ACRCloud ahora (sin internet o bloqueo de red).') -ForegroundColor Yellow
    Write-Host (L '  Vou gravar os dados mesmo assim; confira depois no estúdio.' '  The values will be saved anyway; check them later in the Studio.' '  Guardaré los datos de todos modos; revísalos después en el Estudio.')
  }
}

# Mantém as outras configurações e troca só as linhas da ACRCloud.
$lines = @()
if (Test-Path -LiteralPath $EnvFile) {
  $lines = @([IO.File]::ReadAllLines($EnvFile) | Where-Object { $_ -notmatch '^\s*#?\s*ACRCLOUD_[A-Z_]+\s*=' })
}
$lines += "ACRCLOUD_HOST=$AcrHost"
$lines += "ACRCLOUD_ACCESS_KEY=$AccessKey"
$lines += "ACRCLOUD_ACCESS_SECRET=$AccessSecret"
$lines += "ACRCLOUD_BUCKET_ID=$BucketId"
$lines += "ACRCLOUD_CONSOLE_TOKEN=$Token"
if ($PSBoundParameters.ContainsKey('ConsoleUrl')) { $lines += "ACRCLOUD_CONSOLE_URL=$ConsoleUrl" }
[IO.File]::WriteAllLines($EnvFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))

Write-Host ''
Write-Host (L '  Pronto! A ACRCloud está configurada em sceneshop.env.' '  Done! ACRCloud is configured in sceneshop.env.' '  ¡Listo! ACRCloud está configurada en sceneshop.env.') -ForegroundColor Green
Write-Host (L '  Feche as janelas pretas do SceneShop e abra "Iniciar SceneShop.bat" de novo.' '  Close the SceneShop black windows and open "Iniciar SceneShop.bat" again.' '  Cierra las ventanas negras de SceneShop y abre "Iniciar SceneShop.bat" de nuevo.')
Write-Host (L '  No estúdio (aba Obras), cada obra mostra "Reconhecimento por áudio"; obras já' '  In the Studio (Titles tab), each title shows "Audio recognition"; titles' '  En el Estudio (pestaña Obras), cada obra muestra "Reconocimiento por audio"; las obras')
Write-Host (L '  cadastradas antes precisam do botão "Reconhecimento por áudio" uma vez.' '  added earlier need one click on the "Audio recognition" button.' '  registradas antes necesitan un clic en el botón "Reconocimiento por audio".')
exit 0
