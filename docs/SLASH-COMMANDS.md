# SLASH COMMANDS — inventário e organização

Registro: `src/tui/commands/slash-command-registry.ts`

## Sessão / configuração
| comando | papel |
|---|---|
| `/settings` | painel de configurações |
| `/config` | editar config (~/.mxc) |
| `/model` | trocar modelo/provider |
| `/theme` | tema da TUI |
| `/account` | conta / créditos |
| `/compact` | compactar contexto |
| `/clear` | limpar a conversa |
| `/undo` | desfazer último turno |
| `/fork` | ramificar a sessão |
| `/history` | histórico de sessões |
| `/help` | ajuda |
| `/quit` | sair |

## Ferramentas / extensões
| comando | papel |
|---|---|
| `/tools` | ferramentas disponíveis |
| `/mcp` | servidores MCP |
| `/plugins` | plugins |
| `/skills` | skills |
| `/create` | criar skill/plugin |
| `/report` | gerar relatório da sessão |

## Operação (custom)
| comando | papel |
|---|---|
| `/atacar` | dispara o pipeline de ataque no alvo |
| `/pwn` | executa o passo de exploração |
| `/snipar` | recorta/extrai artefato |
| `/fc` | (definir) |
| `/bpon` | (definir) |
| `/opsec` | checa higiene/pegada |
| `/checkip` | valida egress/IP |

## Problemas a resolver
1. `/settings` e `/config` colidem conceitualmente — fundir em `/config` com abas.
2. `/fc`, `/bpon` não têm descrição clara → documentar ou remover.
3. Falta `/fila` (ver/editar a fila de trabalho) e `/estado` (onde estamos, 1 tela).
4. Falta `/limpar` (faxina de logs/artefatos) — hoje é script externo.
5. Comandos de operação (`/atacar`, `/pwn`) deveriam aceitar alvo inline e
   empurrar para a fila em vez de bloquear a sessão.
