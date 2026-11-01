# SIDEBAR — estado por sessao

A sidebar tem cinco widgets (`prefs.sidebar`): `maquina`, `sessao`, `operacao`,
`agentes`, `free`. Liga com `HTC_SIDEBAR=1`; cada widget liga/desliga em
`/config` → General.

O rodape mostra o diretorio de trabalho (duas ultimas pastas) e a versao do HTC
em execucao (`package.json` do build) — serve para saber, na hora, qual binario
esta rodando.

## O que cada um le

| widget | fonte | escopo |
|---|---|---|
| `maquina` | `useMaquina` (cpu/ram/load do SO) | global (e a maquina) |
| `sessao` | `useSession` (tokens, custo, estado, modo) | **do processo** |
| `operacao` | arquivo JSON | **da sessao** |
| `agentes` | mesmo arquivo JSON | **da sessao** |
| `free` | sonda dsh/gemini em loopback + catalogo do `htc-free` | global (e a maquina) |

### `free`

Duas linhas fixas (`dsh`, `gemini`) com o estado do canal:

| valor | significado |
|---|---|
| `off` | canal desligado em `prefs.free.*` |
| `n/a` | o canal nem existe na maquina (dsh nao instalado / porta nao declarada) |
| `:<porta>` | respondendo — a linha de baixo lista os modelos (`2 mod · gemini-4-argon, ...`) |
| `mudo` | existe e esta ligado, mas nao respondeu `/models` |

A ultima linha (`htc-free`) e o catalogo **persistido**: host do `baseUrl` e
quantidade de modelos que a sessao realmente tem. Ela aparece mesmo com os dois
loopbacks mudos — e o que responde "com o que eu conto agora" quando o dsh caiu.

A sonda tem cache de modulo e roda a cada 30s (timeout de 1,2s por canal), fora
do caminho de render: o re-render de 2s do widget `maquina` nao dispara rede.


## Arquivo

```
ops/state/htc_sidebar.<chave>.json
```

`<chave>` = `HTC_SIDEBAR_CHAVE` se definida, senao o **pid** do processo. Uma
sessao HTC e um processo, entao o pid separa duas janelas abertas no mesmo
workspace. O caminho absoluto desta sessao sai em `HTC_SIDEBAR_FILE`, publicado
no boot — **use essa variavel em vez de montar o nome**.

```bash
# o que a sessao atual espera
echo "$HTC_SIDEBAR_FILE"
```

## Formato

```json
{
  "alvo": "exemplo.com.br",
  "fase": "enum",
  "findings": 12,
  "validados": 3,
  "shells": 0,
  "agentes": [
    { "nome": "galho-auth", "estado": "rodando" },
    { "nome": "galho-lfi", "estado": "parado" }
  ],
  "atualizado": "2026-10-23T18:40:00Z"
}
```

Todos os campos sao opcionais. Sem arquivo, o painel mostra `sem estado` e nada
quebra. A leitura e a cada 5s.

## Compatibilidade

O arquivo antigo (`ops/state/htc_sidebar.json`, sem chave) **nao e lido por
padrao** — era exatamente ele que fazia duas sessoes mostrarem o mesmo painel.
Para voltar ao comportamento antigo numa sessao, exporte:

```bash
HTC_SIDEBAR_GLOBAL=1
```

Nesse modo a sessao tenta primeiro o arquivo dela e cai no global se o dela nao
existir.

## Por que nao ha um arquivo unico

Operacao e agentes sao estado **da sessao**: dois processos apontando para alvos
diferentes nao tem um "alvo atual" comum. O widget `sessao` sempre foi por
processo; operacao e agentes passaram a ser pelo mesmo motivo.

---

## Atualização 31/10 — o painel passou a mostrar o que o runtime já mede

O painel mostrava quatro linhas de `operacao` e um `agentes` que lia um campo
que **nenhum escritor preenchia**. Operação viva com 7 alvos na fila aparecia
`sem estado`. O que entrou:

| linha nova | origem |
|---|---|
| `objetivo` (linha cinza) | `missao.objetivo` no espelho |
| `há` / `missao fechada` | idade de `atualizado` — painel parado não parece painel vivo |
| `fila` `feito/total` | `state/fila.<sessao>.json` (leitura própria, sem carregar o runtime) |
| `curso` `em_curso · par N` | idem; amarelo quando há alvo estacionado |
| alvo da vez (linha cinza) | `em_curso`, senão o primeiro `novo` |

Seções novas:

- **PAYLOAD** — rótulo (`anon`, `capability`, `silence`), nível efetivo 1–3
  (amarelo em 3) e `rtk on|off`. O espelho é escrito por
  `applyBypassPayloadConfig` a cada rotação; antes a única forma de saber em que
  payload a sessão estava era abrir o código.
- **GALHOS** (o antigo `AGENTES`) — lê `state/galhos/<sessao>/*.relatorio`:
  quantidade, último id e idade. O campo `agentes` do espelho continua aceito
  como fallback, mas ninguém o escreve.

Escritores: `salvarMissao` e `applyBypassPayloadConfig` agora usam
`espelharSidebar()` (`utils/sidebar.ts`), que **mescla** o patch. Antes cada um
reescrevia o próprio conjunto e o campo do outro sumia.

Poll: **1s** (era 5s — a sidebar ficava um turno atrás).

Largura: `larguraSidebarEfetiva(termWidth, prefs.sidebarLargura)` em
`tui/utils/largura-conteudo.ts`, usada **pelos dois lados** — o componente para o
`width` e o markdown para descontar do conteúdo. Eram duas fórmulas (30 no
markdown, 42 no componente): toda tabela saía 12 colunas larga demais.

