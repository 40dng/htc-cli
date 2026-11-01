# WEB — o painel é outro cliente, não outro produto

`htc kanban` serve `app/web` (Next static export) + `src/server/web.ts` (`/api/*`).
O painel não reimplementa nada: lê o mesmo estado e chama as mesmas funções.

## Fonte única (nunca duplicar à mão)

| o quê | fonte | saída gerada |
|---|---|---|
| cores da marca | `src/paleta.ts` (+ superfícies no gerador) | `web/app/tokens.css` |
| fases da missão | `src/runtime/missao.ts` (`FASES`) | `web/lib/fases.json` |

```powershell
cd app
bun run scripts/gerar_tema_web.ts   # depois de mudar marca ou fases
```

Regra: componente do web não carrega hex solto. Se falta um tom, entra no gerador.

## Estado e ações

| rota | faz |
|---|---|
| `GET /api/missao` | missão viva (`ops/state/missao.json`) + notas de `ops/intel` |
| `POST /api/missao/fase` | `{alvo, fase}` → `definirFase()` do runtime |
| `POST /api/target/:alvo/fase` | arrasto do kanban: grava no banco da frota **e** na missão quando o host casa |

O kanban usa `lib/fases.json` para as colunas (recon, enum, vetor, exploit, shell,
pos) e sobrepõe o cartão do alvo da missão com fase/achados/validados/shells do
arquivo — o banco da frota é complemento, não a verdade.

## IA e prompt (chat ao vivo)

O chat do painel **é o CLI**: `POST /api/chat` responde SSE e faz spawn de
`HTC_WEB_AGENT_CMD` (default `bun run src/index.ts`) com `--json`, mais `-P/-m`
lidos de `~/.htc/data/settings/providers.json` e `--id` quando a sessão já existe.
Cada linha JSON do filho vira um evento SSE; o front renderiza `agent_event.text`,
mostra `tool` na meta e guarda o `sessionId` do `run_start` para continuidade.

- alvo escolhido no seletor → `abrirMissao()` antes do turno, então o bloco MISSION
  entra no prompt como no terminal;
- `HTC_WEB_PROVIDER` / `HTC_WEB_MODEL` sobrepõem o provider lido do disco;
- teste sem provider: `HTC_WEB_AGENT_CMD="bun run scripts/fake_agent.ts"`.

O dispatch por fila (`/api/dispatch` + `runner.ts`) continua existindo para lote.

## Acesso

- bind padrão **127.0.0.1**;
- `HTC_WEB_HOST` em interface roteável **exige** `HTC_WEB_TOKEN` (sem token: 403);
- com token, `/api/*` e `/events` pedem `authorization: Bearer <token>` ou `?token=`;
- comparação em tempo constante. Estático continua público (não expõe estado).

## Identidade

- marca: `web/components/brand/koi.tsx` (koi, `currentColor`) + `web/app/icon.svg`
- banner: wordmark HTC; nada de "MX" nem verde `#00ff88`
- tokens de fase: `--phase-recon|enum|vetor|exploit|shell|pos`

## Build e execução

```powershell
cd app/web
bun install
bun run build           # gera web/out (distDir = out)
cd ..
bun run src/index.ts kanban
```

`HTC_WEB_DIR` aponta para outro build; sem ele, o comando procura `web/out` ao lado
do binário, no repo e no cwd (nessa ordem). Sem `web/out`, falha dizendo o build —
não abre tela em branco. O pacote npm inclui `web/out` em `files`.
