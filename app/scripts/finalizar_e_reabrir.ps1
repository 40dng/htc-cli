# language: PowerShell, file: scripts/finalizar_e_reabrir.ps1, runtime: Windows 11 / PowerShell 5.1
# Fecha as sessoes htc vivas, instala o binario novo e reabre as duas sessoes.
# Nao apaga historico: cada sessao e um .json append-only; --id apenas retoma.
param(
    [string]$Bin = "$env:USERPROFILE\.htc\bin\htc.exe",
    [string]$Novo = "C:\Users\Daniel Lukit\OneDrive\Desktop\HTC\app\dist\htc.exe",
    [string]$Cwd = "C:\Users\Daniel Lukit\OneDrive\Desktop\Pedido M e Prefeito",
    [string[]]$Sessoes = @("1792717921049_42sjb", "1792704837204_8rs2d"),
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$log = Join-Path $env:USERPROFILE ".htc\finalizacao_$stamp.log"

function Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

Log "inicio (dryrun=$DryRun)"

$vivos = @(Get-Process htc -ErrorAction SilentlyContinue)
Log ("processos htc vivos: " + $(if ($vivos.Count -eq 0) { "nenhum" } else { ($vivos | ForEach-Object { "$($_.Id)@$($_.StartTime.ToString('HH:mm:ss'))" }) -join ", " }))

$snap = [pscustomobject]@{
    gerado_em    = (Get-Date).ToString("o")
    binario_novo = $Novo
    binario_alvo = $Bin
    cwd          = $Cwd
    sessoes      = $Sessoes
    processos    = @($vivos | ForEach-Object { [pscustomobject]@{ id = $_.Id; start = $_.StartTime.ToString("o") } })
    bin_atual    = (Get-Item $Bin -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ bytes = $_.Length; mtime = $_.LastWriteTime.ToString("o") } })
    bin_novo     = (Get-Item $Novo -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ bytes = $_.Length; mtime = $_.LastWriteTime.ToString("o") } })
}
$snapPath = Join-Path $env:USERPROFILE ".htc\snapshot_$stamp.json"
$snap | ConvertTo-Json -Depth 5 | Out-File -FilePath $snapPath -Encoding utf8
Log "snapshot em $snapPath"

if ($vivos.Count -gt 0) {
    if ($DryRun) {
        Log "DRYRUN: pararia $($vivos.Count) processo(s)"
    }
    else {
        foreach ($p in $vivos) {
            try {
                Stop-Process -Id $p.Id -Force -ErrorAction Stop
                Log "parado pid $($p.Id)"
            }
            catch {
                Log "falha ao parar pid $($p.Id): $($_.Exception.Message)"
            }
        }
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            if (-not (Get-Process -Id $vivos.Id -ErrorAction SilentlyContinue)) { break }
        }
        Log "processos restantes: $((@(Get-Process htc -ErrorAction SilentlyContinue)).Count)"
    }
}

if ($DryRun) {
    Log "DRYRUN: copiaria $Novo -> $Bin"
    Log "DRYRUN: abriria $($Sessoes.Count) sessao(oes) em $Cwd"
    exit 0
}

$backup = "$Bin.bak_$stamp"
Copy-Item $Bin $backup -Force
Log "backup: $backup"

$copiou = $false
for ($i = 0; $i -lt 20; $i++) {
    try {
        Copy-Item $Novo $Bin -Force -ErrorAction Stop
        $copiou = $true
        break
    }
    catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $copiou) { Log "ERRO: binario travado, instalacao abortada"; exit 1 }

$instalado = Get-Item $Bin
$origem = Get-Item $Novo
Log ("instalado: {0} bytes @ {1}" -f $instalado.Length, $instalado.LastWriteTime.ToString("HH:mm:ss"))
if ($instalado.Length -ne $origem.Length) { Log "ERRO: tamanho diverge do build"; exit 1 }

foreach ($sid in $Sessoes) {
    Start-Process -FilePath $Bin -ArgumentList "--id", $sid -WorkingDirectory $Cwd
    Log "aberta sessao $sid em $Cwd"
    Start-Sleep -Seconds 2
}

Start-Sleep -Seconds 3
$novos = @(Get-Process htc -ErrorAction SilentlyContinue)
Log ("processos apos reabrir: " + $(if ($novos.Count -eq 0) { "nenhum" } else { ($novos | ForEach-Object { $_.Id }) -join ", " }))
Log "fim"
