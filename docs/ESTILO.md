# ESTILO — como o código do HTC é escrito

## Comentário

Regra: **comentário explica o porquê, nunca o quê**. O quê está no nome.

```ts
// ruim — narra o código
// verifica se o arquivo existe e retorna
if (!existsSync(p)) return;

// bom — explica a decisão que o leitor não deduz
// AV come .js de node_modules entre o install e o primeiro import
if (!existsSync(p)) return;
```

Não escrever:
- cabeçalho de arquivo descrevendo o óbvio ("este módulo faz X");
- bloco acima de cada função repetindo a assinatura;
- comentário de seção (`// ===== Helpers =====`) salvo quando o arquivo passa de ~400 linhas;
- "// TODO" sem dono e sem prazo;
- tom de tutorial.

Escrever:
- a razão de um número mágico (`// 60 req/h: limite do provedor`);
- a alternativa descartada, quando alguém vai tentar de novo (`// lock global serializou a descoberta`);
- a armadilha de plataforma (`// Windows: `?` no fim de turno não é pergunta`);
- a origem de um dado externo (`// campo vem do bundle, não da API`).

Densidade alvo: **1 comentário a cada 20–40 linhas**. Se um arquivo tem bloco de
comentário em cima de quase toda função, o código está se explicando por falta de
nome bom — rename é a correção, não comentário.

## Nome

- `snake_case` para função/variável/arquivo; `PascalCase` só em React/classe.
- Nome diz o efeito: `remover_do_path`, `garantir_fragmento`, não `handle`/`processa`.
- Booleano com prefixo de estado: `eh_continuacao`, `tem_estado`, `skip_fragment`.
- Tipo/constante exportada em `SCREAMING_SNAKE` só quando é limite de domínio
  (`MAX_AUTO_CONTINUES_PADRAO`), nunca para config local.

## Estrutura

- Um módulo = uma responsabilidade. `commands/*` é CLI; `utils/*` é função pura;
  `runtime/*` orquestra.
- Efeito colateral isolado em função com nome de verbo (`aplicar_`, `gravar_`, `iniciar_`).
- Erro como valor quando o chamador decide; `throw` só para invariante quebrada.
- Nada de `any` para calar o compilador — `unknown` + narrowing.
- Import relativo curto; sem `index.ts` barrel que reexporta tudo.

## Identidade visual

- Cor de marca: `#CB1B45`. Não existe verde ofensivo no produto.
- Verde continua significando **adicionado** em diff, e só nisso.
- Toda cor nova entra em `src/tui/palette.ts` (TUI) ou `src/paleta.ts` (legado),
  nunca solta no componente.

## Barra lateral (widgets e graficos)

A sidebar liga sozinha em terminal com **>= 110 colunas** (`HTC_SIDEBAR=0` desliga,
`=1` forca). Os widgets vem de `~/.htc/state/prefs.json` e tambem podem ser
alternados em `/settings` (aba General) ou por `htc providers` (canais free):

```json
{
  "sidebar": { "maquina": true, "sessao": true, "operacao": true, "agentes": true },
  "sidebarLargura": 42
}
```

- `maquina`  -> `src/tui/components/sidebar.tsx` (cpu/ram/load)
- `sessao`   -> tokens, custo, estado, modo
- `operacao` -> alvo, fase, validados, shells
- `agentes`  -> branches do time (maximo 6 linhas)

### Graficos

Nao usamos sparkline de blocos (o do OpenCode). Em `src/tui/utils/chart.ts`:

- `graficoBraille(serie, largura, altura, {min,max})` — linha continua em braille,
  **2x4 pontos por celula** (8x a resolucao de um bloco). A serie e esticada para
  a largura inteira por interpolacao linear, sem buraco a esquerda.
- `barraOitavos(fracao, largura)` — barra com oitavos (blocos parciais de 1/8) e trilho em cinza.
- `ESCALA_PCT` — CPU/RAM fixos em 0..100, para o grafico nao "respirar" quando
  o valor oscila entre 2% e 3%.
