# HTC (Hatachi) — instalador Windows
#   irm https://prefeitodev.com/htc-cli/xinstaller.ps1 | iex
param(
	[string]$Base = "https://prefeitodev.com/htc-cli",
	[string]$Version = "latest",
	[switch]$FromSource
)
$ErrorActionPreference = "Stop"

$C = "`e[38;2;203;27;69m"; $D = "`e[2m"; $G = "`e[38;2;76;195;138m"
$R = "`e[38;2;255;92;92m"; $Z = "`e[0m"

$htcHome = Join-Path $env:USERPROFILE ".htc"
$binDir = Join-Path $htcHome "bin"
$exe = Join-Path $binDir "htc.exe"

function Banner {
	Write-Host ""
	Write-Host "$C  ██╗  ██╗████████╗ ██████╗ $Z"
	Write-Host "$C  ██║  ██║╚══██╔══╝██╔════╝ $Z"
	Write-Host "$C  ███████║   ██║   ██║      $Z"
	Write-Host "$C  ██╔══██║   ██║   ██║      $Z"
	Write-Host "$C  ██║  ██║   ██║   ╚██████╗ $Z"
	Write-Host "$C  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ $Z"
	Write-Host "$C  ⠀⣀⣤⣤⣤⣤⣀⠀⠀⠀⠀$Z"
	Write-Host "$C  ⣠⣿⠐⣿⣿⣿⣿⣷⣦⡀⠀$Z  $D hatachi$Z"
	Write-Host "$C  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡄$Z  $D security is an illusion.$Z"
	Write-Host "$C  ⠈⠻⠿⠿⠿⠿⠿⠿⠟⠁⠀$Z"
	Write-Host ""
}

function Ok($t) { Write-Host "  $G+$Z $t" }
function Erro($t) { Write-Host "  $R x$Z $t" -ForegroundColor Red }
function Passo($t) { Write-Host "  $D>$Z $t" }

function Instalar {
	New-Item -ItemType Directory -Force $binDir | Out-Null

	if (-not $FromSource) {
		$url = "$Base/$Version/htc-windows-x64.exe"
		Passo "baixando $url"
		try {
			Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
			$bytes = [System.IO.File]::ReadAllBytes($exe)
			if ($bytes.Length -lt 1MB -or $bytes[0] -eq 0x3C) {
				Remove-Item $exe -Force
				throw "o servidor devolveu HTML ou arquivo curto"
			}
			Ok "binario em $exe"
		} catch {
			Erro "$($_.Exception.Message)"
			$FromSource = $true
		}
	}

	if ($FromSource) {
		Passo "modo fonte (bun + node_modules)"
		$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
		if (-not (Test-Path (Join-Path $raiz "package.json"))) {
			Erro "package.json nao encontrado; rode dentro de app/"
			return
		}
		Push-Location $raiz
		cmd /c "npm.cmd install --legacy-peer-deps --no-audit --no-fund" | Select-Object -Last 2
		cmd /c "bun run compile" | Select-Object -Last 2
		Pop-Location
		if (Test-Path (Join-Path $raiz "dist\htc.exe")) {
			Copy-Item (Join-Path $raiz "dist\htc.exe") $exe -Force
			Ok "binario gerado: $exe"
		}
	}

	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	if ($userPath -notlike "*$binDir*") {
		[Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
		Ok "PATH do usuario atualizado"
	}

	Write-Host ""
	Write-Host "  $G pronto.$Z abra um terminal novo e rode: $C htc$Z"
	Write-Host "  $D desinstalar: htc uninstall --force$Z"
	Write-Host ""
}

function Desinstalar {
	if (Test-Path $exe) { & $exe uninstall --force }
	else {
		Remove-Item $htcHome -Recurse -Force -ErrorAction SilentlyContinue
		Ok "removido ($htcHome)"
	}
}

Banner
if ($Host.Name -eq "ConsoleHost" -and -not $FromSource -and -not $env:HTC_NO_MENU) {
	Write-Host "  $C 1$Z instalar / atualizar"
	Write-Host "  $C 2$Z desinstalar"
	Write-Host "  $C 3$Z sair"
	Write-Host ""
	$op = Read-Host "  escolha [1-3]"
	switch ($op) {
		"2" { Desinstalar }
		"3" { return }
		default { Instalar }
	}
} else {
	Instalar
}
