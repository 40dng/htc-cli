# language: PowerShell, file: scripts/reinstalar-limpo.ps1, runtime: Windows 11 / PowerShell 5.1
# Bootstrap de apps DEPOIS do disco novo (ver docs/INCIDENTE-2026-10-29.md).
# Reinstalar por cima do Windows atual so devolve o PE para o infector reescrever:
# por isso o script recusa rodar com ameaca ativa, a menos que -Forcar.
# Instala por origem oficial e limpa node_modules (o stub infectado mora em .bin\*.exe).
#
#   -Forcar        roda mesmo com ameaca ativa (nao recomendado)
#   -SemApps       so limpa node_modules, nao instala nada
#   -Raizes         pastas de projeto cujo node_modules sera apagado
param(
    [switch]$Forcar,
    [switch]$SemApps,
    [string[]]$Raizes = @(
        "$env:USERPROFILE\Desktop\HTC",
        "$env:USERPROFILE\Desktop\Workbench"
    )
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logDir = Join-Path $env:USERPROFILE '.htc'
$log = Join-Path $logDir "reinstalar_$stamp.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

function Log([string]$msg) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

function Teste-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Log "inicio (forcar=$Forcar semapps=$SemApps admin=$(Teste-Admin))"

# --- guarda: nao adianta reinstalar app em disco infectado -----------------------------
$ativas = @(Get-MpThreat -ErrorAction SilentlyContinue | Where-Object { $_.IsActive })
$expiro = @($ativas | Where-Object { $_.ThreatName -like '*Expiro*' })
if (($ativas.Count -gt 0) -and -not $Forcar) {
    Log ("ABORTADO: {0} ameaca(s) ativa(s), {1} de Expiro. Formate primeiro." -f $ativas.Count, $expiro.Count)
    Log 'se realmente quer seguir, use -Forcar (nao recomendado)'
    exit 2
}

$pkgs = @(
    'Discord.Discord',
    'Telegram.TelegramDesktop',
    'Microsoft.VisualStudioCode',
    'MullvadVPN.MullvadVPN',
    'Python.Python.3.12',
    'StrawberryPerl.StrawberryPerl',
    '7zip.7zip',
    'Oven-sh.Bun'
)

if (-not $SemApps) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Log 'winget ausente: instale o App Installer antes de continuar'
    }
    else {
        foreach ($p in $pkgs) {
            Log "winget install $p"
            winget install --id $p -e --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 |
                ForEach-Object { Add-Content -Path $log -Value ("    " + $_) }
        }
    }
    Log 'Roblox e SoftEther: instalar manualmente pelo site oficial (nao existe pacote winget confiavel)'
}

# --- node_modules: apagar (stub infectado) e reinstalar do zero -----------------------
foreach ($raiz in $Raizes) {
    if (-not (Test-Path $raiz)) { Log "ausente: $raiz"; continue }
    $mods = @(Get-ChildItem $raiz -Directory -Recurse -Depth 4 -Filter 'node_modules' -Force -ErrorAction SilentlyContinue)
    foreach ($m in $mods) {
        Log ("apagando " + $m.FullName)
        Remove-Item -LiteralPath $m.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    $pkgJson = Join-Path $raiz 'app\package.json'
    $bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
    if ((Test-Path $pkgJson) -and $bun) {
        Log "bun install em $(Join-Path $raiz 'app')"
        Push-Location (Join-Path $raiz 'app')
        try { & $bun install 2>&1 | ForEach-Object { Add-Content -Path $log -Value ("    " + $_) } }
        finally { Pop-Location }
    }
}

# --- prova de que nao ha exclusao de antivirus ----------------------------------------
try {
    $pref = Get-MpPreference
    $exc = @($pref.ExclusionPath)
    if ($exc.Count -gt 0) { Log ("ATENCAO: exclusoes ativas no Defender: " + ($exc -join '; ')) }
    else { Log 'Defender sem ExclusionPath (correto)' }
}
catch { Log 'nao foi possivel ler Get-MpPreference (sem admin)' }

Log 'fim. Confira: bun --version, bun run typecheck, bun run compile'
exit 0
