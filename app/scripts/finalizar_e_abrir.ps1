# language: PowerShell 5.1, file: app/scripts/finalizar_e_abrir.ps1, target: Windows
#
# Finalizacao do HTC: fecha as sessoes abertas, troca o binario instalado pelo
# build atual e reabre N janelas no mesmo workspace.
#
# Por que existe: ~/.htc/bin/htc.exe fica travado enquanto htc.exe roda, e o
# instalador oficial (scripts/instalar_binario.mjs) BAIXA de prefeitodev.com --
# nao copia o build local. Sem este script, o binario corrigido nunca entra.
#
# Ordem: janela -> CloseMainWindow -> espera -> Stop-Process -> espera o lock do
# arquivo cair -> backup -> copia -> confere tamanho -> reabre.
#
# Roda e termina: nao fica observando as sessoes que abriu.
#
#   powershell -ExecutionPolicy Bypass -File app/scripts/finalizar_e_abrir.ps1
#   ... -Workspace "C:\caminho" -Janelas 2 -Build "C:\...\dist\htc.exe"

param(
	[string]$Workspace = "C:\Users\Daniel Lukit\OneDrive\Desktop\Pedido M e Prefeito",
	[string]$Build = "C:\Users\Daniel Lukit\OneDrive\Desktop\HTC\app\dist\htc.exe",
	[int]$Janelas = 2,
	[int]$EsperaFechar = 10,
	[int]$EsperaLock = 20
)

$ErrorActionPreference = "Stop"
$bin = Join-Path $env:USERPROFILE ".htc\bin\htc.exe"
$log = Join-Path $env:TEMP "htc_finalizacao.log"

function Registrar([string]$msg) {
	$linha = "{0}  {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
	Write-Host $linha
	Add-Content -Path $log -Value $linha -Encoding utf8
}

Add-Content -Path $log -Value ("`n=== {0} ===" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding utf8
Registrar "workspace = $Workspace"
Registrar "build     = $Build"
Registrar "binario   = $bin"

if (-not (Test-Path $Build)) {
	Registrar "ABORTA: build nao existe. Rode 'bun run compile' antes."
	exit 2
}
if (-not (Test-Path $Workspace)) {
	Registrar "ABORTA: workspace nao existe: $Workspace"
	exit 3
}

# 1) fechar
$abertas = @(Get-Process -Name htc -ErrorAction SilentlyContinue)
Registrar ("sessoes abertas: {0}" -f $abertas.Count)
foreach ($p in $abertas) {
	$pidAntes = $p.Id
	try {
		$pediu = $p.CloseMainWindow()
		Registrar ("pid {0}: CloseMainWindow={1}" -f $pidAntes, $pediu)
	} catch {
		Registrar ("pid {0}: CloseMainWindow falhou ({1})" -f $pidAntes, $_.Exception.Message)
	}
}

$limite = (Get-Date).AddSeconds($EsperaFechar)
while ((Get-Date) -lt $limite) {
	if (@(Get-Process -Name htc -ErrorAction SilentlyContinue).Count -eq 0) { break }
	Start-Sleep -Milliseconds 400
}

$restantes = @(Get-Process -Name htc -ErrorAction SilentlyContinue)
foreach ($p in $restantes) {
	Registrar ("pid {0}: nao saiu sozinho, encerrando" -f $p.Id)
	try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch {
		Registrar ("pid {0}: Stop-Process falhou ({1})" -f $p.Id, $_.Exception.Message)
	}
}

$limite = (Get-Date).AddSeconds($EsperaFechar)
while ((Get-Date) -lt $limite) {
	if (@(Get-Process -Name htc -ErrorAction SilentlyContinue).Count -eq 0) { break }
	Start-Sleep -Milliseconds 400
}
if (@(Get-Process -Name htc -ErrorAction SilentlyContinue).Count -gt 0) {
	Registrar "ABORTA: ainda ha htc rodando; binario continua travado."
	exit 4
}
Registrar "sessoes fechadas"

# 2) esperar o lock do arquivo cair (o handle sobrevive ao fim do processo por alguns ms)
$liberado = $false
$limite = (Get-Date).AddSeconds($EsperaLock)
while ((Get-Date) -lt $limite) {
	try {
		$fs = [System.IO.File]::Open($bin, "Open", "ReadWrite", "None")
		$fs.Close()
		$liberado = $true
		break
	} catch {
		Start-Sleep -Milliseconds 300
	}
}
if (-not $liberado) {
	Registrar "ABORTA: binario ainda travado depois de $EsperaLock s."
	exit 5
}
Registrar "lock liberado"

# 3) backup + troca
$carimbo = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$bin.bak_$carimbo"
Copy-Item $bin $backup -Force
Registrar ("backup: {0} ({1} bytes)" -f $backup, (Get-Item $backup).Length)

Copy-Item $Build $bin -Force
$tamBuild = (Get-Item $Build).Length
$tamBin = (Get-Item $bin).Length
if ($tamBin -ne $tamBuild) {
	Registrar ("ABORTA: tamanho divergente (build={0} bin={1})" -f $tamBuild, $tamBin)
	exit 6
}
Registrar ("instalado: {0} bytes" -f $tamBin)

# 4) reabrir
$antes = @(Get-Process -Name htc -ErrorAction SilentlyContinue).Count
for ($i = 1; $i -le $Janelas; $i++) {
	Start-Process -FilePath $bin -WorkingDirectory $Workspace | Out-Null
	Registrar ("aberta janela {0}/{1} em {2}" -f $i, $Janelas, $Workspace)
	Start-Sleep -Milliseconds 800
}

Start-Sleep -Seconds 3
$depois = @(Get-Process -Name htc -ErrorAction SilentlyContinue)
Registrar ("processos htc depois: {0} (antes: {1})" -f $depois.Count, $antes)

if ($depois.Count -lt $Janelas) {
	Registrar "AVISO: abri menos janelas do que pedi; veja ~/.htc/data/logs"
	exit 7
}

Registrar "FIM"
exit 0
