# ESTADO — onde o HTC grava

| dado | caminho |
|---|---|
| settings, sessions, db | `~/.htc/data/` |
| binario + runtime | `~/.htc/bin/`, `~/.htc/runtime/` |
| telemetria de recusa | `~/.htc/state/recusas.jsonl` |
| sidebar (opcional) | `<projeto>/ops/state/htc_sidebar.json` |

## Migracao do runtime antigo

O HTC herdou `~/.cline/data` do runtime. Na primeira execucao ele copia, **item a
item e sem sobrescrever**, `settings/`, `sessions/` e `db/`. Se o diretorio novo
ja existir (tem cache/db), so o que falta e trazido.

## Variaveis

| var | efeito |
|---|---|
| `HTC_STATE_DIR` | usa outro diretorio de dados (nao migra nada) |
| `HTC_KEEP_CLINE_DIR=1` | volta ao comportamento antigo (`~/.cline/data`) |
| `HTC_MOSTRAR_PENSAMENTO=1` | volta a mostrar o rascunho do modelo ("Thinking") na conversa; desligado por padrao |
| `--config <dir>` | forca um diretorio especifico para a execucao |

## Por que isso importa

Sem unificar, o HTC gravava modelo/chave em `~/.cline` — dois produtos no mesmo
diretorio, e apagar o Cline apagava a configuracao do HTC. Agora `rm -rf ~/.cline`
nao derruba o HTC.
