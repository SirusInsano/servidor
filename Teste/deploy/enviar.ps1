<#
.SYNOPSIS
    Envia o site para o servidor e roda o instalador.

.DESCRIPTION
    Copia os arquivos do site para o servidor via scp e executa o
    instalador (Node + systemd + Caddy com HTTPS automatico).

.EXAMPLE
    .\enviar.ps1 -Servidor root@1.2.3.4 -Dominio animeworld.com
#>
param(
    [Parameter(Mandatory = $true)][string]$Servidor,   # usuario@host
    [Parameter(Mandatory = $true)][string]$Dominio,     # seu-dominio.com
    [string]$Porta = '22'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$destino = "/tmp/animeworld-deploy"

Write-Host "==> Enviando site para $Servidor" -ForegroundColor Cyan

#empacota tudo num .tar.gz (envia 1 arquivo em vez de varios)
$tar = Join-Path $env:TEMP 'animeworld-deploy.tar.gz'
if (Test-Path $tar) { Remove-Item $tar -Force }

$itens = @(
    'server.js', 'package.json', 'index.html', 'style.css', 'script.js',
    'leitor.html', 'reader.css', 'reader.js', 'README.md', 'imagens', 'deploy'
) | ForEach-Object { Join-Path $raiz $_ } | Where-Object { Test-Path $_ }

& tar -czf $tar -C $raiz @($itens | ForEach-Object { $_.Substring($raiz.Length + 1) })
if ($LASTEXITCODE -ne 0) { throw "falha ao empacotar" }

& scp -P $Porta $tar "${Servidor}:/tmp/animeworld-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "falha no upload" }

Write-Host "==> Rodando o instalador" -ForegroundColor Cyan
& ssh -p $Porta $Servidor "rm -rf $destino && mkdir -p $destino && tar -xzf /tmp/animeworld-deploy.tar.gz -C $destino && cd $destino && sudo bash deploy/instalar.sh $Dominio"
if ($LASTEXITCODE -ne 0) { throw "falha no instalador" }

Write-Host ""
Write-Host "==> Concluido: https://$Dominio" -ForegroundColor Green
