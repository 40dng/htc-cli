# INSTALACAO — HTC

## Via curl (recomendado)

```bash
curl -fsSL https://prefeitodev.com/htc-cli/xinstaller | bash
```

O script:
- detecta SO/arquitetura (`darwin|linux` × `x64|arm64`);
- baixa `htc-<so>-<arch>` da versao `latest` (ou `HTC_VERSION`);
- instala em `~/.htc/bin/htc` e linka em `~/.local/bin/htc`;
- adiciona `~/.local/bin` ao PATH com a marca `# htc` (o `uninstall` remove).

Variaveis: `HTC_BASE`, `HTC_HOME`, `HTC_VERSION`.

## Via brew

```bash
brew install htc/pkg/htc
```
Formula em `app/dist/homebrew/htc.rb` (troque os `sha256` no release).

## Windows

```powershell
irm https://prefeitodev.com/htc-cli/xinstaller.ps1 | iex
```
Baixa `htc-windows-x64.exe` para `%USERPROFILE%\.htc\bin` e ajusta o PATH do usuario.
`-FromSource` forca npm + `bun run compile` (use so dentro de `app/`).

## Desinstalar

```bash
htc uninstall --yes            # remove binario, ~/.htc e a linha do PATH
htc uninstall --yes --keep-state   # preserva sessoes/config
htc uninstall                  # so mostra o plano, nao apaga
```

## Por que binario compilado

O modo fonte depende de `node_modules` com 300+ pacotes e o antivirus (Malwarebytes)
remove `.js` durante o install — 307 pacotes ficam vazios e o CLI nao sobe.
O binario unico (`bun run compile`) elimina `node_modules` do runtime:

```bash
bun run compile        # gera dist/htc (ou dist/htc.exe)
```

## Antivirus (Malwarebytes) — o que fazer

1. **Melhor**: instalar pelo binario (acima). Sem `.js` para o AV comer.
2. Se for rodar do fonte: Allow List → pasta `Desktop\HTC` (e o cache do bun).
3. Assinar o binario (Authenticode / Apple notarization) no release: reduz
   heuristic hit de "downloader" em binario novo sem reputacao.
4. Publicar hash SHA256 + pagina de release: o `install.sh` pode verificar e o
   usuario sabe o que esta rodando.

## Matriz (igual opencode)

| canal | comando |
|---|---|
| curl | `curl -fsSL https://prefeitodev.com/htc-cli/xinstaller \| bash` |
| brew | `brew install htc/pkg/htc` |
| npm | `npm install -g htc-cli` (postinstall baixa o binario nativo) |
| bun | `bun install -g --trust htc-cli` |
| Windows | `irm https://prefeitodev.com/htc-cli/xinstaller.ps1 \| iex` |
| binario | `latest/htc-<os>-<arch>[.exe]` |

Plataformas publicadas: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`,
`linux-x64-musl`, `windows-x64.exe`.

## CLI

| comando | papel |
|---|---|
| `htc` | TUI |
| `htc "<missão>"` / `htc run "<missão>"` | one-shot autônomo |
| `htc uninstall [--dry-run] [--force] [--keep-state]` | remove binário, `~/.htc` e PATH |
| `htc debug paths [config\|data\|cache\|state\|bin\|log]` | imprime caminhos |
| `htc doctor` | diagnóstico |
| `htc --version` | versão |

Atualizar = rodar o instalador de novo (mesmo caminho, sobrescreve o binário).

## Release (script)

```bash
bun run compile:all 1.0.0
# gera dist/release/1.0.0/{htc-windows-x64.exe,htc-darwin-*,htc-linux-*}
# + SHA256SUMS + version.txt
```
Sobe essa pasta como `prefeitodev.com/htc-cli/1.0.0/` e aponta `latest/`
(os dois caminhos são tentados pelo instalador e pelo postinstall).

