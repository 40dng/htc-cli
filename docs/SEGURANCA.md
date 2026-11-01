# SEGURANCA — vazamento de fonte e dados

## O que estava vazando

| vetor | onde | efeito |
|---|---|---|
| stack trace no JSON | `src/utils/output.ts` | caminho absoluto, nomes internos, estrutura de pastas |
| sourcemap | script `build` sem `--sourcemap=none` | rebuild do fonte a partir do `.js` publicado |
| tarball npm | sem `files` | `src/`, testes e artefatos iam junto no pacote |
| copia antiga | `app/_arquivo/velho_*/` | prompts e código morto versionados |
| logs de sessão | `~/.htc/data/**` | conversa inteira, credenciais coladas |

## O que ja foi corrigido

- `build` e `compile`: `--minify --sourcemap=none`
- `package.json`: `"files": ["dist"]` (npm publica so o binario)
- `jsonReplacer`: `stack` **somente** com `HTC_DEBUG=1`
- `_arquivo/` removido da arvore

## O que falta (checklist de release)

1. `bin` publicado deve ser o **compilado** (`--compile`), nunca `src/main.ts`.
2. Verificar o pacote antes de subir: `npm pack --dry-run` → nao pode listar `src/`.
3. `dist/` no `.npmignore`? Nao: `files` ja limita; conferir a cada release.
4. Varredura de segredo no binario: `strings dist/htc | rg -i "token|secret|BEGIN .*PRIVATE"`.
5. Logs: rotacao + permissao `600`; nunca em `state/` compartilhado.
6. Telemetria: nenhuma por padrao; se houver, opt-in explicito e endpoint documentado.
7. Erro em producao: mensagem curta + codigo; nunca `throw` cru no stdout.

## Regra de bolso

Se o artefato publicado permite reconstruir `src/`, o segredo que estava no
codigo deixa de ser segredo. O binario e o contrato; o fonte nao viaja.
