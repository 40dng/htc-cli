# HTC — Hatachi

CLI de agente para operacao tecnica: sessao, ferramentas, galhos (subagentes),
modo autonomo e temas. "Hatachi" e japones; abreviacao **HTC**. Simbolo do
projeto: `https://color-term.com/assets/img/hero/japan.svg`. Cor de marca: **#CB1B45**.

```
    __  ______________
   / / / /_  __/ ____/     HTC - Hatachi
  / /_/ / / / / /          terminal de operacoes
 / __  / / / / /___
/_/ /_/ /_/  \____/
```

## Estrutura

```
HTC/
  app/        codigo (src, package.json, install.sh, install.ps1, scripts/)
  docs/       AUTONOMIA, TEMA, TERMINAL, ESTILO, INSTALL, SEGURANCA, SUGESTOES
  entrega/    pacote pronto para subir em prefeitodev.com (ver SUBIR.md)
  README.md
```

## Instalacao

```bash
curl -fsSL https://prefeitodev.com/htc-cli/xinstaller | bash
brew install htc/pkg/htc
```

Windows: `irm https://prefeitodev.com/htc-cli/xinstaller.ps1 | iex`.
Do fonte: `cd app && bun install && bun run compile`.
Remover: `htc uninstall --dry-run` (plano) e `htc uninstall --force`.
Detalhes e AV: `docs/INSTALL.md`.

## Uso

```bash
htc                                 # TUI
htc "missao"                        # one-shot autonomo
htc run "missao" --max-auto-continues 200
htc debug paths                     # caminhos locais
```

## Provider local (sem API key)

`-P opencode -m <modelo-free>` usa o SDK local: nao precisa de chave. Chave so
para modelo pago.

## Regras

- Turno nao termina em "board": termina em `[FIM]`, marcador de bloqueio ou teto.
- Bloqueio e o proximo alvo: contorna e segue.
- Codigo segue `docs/ESTILO.md` (comentario explica o porque, nunca o que).
- Estado do operador em `state/`, nunca na arvore do codigo.


ANTES: adicione a exclusao da pasta `Desktop\HTC` no antivirus
(Malwarebytes > Allow List; Defender > Exclusoes). Sem isso o AV remove os `.js`
do `node_modules` e o CLI nao sobe (`Cannot find module`).

## Uso

```powershell
# interativo (TUI)
bun run app/src/index.ts

# one-shot autonomo: o runtime retoma a fila sozinho ate [FIM]
bun run app/src/index.ts "<missao>" -P opencode -m deepseek-v4.1-flash --thinking none `
  --auto-continue true --max-auto-continues 200
```

## Provider local (sem API key)

O provider `opencode` sobe o SDK local e encaminha em background para os modelos
gratuitos do OpenCode: **nao exige chave**. Chave so e necessaria para modelo pago.

## Regras

- Turno nao termina em "board": termina em `[FIM]`, marcador de bloqueio ou teto.
- Bloqueio e o proximo alvo: contorna e segue.
- Estado do operador em `state/`, nunca na arvore do codigo.
