# TERMINAL — identidade ao iniciar

Ao subir, o HTC faz duas coisas (nunca fatais — se falhar, a sessão continua):

## 1. Em runtime (TTY)

Emite sequências OSC no terminal atual:

| sequência | efeito |
|---|---|
| `OSC 0/2 ; htc` | título/ícone da janela = **htc** |
| `OSC 4 ; 1 ; #CB1B45` | slot *red* da paleta = vermelho da marca |
| `OSC 4 ; 9 ; #CB1B45` | *bright red* = idem |
| `OSC 10 ; #E8EAED` | foreground |
| `OSC 11 ; #0D0D0D` | background |

Desligar: `HTC_NO_IDENTITY=1`.

## 2. Windows Terminal (fragmento de perfil)

Arquivo (não altera o `settings.json` do usuário):

```
%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\htc\htc.json
```

Conteúdo: perfil **htc** com

- `icon`: `"\uEBE8"` (codicon **debug** / Segoe Fluent Icons)
- `tabColor`: `#CB1B45`
- `colorScheme`: **HTC** (fundo `#0D0D0D`, texto `#E8EAED`, cursor `#CB1B45`,
  `red`/`brightRed` na marca, verde/amarelo/azul/roxo do tema)
- `commandline`: o próprio binário (`~/.htc/bin/htc.exe`)

O fragmento é escrito **uma vez** e só reescrito se o conteúdo mudar. O Windows
Terminal lê fragmentos **no start** — feche e reabra o WT depois da primeira
execução para o perfil aparecer.

Prefere imagem no lugar do glifo? Troque `icon` pelo caminho do SVG/PNG:

```json
"icon": "C:/Users/<voce>/.htc/htc.svg"
```

## Instalar o binário globalmente

```powershell
# Windows: binário em ~/.htc/bin + PATH do usuário
Copy-Item app\dist\htc.exe $env:USERPROFILE\.htc\bin\htc.exe
# PATH: [Environment]::SetEnvironmentVariable('Path', "$env:Path;$env:USERPROFILE\.htc\bin", 'User')
```

Depois, em terminal novo: `htc`.

## Remover

```bash
htc uninstall --dry-run    # lista binários, ~/.htc e linhas de PATH
htc uninstall --force      # remove (o fragmento do WT sai com ~/.htc)
```

## Copiar texto

- arrastar o mouse na TUI seleciona e copia na hora (toast "Copiado");
- `Ctrl+Shift+C` copia a ultima selecao, mesmo depois de clicar fora;
- `Ctrl+C` com selecao ativa copia; sem selecao continua limpando a linha / saindo;
- selecao nativa do terminal (Shift+arrastar): use o Ctrl+Shift+C do terminal.

Diagnostico: `HTC_CLIPBOARD_DEBUG=1` grava `~/.htc/state/clipboard.log` com
len, resultado OSC52 e resultado do clipboard do sistema.
