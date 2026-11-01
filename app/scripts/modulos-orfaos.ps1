# modulos-orfaos.ps1 - lista modulos de src/runtime e src/session que ninguem importa
# nem menciona. Nasceu do achado 111: subagent-policy.ts ficou como codigo morto e o texto
# GALHOS nunca chegou ao modelo. Modulo sem importador nao e codigo, e anotacao.
# Fora do escopo: src/commands e src/tui (registro por tabela de comandos).
param(
  [string[]]$Raizes = @('src\runtime', 'src\session'),
  [switch]$IncluirTestes
)

$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Excecoes declaradas: modulo sem consumidor hoje, com motivo. Sem isso a ferramenta
# grita para sempre e ninguem mais olha o resultado.
$excecoes = @{
  'src\runtime\task-id.ts' = 'biblioteca de id com prefixo; consumidor sera o ponto de criacao de tarefa, que hoje e do core (@cline/core)'
}
$todos = Get-ChildItem (Join-Path $app 'src') -Recurse -Filter '*.ts' |
  Where-Object { $_.Name -notmatch '\.d\.ts$' }

$orfaos = @()
foreach ($raiz in $Raizes) {
  $arquivos = Get-ChildItem (Join-Path $app $raiz) -Recurse -Filter '*.ts' |
    Where-Object { $_.Name -notmatch '\.test\.ts$' }
  foreach ($arq in $arquivos) {
    $nome = [IO.Path]::GetFileNameWithoutExtension($arq.Name)
    $usado = $false
    foreach ($cand in $todos) {
      if ($cand.FullName -eq $arq.FullName) { continue }
      if (($cand.Name -match '\.test\.ts$') -and (-not $IncluirTestes)) { continue }
      $hit = Select-String -Path $cand.FullName -Pattern ([regex]::Escape($nome)) -ErrorAction SilentlyContinue
      if ($hit) { $usado = $true; break }
    }
    if (-not $usado) {
      $rel = $arq.FullName.Replace($app, '').TrimStart('\')
      if (-not $excecoes.ContainsKey($rel)) { $orfaos += $rel }
    }
  }
}

"modulos sem importador nem mencao: $($orfaos.Count)"
$orfaos | Sort-Object | ForEach-Object { "  $_" }
