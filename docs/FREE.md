# FREE — endpoint local sem API key

O HTC fala OpenAI-compatible. Qualquer coisa que exponha `/v1/models` e
`/v1/chat/completions` em loopback serve de provider — **sem chave paga**.

## Os dois canais (e só esses dois)

| canal | o que é | onde o HTC procura |
|---|---|---|
| `dsh` | forward do plugin `dsh-our-free-model` | porta/chave em `DSH_HOME/our-free-model/*.json`; binário `dsh` no PATH |
| `gemini` | servidor `free-gemini-api` (Go) | `http://127.0.0.1:8001/v1` (portas 8000/8081 como reserva) |

`HTC_FREE_BASE` (+ `HTC_FREE_KEY`) sobrepõe os dois — é override manual, não um
terceiro canal. `GEMINI_FREE_BASE` / `HTC_GEMINI_BASE` movem só o gemini.

Os canais `opencode` (SDK) e `oneprovider` (gateway remoto) saíram: não são
loopback e apareciam como 3ª/4ª linha free no `/settings`.

## dsh-our-free-model (avaliado)

`github.com/Ebony-Vinyl/dsh-our-free-model` é um plugin do harness *dsh* que
abre uma lane gratuita para modelos de fronteira (DeepSeek V4.1 Flash, Kimi K3)
sem login nem API key. Pontos que importam para nós:

- expõe **OpenAI-compatible** em loopback, com whitelist
  `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`,
  `/v1/messages/count_tokens`;
- exige **chave gerada pelo plugin** (timingSafeEqual, arquivo 0600) — não é
  aberto na máquina;
- binding só em `127.0.0.1` (recusa interface roteável); LAN é opt-in com outra chave;
- backend são tiers gratuitos de terceiros (Kilo etc.) — o próprio README avisa
  que prompt **pode ser registrado pelo upstream** e que a cota pode sumir.

Conclusão: serve como **canal de teste**, não como canal de produção — a lane é
de terceiro, sem SLA, com prompt potencialmente logado.

## Usar no HTC

1. suba o plugin (ele imprime a porta e a chave no painel);
2. aponte o HTC:

```bash
htc free --base http://127.0.0.1:<porta>/v1 --key <chave>
# → lista os modelos e imprime o comando pronto

htc "missao" -P openai-compatible -k <chave> -m <modelo>
```

Variáveis equivalentes: `HTC_FREE_BASE`, `HTC_FREE_KEY`.

`htc free` só faz `GET /v1/models` — nada de prompt, nada de gasto.

## Regra de uso

Prompt nosso é material de trabalho. Canal free de terceiro não recebe alvo
real, credencial, PII nem payload. Para o trabalho de verdade: provider pago ou
modelo local (Ollama/LM Studio em `openai-compatible`).
