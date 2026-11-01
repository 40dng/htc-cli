# BUDDY — o peixe

O peixe é a cara do HTC: aparece no **instalador** e na **home da TUI**.
Não é comando — não existe `htc buddy` (removido de propósito).

## Onde aparece

| lugar | formato |
|---|---|
| instalador (`install.sh` / `install.ps1`) | 5 linhas, junto do banner HTC |
| home da TUI | 5 linhas, abaixo do banner, em gradiente |
| arte grande (opcional, fora do produto) | 52 × 120 embutida em `src/tui/assets/peixe.ts` |

`HTC_NO_BUDDY=1` esconde o peixe na home.

## Arquivos

- `src/tui/utils/buddy.ts` — `BUDDY` (compacto) + `corDaLinha()`
- `src/tui/assets/peixe.ts` — `PEIXE` (arte grande embutida; o binário compilado
  não lê arquivo ao lado do `.exe`)
- gradiente: `#FF5C7A → #A81E3B` (família do accent `#CB1B45`)

## Trocar a arte grande

```bash
bun scripts/peixe.mjs "<arquivo.txt>"   # regenera src/tui/assets/peixe.ts
bun run compile
```

## Trocar o compacto

Cinco linhas em `BUDDY`. Regra: no máximo 17 colunas para não empurrar o campo
de entrada em terminal de 80.

