$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:LOCALAPPDATA "SceneShop"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $root "launcher.mjs") (Join-Path $target "launcher.mjs") -Force
$cmd = "@echo off`r`nnode `"$target\launcher.mjs`" %*`r`n"
Set-Content -Path (Join-Path $target "SceneShop.cmd") -Value $cmd -Encoding Ascii
Write-Host "SceneShop Desktop installed at $target"
