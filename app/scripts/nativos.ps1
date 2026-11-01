# Coleta os binarios nativos por plataforma em _natives/ e devolve tudo ao
# node_modules ao final (npm poda o que veio com --no-save a cada install).
# Versao SEMPRE igual a do @opentui/core: nativo 0.6.6 com core 0.4.3 quebra
# no dlopen ("Symbol createEventSink not found").
$raiz = "C:\Users\Daniel Lukit\OneDrive\Desktop\HTC\app"
Set-Location $raiz
$versao = (Get-Content "node_modules\@opentui\core\package.json" -Raw | ConvertFrom-Json).version
Write-Output "versao do @opentui/core: $versao"
$nativos = @(
	@{ p = "@opentui/core-linux-x64"; o = "linux"; c = "x64" },
	@{ p = "@opentui/core-linux-arm64"; o = "linux"; c = "arm64" },
	@{ p = "@opentui/core-darwin-x64"; o = "darwin"; c = "x64" },
	@{ p = "@opentui/core-darwin-arm64"; o = "darwin"; c = "arm64" },
	@{ p = "@opentui/core-win32-x64"; o = "win32"; c = "x64" },
	@{ p = "@opentui/core-linux-x64-musl"; o = "linux"; c = "x64" },
	@{ p = "@opentui/core-linux-arm64-musl"; o = "linux"; c = "arm64" }
)
New-Item -ItemType Directory -Force _natives | Out-Null

foreach ($n in $nativos) {
	$curto = $n.p.Split("/")[1]
	cmd /c "npm.cmd install --legacy-peer-deps --no-audit --no-fund --no-save --force --os=$($n.o) --cpu=$($n.c) `"$($n.p)@$versao`" >nul 2>&1" | Out-Null
	$origem = Join-Path "node_modules\@opentui" $curto
	if (Test-Path $origem) {
		New-Item -ItemType Directory -Force (Join-Path "_natives" $curto) | Out-Null
		Copy-Item (Join-Path $origem "*") (Join-Path "_natives" $curto) -Recurse -Force
		Write-Output "coletado $curto"
	} else {
		Write-Output "FALHOU $curto"
	}
}

foreach ($dir in Get-ChildItem "_natives" -Directory) {
	New-Item -ItemType Directory -Force (Join-Path "node_modules\@opentui" $dir.Name) | Out-Null
	Copy-Item (Join-Path $dir.FullName "*") (Join-Path "node_modules\@opentui" $dir.Name) -Recurse -Force
}
Write-Output "nativos restaurados: $((Get-ChildItem 'node_modules\@opentui' -Directory | Where-Object { $_.Name -like 'core-*' }).Count)"

