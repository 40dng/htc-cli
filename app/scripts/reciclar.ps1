# language: PowerShell, file: app/scripts/reciclar.ps1
#
# Fecha o HTC em execucao, builda, testa o checkpoint de ponta a ponta e reabre
# a conversa na mesma sessao. Tudo automatizado: o operador nao digita nada.
#
#   powershell -ExecutionPolicy Bypass -File scripts\reciclar.ps1
#   ... -SemFechar -SemAbrir   # so builda e testa, sem mexer na sessao atual
#   ... -AtrasoSegundos 120    # espera antes de comecar (para o turno terminar)
#
# Veredito em %TEMP%\htc-reciclo-veredito.txt e trilha em %TEMP%\htc-reciclo.log.
# ASCII puro de proposito: PowerShell 5.1 le .ps1 sem BOM como ANSI e quebra em
# qualquer acento.

[CmdletBinding()]
param(
	[int]$AtrasoSegundos = 0,
	[switch]$SemFechar,
	[switch]$SemAbrir,
	[switch]$SemCompilar,
	[string]$Provider = "opencode-go",
	[string]$Modelo = "deepseek-v4.1-flash"
)

$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:TEMP "htc-reciclo.log"
$veredito = Join-Path $env:TEMP "htc-reciclo-veredito.txt"
$instalado = Join-Path $env:USERPROFILE ".htc\bin\htc.exe"

Remove-Item $log, $veredito -Force -ErrorAction SilentlyContinue

function Registrar([string]$texto) {
	$linha = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $texto
	Add-Content -Path $log -Value $linha -Encoding utf8
	Write-Host $linha
}

function Sombra([string]$workspace) {
	# Mesmo hash do modulo: caminho absoluto, barra normal, minusculo, 16 chars.
	$normal = $workspace.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
	$sha = [System.Security.Cryptography.SHA256]::Create()
	$bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normal))
	$hash = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
	Join-Path (Join-Path $env:TEMP "htc-checkpoints") $hash.Substring(0, 16)
}

# Conta os refs de checkpoint gravados desde `desde` em TODOS os shadows.
# Nao depende de calcular o hash do workspace: o Windows entrega o mesmo
# diretorio como `C:\Users\<usuario>~1\...` ou `C:\Users\<usuario>\...` conforme
# quem resolve o caminho, e o hash sai diferente.
function RefsDesde([long]$desde) {
	$achados = @()
	$base = Join-Path $env:TEMP "htc-checkpoints"
	if (-not (Test-Path $base)) { return $achados }
	foreach ($dir in Get-ChildItem $base -Directory -ErrorAction SilentlyContinue) {
		$gitDir = Join-Path $dir.FullName ".git"
		if (-not (Test-Path $gitDir)) { continue }
		$linhas = & git --git-dir $gitDir for-each-ref --format="%(refname) %(committerdate:unix)" "refs/cline/checkpoints" 2>$null
		foreach ($linha in $linhas) {
			$partes = $linha -split " "
			if ($partes.Count -lt 2) { continue }
			if ([long]$partes[1] -ge $desde) {
				$achados += "$($partes[0]) ($([System.IO.Path]::GetFileName($dir.FullName)))"
			}
		}
	}
	return $achados
}

if ($AtrasoSegundos -gt 0) {
	Registrar "aguardando $AtrasoSegundos s para o turno atual terminar"
	Start-Sleep -Seconds $AtrasoSegundos
}

# 1. fechar ---------------------------------------------------------------
if (-not $SemFechar) {
	$vivos = Get-Process -Name htc -ErrorAction SilentlyContinue
	if ($vivos) {
		Registrar ("fechando HTC: " + (($vivos | ForEach-Object { $_.Id }) -join ", "))
		$vivos | Stop-Process -Force -ErrorAction SilentlyContinue
		Start-Sleep -Seconds 2
	} else {
		Registrar "nenhum HTC em execucao para fechar"
	}
}

# 2. buildar --------------------------------------------------------------
$okCompile = $true
if (-not $SemCompilar) {
	Push-Location $raiz
	try {
		Registrar "build: bun run build"
		& bun run build > (Join-Path $env:TEMP "htc-reciclo-build.log") 2>&1
		$okBuild = $LASTEXITCODE -eq 0
		Registrar ("build js: " + $(if ($okBuild) { "ok" } else { "FALHOU" }))

		Registrar "build: bun run compile (binario unico, demora)"
		& bun run compile > (Join-Path $env:TEMP "htc-reciclo-compile.log") 2>&1
		$okCompile = $LASTEXITCODE -eq 0
		Registrar ("compile exe: " + $(if ($okCompile) { "ok" } else { "FALHOU" }))
	} finally {
		Pop-Location
	}
	if (-not $okCompile) {
		"NAO: compile falhou (ver %TEMP%\htc-reciclo-compile.log). Nada foi trocado." |
			Set-Content $veredito -Encoding utf8
		Registrar "abortado: compile falhou"
		exit 1
	}
}

# 3. instalar o binario novo ---------------------------------------------
$novoExe = Join-Path $raiz "dist\htc.exe"
$pastaExe = Split-Path -Parent $instalado
if ((Test-Path $novoExe) -and (Test-Path $pastaExe)) {
	try {
		Copy-Item $novoExe $instalado -Force -ErrorAction Stop
		Registrar "instalado em $instalado"
	} catch {
		Registrar ("nao deu para copiar o exe (" + $_.Exception.Message + ") - provavelmente ainda em uso")
	}
}

# 4. testar o checkpoint --------------------------------------------------
# O turno de teste abaixo cria sessao propria e sobrescreve `last-session.json`.
# Guardar o marcador antes evita reabrir o HTC na sessao de teste (foi assim que
# o TUI passou a rodar com cwd de %TEMP%).
$marcadorSessao = Join-Path $env:USERPROFILE ".htc\state\last-session.json"
$marcadorAntes = if (Test-Path $marcadorSessao) { Get-Content $marcadorSessao -Raw } else { $null }

$ws = Join-Path $env:TEMP "htc-checkpoint-teste"
if (Test-Path $ws) { Remove-Item $ws -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $ws -Force | Out-Null
"estado inicial" | Set-Content (Join-Path $ws "nota.txt") -Encoding utf8

$dist = Join-Path $raiz "dist\index.js"
Registrar "turno headless em $ws"
$antesDoTurno = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Push-Location $ws
try {
	$saidaTurno = Join-Path $env:TEMP "htc-reciclo-turno.log"
	& bun $dist "responda apenas com a palavra ok" -P $Provider -m $Modelo --thinking none --auto-continue false > $saidaTurno 2>&1
} finally {
	Pop-Location
}

$refs = @(RefsDesde $antesDoTurno)
$total = $refs.Count
Registrar "refs de checkpoint gravados neste turno: $total"

# Devolve o marcador do operador: a sessao de teste nao pode virar a "ultima".
if ($marcadorAntes) {
	Set-Content -Path $marcadorSessao -Value $marcadorAntes -Encoding utf8 -NoNewline
	Registrar "marcador de sessao restaurado (o teste nao rouba o resume)"
}

# 5. abrir a conversa -----------------------------------------------------
if (-not $SemAbrir) {
	if (Test-Path $instalado) {
		$marcador = Join-Path $env:USERPROFILE ".htc\state\last-session.json"
		if (Test-Path $marcador) {
			$sessao = Get-Content $marcador -Raw | ConvertFrom-Json
			$argumentos = @()
			if ($sessao.sessionId) { $argumentos = @("--id", $sessao.sessionId) }
			if ($sessao.cwd) {
				Start-Process -FilePath $instalado -ArgumentList $argumentos -WorkingDirectory $sessao.cwd
			} else {
				Start-Process -FilePath $instalado -ArgumentList $argumentos
			}
			Registrar "HTC reaberto na sessao $($sessao.sessionId)"
		} else {
			Start-Process -FilePath $instalado
			Registrar "HTC reaberto sem sessao anterior"
		}
	} else {
		Registrar "exe instalado ausente; nada para abrir"
	}
}

# 6. veredito -------------------------------------------------------------
$linhas = @()
if ($total -ge 1) {
	$primeiro = @($refs)[0]
	$linhas += "OK: checkpoint gravado pelo build novo ($primeiro)"
} else {
	$linhas += "NAO: nenhum checkpoint no workspace de teste - ver %TEMP%\htc-reciclo-turno.log"
}
$linhas += "build: $raiz\dist\index.js"
$linhas += "instalado: $instalado"
$linhas += "log: $log"
$linhas | Set-Content $veredito -Encoding utf8
$linhas | ForEach-Object { Registrar $_ }
