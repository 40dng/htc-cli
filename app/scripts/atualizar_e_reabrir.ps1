# language: PowerShell, file: scripts/atualizar_e_reabrir.ps1
# Instala dist\htc.exe e reabre o HTC na conversa onde parou.
#
# Regra dura: fecha APENAS os processos do HTC. Nao fecha console, nao mata
# arvore de shell, nao mexe em janela. Encerrar o processo libera o binario;
# a janela nova nasce com `start` (console proprio) e o `--id` da ultima sessao.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\atualizar_e_reabrir.ps1
#   ... -NoLaunch  instala e nao abre
#   ... -Fresh     sessao nova (ignora o marcador)
#   ... -NoKill    nao fecha nada (teste de instalacao)
#   ... -KeepOld   nao poda builds antigos
#   ... -Prompt "texto"   mensagem enviada ao retomar (default: continue)

[CmdletBinding()]
param(
	[switch]$NoLaunch,
	[switch]$Fresh,
	[switch]$KeepOld,
	[switch]$ForceCloseTerminal,
	[switch]$NoKill,
	[string]$Prompt = 'continue'
)

$ErrorActionPreference = 'Continue'
$raizApp = Split-Path -Parent $PSScriptRoot
$origem = Join-Path $raizApp 'dist\htc.exe'
$bin = Join-Path $env:USERPROFILE '.htc\bin'
$destino = Join-Path $bin 'htc.exe'
$marcador = Join-Path $env:USERPROFILE '.htc\state\last-session.json'
$log = Join-Path $env:USERPROFILE '.htc\update.log'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$falhas = @()

New-Item -ItemType Directory -Force -Path $bin | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null

function Diz([string]$texto, [string]$cor = 'Gray') {
	$linha = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
	Write-Host $linha -ForegroundColor $cor
	try { Add-Content -LiteralPath $log -Value $linha -Encoding UTF8 } catch { }
}

# `start` cria console PROPRIO: o processo novo sobrevive quando a janela
# antiga fecha. `Start-Process <exe>` herda o console e morre junto.
# O CreateProcess sai por WMI: o processo nasce fora do job deste shell, entao
# nao morre quando quem chamou o script termina (job kill mata neto, nao WMI).
function Abrir-Htc([string[]]$argumentos, [string]$dir) {
	$marca = Get-Date
	$pedacos = @('"' + $destino + '"')
	foreach ($a in $argumentos) {
		if ($null -eq $a) { continue }
		$pedacos += ('"' + [string]$a + '"')
	}
	$cmd = 'cmd /c start "HTC" ' + ($pedacos -join ' ')
	$ok = $false
	try {
		$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
			CommandLine      = $cmd
			CurrentDirectory = $dir
		} -ErrorAction Stop
		if ($null -ne $r -and $r.ReturnValue -eq 0) { $ok = $true }
		else { Diz ("WMI Create retornou " + $r.ReturnValue) 'Yellow' }
	} catch {
		Diz "WMI Create falhou: $($_.Exception.Message)" 'Yellow'
	}
	if (-not $ok) {
		try {
			Start-Process -FilePath $env:ComSpec -ArgumentList '/c', $cmd -WorkingDirectory $dir -WindowStyle Hidden | Out-Null
			$ok = $true
		} catch {
			Diz "start falhou: $($_.Exception.Message)" 'Red'
			return $null
		}
	}
	for ($i = 0; $i -lt 30; $i++) {
		Start-Sleep -Milliseconds 500
		$novo = Get-Process htc -ErrorAction SilentlyContinue |
			Where-Object { $_.StartTime -ge $marca } |
			Select-Object -First 1
		if ($novo) { return $novo }
	}
	return $null
}

Diz "=== atualizar_e_reabrir $stamp ===" 'Cyan'

if (-not (Test-Path -LiteralPath $origem)) {
	Diz "build ausente: $origem (rode: bun run compile)" 'Red'
	exit 2
}
$tamanhoBuild = (Get-Item -LiteralPath $origem).Length
Diz "build: $tamanhoBuild bytes"

# 1. conversa + cwd (lidos ANTES de fechar)
$sessao = $null
$cwdSessao = $raizApp
if (-not $Fresh -and (Test-Path -LiteralPath $marcador)) {
	try {
		$dados = Get-Content -LiteralPath $marcador -Raw | ConvertFrom-Json
		if ($dados.sessionId) { $sessao = [string]$dados.sessionId }
		if ($dados.cwd -and (Test-Path -LiteralPath ([string]$dados.cwd))) { $cwdSessao = [string]$dados.cwd }
	} catch {
		Diz "marcador ilegivel; abrindo sessao nova" 'Yellow'
	}
}
Diz ("conversa: " + $(if ($sessao) { $sessao } else { '(nova)' }) + "  cwd: $cwdSessao")


# 2. fechar o HTC e a janela que o hospedou (processo, nunca "a arvore toda")
$shellsAntigos = @()
if ($NoKill) {
	Diz "NoKill: nada foi fechado" 'Yellow'
} else {
	$procs = @(Get-Process htc -ErrorAction SilentlyContinue)
	Diz ("processos htc: " + $procs.Count)
	if ($procs.Count -gt 0) {
		$mapaPai = @{}
		try {
			foreach ($w in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
				$mapaPai[[int]$w.ProcessId] = [int]$w.ParentProcessId
			}
		} catch { }
		# ancestrais do PROPRIO script nunca entram na lista (auto-kill)
		$meus = @{}
		$atual = $PID
		for ($n = 0; $n -lt 8; $n++) {
			$pai = $mapaPai[$atual]
			if (-not $pai) { break }
			$meus[$pai] = $true
			$atual = $pai
		}
		foreach ($p in $procs) {
			# Sobe a cadeia inteira: htc -> cmd -> OpenConsole -> WindowsTerminal.
			# Quem entra na lista de fechamento e so shell (cmd/powershell/pwsh);
			# hospedeiro de console e terminal sao atravessados, nunca mortos.
			$atual = [int]$p.Id
			$cadeia = @()
			for ($n = 0; $n -lt 6; $n++) {
				$pai = $mapaPai[$atual]
				if (-not $pai -or $meus.ContainsKey($pai)) { break }
				$procPai = Get-Process -Id $pai -ErrorAction SilentlyContinue
				if (-not $procPai) { break }
				$cadeia += ('{0}({1})' -f $procPai.ProcessName, $pai)
				if ($procPai.ProcessName -in @('cmd', 'powershell', 'pwsh')) {
					if (-not ($shellsAntigos -contains $pai)) { $shellsAntigos += $pai }
				} elseif ($procPai.ProcessName -notin @('OpenConsole', 'conhost', 'WindowsTerminal')) {
					break
				}
				$atual = $pai
			}
			if ($cadeia.Count -gt 0) {
				Diz ("janela de origem: " + ($cadeia -join ' <- '))
			} else {
				Diz "janela de origem: nenhuma (processo solto)"
			}
		}
		foreach ($p in $procs) {
			try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
		}
		for ($i = 0; $i -lt 24; $i++) {
			if (-not (Get-Process htc -ErrorAction SilentlyContinue)) { break }
			Start-Sleep -Milliseconds 250
		}
		$resta = @(Get-Process htc -ErrorAction SilentlyContinue)
		if ($resta.Count -gt 0) {
			Diz ("resistiu: " + ($resta.Id -join ',') + " — seguindo mesmo assim") 'Yellow'
			$falhas += 'processo resistiu'
		} else {
			Diz "encerrado" 'Green'
		}
	}
}

# 3. instalar: renomeia o antigo (em uso pode ser movido) e copia o novo
$instalado = $false
if (Test-Path -LiteralPath $destino) {
	$antigo = Join-Path $bin "htc.old_$stamp.exe"
	try {
		Move-Item -LiteralPath $destino -Destination $antigo -Force -ErrorAction Stop
		Diz "antigo guardado: $(Split-Path -Leaf $antigo)"
	} catch {
		Diz "nao consegui mover o antigo: $($_.Exception.Message)" 'Yellow'
		$falhas += 'rename do antigo falhou'
	}
}
try {
	Copy-Item -LiteralPath $origem -Destination $destino -Force -ErrorAction Stop
	$novo = Get-Item -LiteralPath $destino
	if ($novo.Length -ne $tamanhoBuild) {
		throw "tamanho diferente apos copia ($($novo.Length) != $tamanhoBuild)"
	}
	$instalado = $true
	Diz ("instalado: {0} bytes, {1}" -f $novo.Length, $novo.LastWriteTime) 'Green'
} catch {
	Diz "FALHA ao instalar: $($_.Exception.Message)" 'Red'
	$falhas += 'copia falhou'
	if (-not (Test-Path -LiteralPath $destino)) {
		$antigo = Get-ChildItem -LiteralPath $bin -Filter 'htc.old_*.exe' -ErrorAction SilentlyContinue |
			Sort-Object LastWriteTime -Descending | Select-Object -First 1
		if ($antigo) {
			try {
				Copy-Item -LiteralPath $antigo.FullName -Destination $destino -Force -ErrorAction Stop
				Diz "restaurei o build anterior" 'Yellow'
			} catch { }
		}
	}
}

# 4. reabrir na mesma conversa — e JA continuar
foreach ($sid in $shellsAntigos) {
	try {
		Stop-Process -Id $sid -Force -ErrorAction Stop
		Diz ("terminal antigo fechado (pid $sid)")
	} catch {
		Diz ("terminal antigo $sid resistiu: $($_.Exception.Message)") 'Yellow'
	}
}

if (-not $NoLaunch) {
	if (-not (Test-Path -LiteralPath $destino)) {
		Diz "nada para abrir (o binario nao esta em $destino)" 'Red'
		exit 1
	}
	$abriu = $null
	if ($sessao) {
		# --id abre a conversa; o prompt na mesma linha vira a primeira mensagem
		# (a TUI submete sozinha), entao o turno continua sem tocar em tecla.
		$abriu = Abrir-Htc @('--id', $sessao, $Prompt) $cwdSessao
		if ($abriu) {
			Diz ("reaberto em {0} e seguindo (pid {1})" -f $sessao, $abriu.Id) 'Green'
		} else {
			Diz "--id $sessao nao subiu; abrindo sem --id" 'Yellow'
			$falhas += "--id $sessao nao subiu"
		}
	}
	if (-not $abriu) {
		$abriu = Abrir-Htc @() $cwdSessao
		if ($abriu) {
			Diz ("reaberto sem --id (pid {0})" -f $abriu.Id) 'Cyan'
		} else {
			Diz "FALHA ao abrir o HTC" 'Red'
			$falhas += 'abrir falhou'
		}
	}
}

# 5. podar builds antigos (mantem os 3 mais recentes)
if (-not $KeepOld) {
	$velhos = @(Get-ChildItem -LiteralPath $bin -Filter 'htc.old_*.exe' -ErrorAction SilentlyContinue |
		Sort-Object LastWriteTime -Descending | Select-Object -Skip 3)
	foreach ($v in $velhos) {
		try { Remove-Item -LiteralPath $v.FullName -Force -ErrorAction Stop } catch { }
	}
	if ($velhos.Count -gt 0) { Diz ("podados: " + $velhos.Count + " build(s) antigo(s)") }
}

if ($falhas.Count -gt 0) {
	Diz ("fim com pendencias: " + ($falhas -join ' | ')) 'Yellow'
	exit 1
}
Diz "fim" 'Green'
exit 0

