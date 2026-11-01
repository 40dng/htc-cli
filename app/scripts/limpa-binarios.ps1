# limpa-binarios.ps1 - lista (e, com -Executar, remove) binarios antigos do htc em ~/.htc/bin.
#
# Motivo: cada troca de binario deixa um htc.exe.old-<hhmmss> de ~130 MB. Em 31/10 havia 14,
# cerca de 1,8 GB. Dry-run por padrao; nada e apagado sem -Executar.
#
# Uso:
#   powershell -File limpa-binarios.ps1             # so lista
#   powershell -File limpa-binarios.ps1 -Executar   # remove, mantendo o .bak mais recente
param([switch]$Executar)

$bin = Join-Path $env:USERPROFILE '.htc\bin'
if (-not (Test-Path $bin)) { Write-Output "sem $bin"; exit 0 }

$antigos = Get-ChildItem $bin -File |
	Where-Object { $_.Name -like 'htc.exe.old-*' } |
	Sort-Object LastWriteTime

if (-not $antigos) { Write-Output 'nenhum binario antigo'; exit 0 }

$total = ($antigos | Measure-Object Length -Sum).Sum
Write-Output ('{0} arquivo(s), {1} MB' -f $antigos.Count, [math]::Round($total / 1MB, 1))
$antigos | ForEach-Object { '  {0}  {1} MB  {2}' -f $_.Name, [math]::Round($_.Length / 1MB, 1), $_.LastWriteTime.ToString('dd/MM HH:mm') }

if (-not $Executar) {
	Write-Output 'dry-run: rode com -Executar para remover'
	exit 0
}

$antigos | ForEach-Object {
	try { Remove-Item $_.FullName -Force -ErrorAction Stop; Write-Output ('removido: ' + $_.Name) }
	catch { Write-Output ('falhou: ' + $_.Name + ' - ' + $_.Exception.Message) }
}

$resta = @(Get-ChildItem $bin -File | Where-Object { $_.Name -like 'htc.exe.old-*' }).Count
Write-Output ('restantes: ' + $resta)
