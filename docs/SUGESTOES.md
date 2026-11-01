# SUGESTOES — o que deixa o HTC mais forte

## 1. Orquestrador de agentes (o que falta de verdade)

Hoje "galhos" = subagentes in-process, sem fila, sem estado, sem retomada.
Proposta: **orquestrador com fila persistente**.

```
state/fila.json          tarefas (id, alvo, fase, dono, lease, depends_on)
state/agentes/<id>.json  estado do galho (fase, ultimo passo, artefatos)
```

- `claim` atomico (lease + timeout) — nunca dois galhos no mesmo alvo.
- Retomada: sessao nova le a fila e continua de onde parou.
- Dependencia entre fases (recon -> enum -> exploit) como gate.
- Painel: `/fila` mostra o que roda, o que espera, o que travou.

## 2. Containers leves

Rodar ferramenta em container por tarefa (isolamento + reprodutibilidade), sem
Docker Desktop: **`limactl`/`podman machine`** ou **microVM (Firecracker)**.
Alternativa Windows-native: `wslc` com imagem minima (alpine + toolset).
Contrato: `htc run --container <imagem> -- <cmd>`; o agente nunca executa no host.

## 3. Instalacao tranquila

- `install.ps1` ja existe: exclusao AV -> npm install -> reparo -> valida.
- Falta: **checar exclusao automaticamente** (tentar escrever um `.js` em
  node_modules e reler) e abortar com mensagem clara se o AV estiver comendo.
- Falta: binario pre-compilado (`bun build --compile`) para nao depender de
  `node_modules` em runtime — resolve 90% do problema de instalacao.

## 4. Provider local sem API key

Ja existe (`-P opencode` -> SDK local -> modelos free). Falta:
- `/model` listar so os modelos com `cost 0` quando nao houver chave;
- fallback automatico para modelo free se o pago falhar (402/401);
- mensagem clara: "sem chave: 7 modelos free disponiveis".

## 5. Markdown no fim da sessao

Bug: o texto final sai cru (`**texto**`). O renderer so roda no TUI. Falta um
`renderMarkdownToAnsi()` usado tambem no caminho de texto (one-shot) e no
`/report`. Ver `docs/TEMA.md` (paleta) + `src/tui/utils/syntax-style.ts`.

## 6. Slash commands

- Removidos: `atacar`, `pwn`, `snipar`, `fc`, `bpon`, `opsec`, `checkip`
  (eram prompts maquiados, nao comandos).
- Fundir `settings` + `config`; documentar `create` e `report`.
- Novos que fazem falta: `/estado`, `/fila`, `/limpar`, `/tema <id>`.

## 7. Marca

- Varredura final de strings `MXC`, `Cline`, `opencode` em UI/help/welcome.
- Variaveis de ambiente: aceitar `HTC_*` com fallback para `MXC_*` (compat).
- Banner/icone: `japan.svg` no README; no terminal, glifo ASCII (SVG nao renderiza).

## 8. Observabilidade

- Log por turno em `state/logs/<sessao>/<turno>.json` (ferramenta, args, duracao, erro).
- Custo por turno e teto de gasto por sessao.
- `/doctor --fix` cobrindo: node_modules, AV, proxies, permissao de pasta.
