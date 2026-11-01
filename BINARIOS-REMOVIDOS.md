# BINARIOS COMPILADOS REMOVIDOS — LEIA ANTES DE USAR

Este pacote HTC vai **sem nenhum executavel Windows de proposito**. Os binarios que existiam
na arvore vieram de uma maquina que teve **infeccao de arquivo (Virus:Win64/Expiro)**.
Nenhum deles viaja nesta entrega e nenhum foi copiado para o disco novo.

## O que foi removido do pacote

| item | tamanho | o que era |
|---|---|---|
| `entrega.zip` | 651.885.525 B | release 1.0.0 + latest: 7 binarios x2 (`htc-windows-x64.exe` 117 MB incluso) |
| `app\_natives\core-win32-x64\opentui.dll` | 3.765.640 B | DLL nativa do TUI (build do `@opentui/core`) |
| `app\dist\htc.exe` | 117.969.920 B | binario unico gerado por `bun run compile` |
| `app\dist\release\1.0.0\htc-windows-x64.exe` | 117.855.232 B | release windows |
| `app\node_modules\**\.bin\*.exe` (~40 arquivos) | 46.592 B cada | shims de CLI que o bun/npm cria (todos o mesmo stub) |

Mantidos: `app\_natives\core-linux-*\libopentui.so` e `@opentui/core-linux-*` — sao ELF de
Linux e um infector de PE do Windows nao os toca.

## Como reconstruir depois de formatar (Windows)

```powershell
# 1. bun
winget install --id Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements

# 2. dependencias (dentro de HTC\app)
cd HTC\app
bun install

# 3. build
bun run build      # dist/ em JS (roda com bun)
bun run compile    # binario unico: dist\htc.exe  (use este no Windows)
```

Se o antivirus comer `.js` durante o `bun install` (aconteceu neste host: 307 pacotes
ficaram vazios), coloque `HTC\app` e o cache do bun na allow-list **antes** do install —
ou ver `docs\INSTALL.md`, secao "Antivirus (Malwarebytes)".

## Se o compile falhar em `./opentui.dll`

`bun run compile` resolve `@opentui/core-win32-x64/opentui.dll` em tempo de build. Sem
o DLL (removido junto com os binarios antigos) o build morre em
`Could not resolve: "./opentui.dll"`. Restaure so esse pacote:

```powershell
cd HTC\app
Remove-Item node_modules\@opentui\core-win32-x64 -Recurse -Force
bun install          # baixa de novo o pacote 0.4.3 com o DLL (3.7 MB)
bun run compile      # dist\htc.exe
```

Depois do compile, o painel precisa do build web ao lado do executavel:

```powershell
Copy-Item web\out dist\web\out -Recurse -Force
```

## Regra que vale para o resto da entrega


Nunca copie para a maquina nova um `.exe` / `.dll` / `.node` / `.pyd` vindo do disco antigo.
Recompile (como acima) ou baixe de novo da origem. Binario antigo nao tem como ser
"limpo por confianca" — so por rebuild.

## Conferencia de hash

`_SISTEMA\HTC_BINARIOS_SHA256.txt` tem o SHA256 de 1.033 arquivos desta arvore no estado em
que ela foi medida (inclui os binarios removidos, para registro). Use como referencia de
integridade do **codigo-fonte**: o que voce reconstruir tera hash diferente (build nao e
reproduzivel byte-a-byte) — isso e esperado.

