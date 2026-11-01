# ROADMAP — o que torna o MXC mais forte

## P0 (quebra a autonomia hoje)
1. **Auto-continue no interativo** — feito (`sendWithAutoContinue`).
2. **`?` não encerra mais o turno** — feito (`stopOnQuestion: false`).
3. **Integridade de dependências** — `mxc doctor` deve detectar pacote com só
   `package.json` e reparar via `npm pack` (o AV come `.js` do node_modules).
   Script pronto: `app/_repair.ps1`.
4. **Watchdog de turno** — se um `send()` não emitir evento por N minutos,
   abortar e reenviar (hoje a sessão fica pendurada sem sinal).

## P1 (potência)
5. **Fila persistente** (`state/fila.json`): `/atacar` enfileira; o loop consome
   a fila — a sessão nunca fica sem próximo passo.
6. **Retry de provedor com backoff** — erro de rede/compactação não mata o run.
7. **Compaction à prova de `reasoning_content`** — preservar o campo no resumo de
   histórico (a causa do `invalid_request_error` nos runs longos).
8. **Yield para prompt do operador**: se ele digitar no meio, o auto-continue
   pausa e o turno dele tem prioridade.
9. **`/estado`**: uma tela com alvo atual, fase, último achado e próximo passo.

## P2 (qualidade de vida)
10. **`/limpar`**: arquiva logs/artefatos por janela, com KEEP-LIST (nunca apaga
    ferramenta).
11. **`doctor --fix`**: node_modules, Python embeddable, proxies, permissões.
12. **Log estruturado por turno** (`state/logs/<sessao>/<turno>.json`): o que foi
    tentado, ferramenta, resultado — permite retomar sem reler transcript.
13. **Telemetria de custo por turno** e teto de gasto por sessão.
14. **Aliases de comando** (`:a` → `/atacar`) para entrada rápida.
15. **Docs vivas**: este diretório é a fonte; nenhum `.md` solto na árvore.
