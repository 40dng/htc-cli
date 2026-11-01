# TEMA — cor, legibilidade e tema custom

## Marca

- Accent (act/selection): **#CB1B45**
- Plan: `#E4597A` · Success: `#4CC38A` · Error: `#FF5C5C`
- Tema padrao: id `htc` ("HTC"), fundo `#0d0d0d`, texto `#e8eaed`
- Renomeados: `Cline Dark` -> **Neutro Dark**, `Cline Light` -> **Neutro Light**

Arquivos: `src/tui/palette.ts` (marca) e `src/tui/themes.ts` (temas + sintaxe).

## Markdown legivel

Antes o corpo inteiro saia na mesma cor. Agora cada elemento tem tom proprio:

| elemento | cor |
|---|---|
| corpo | `#DDE1E6` |
| titulo / negrito / lista | accent `#CB1B45` |
| codigo inline | `#E8B04B` (ambar) |
| italico | `#F2A6B8` |
| citacao / muted | `#8A9099` |

Mapa em `src/tui/utils/syntax-style.ts` (`markup.heading*`, `markup.strong`,
`markup.raw.inline`, `markup.italic`, `markup.quote`).

## Tema custom

Formato (JSON), em `~/.htc/themes/<nome>.json`:

```json
{
  "id": "meu-tema",
  "label": "Meu Tema",
  "description": "teste",
  "variant": "dark",
  "background": "#101014",
  "foreground": "#e6e6e6",
  "accents": { "act": "#CB1B45", "plan": "#E4597A", "success": "#4CC38A", "error": "#FF5C5C" },
  "syntax": { "keyword": "#c792ea", "string": "#c3e88d", "comment": "#5f6672" }
}
```

Pendente de fiacao (proximo commit): carregar `~/.htc/themes/*.json` em
`THEMES` antes de `THEMES_BY_ID` e aceitar `/theme <id>` com id de arquivo.
