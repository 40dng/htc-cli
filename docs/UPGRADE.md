# UPGRADE — duas trilhas, uma release

## Canal padrao (vivo desde 01/11)

```bash
HTC_BASE=https://github.com/40dng/htc-cli/releases/latest/download
```

E o default de `upgrade.ts` — `htc upgrade` funciona sem env var. A release
publica os tres assets **planos** (`htc-windows-x64.exe`, `version.txt`,
`SHA256SUMS`), que e' exatamente o namespace de `/releases/latest/download`.
`HTC_BASE` continua valendo para site estatico proprio; nesse caso o cliente
tenta `<base>/<canal>/<nome>` primeiro e cai no plano se o aninhado der 404.

## Como funciona

O cliente pergunta ao servidor qual e a versao publicada em
`HTC_BASE/<canal>/version.txt` (`latest` por padrao) e compara com a sua.

```bash
htc upgrade --check     # so mostra: HTC e runtime
htc upgrade             # baixa, verifica SHA256 e troca o binario
htc upgrade --force     # reinstala a versao atual (reparo)
```

Troca do binario em uso (Windows inclusive): grava `htc.new`, move o atual para
`htc.old`, renomeia o novo para o lugar e apaga o `.old`. Nada de "feche o
programa primeiro".

## Trilha HTC

`latest/htc-<os>-<arch>[-musl][.exe]` + `latest/version.txt` + `latest/SHA256SUMS`.
Sem `SHA256SUMS` o upgrade recusa o download incompleto; com ele, compara e
aborta se nao bater.

## Trilha runtime (cline)

O runtime **nao tem release propria**: ele viaja com o HTC.

- `latest/runtime.txt` guarda `<versao-do-@cline/core>+htc.<versao-do-htc>`;
- o cliente grava o que aplicou em `~/.htc/runtime/version`;
- versao diferente -> baixa `latest/runtime-<versao>.tar` e aplica;
- se `runtime.txt` nao existir, o upgrade informa que o runtime vem embutido.

Consequencia pratica: **o runtime so muda para todo mundo quando o HTC solta
release** — que e o comportamento pedido.

## Limpeza

Todo `htc upgrade` (sem `--check`) roda a limpeza:

| alvo | motivo |
|---|---|
| `~/.htc/tmp` | temporarios da instalacao |
| `~/.htc/bin/*.old` | binario antigo do swap |
| `%TEMP%/.bun-*` com +24h | DLL extraida pelo runtime ao abrir o binario compilado |

`.bun-*` de menos de 24h fica: pode estar em uso pela sessao aberta.

## Falha de rede

Servidor fora do ar nao quebra nada: o comando avisa `release inalcancavel`,
sai com codigo 1 e o binario atual continua valido. Nao existe upgrade parcial.
