# KALI (WSL) dentro do HTC

## Por que

Binário dual-use não sobrevive no NTFS com o Bitdefender ativo: ele bloqueia a **criação** do
arquivo (verificado — `chisel.exe` dá "acesso negado" ao extrair, e os payloads do ART são
quarentenados como `Trojan.GenericKD`/`Gen:Variant.Tedy`). Isso não é falso positivo: são injetores
`T1055` e `T1003` de verdade.

A saída é rodar essas ferramentas dentro do **Kali em WSL**, cujo filesystem o antivírus do Windows
não varre. O HTC continua sendo o ponto de entrada: ele chama `kali <comando>` como qualquer outro
executável do PATH.

## Instalação

```powershell
# uma vez, como administrador (habilita WSL + VirtualMachinePlatform e exige reboot)
wsl --install -d kali-linux --no-launch
# depois do reboot
wsl -d kali-linux -- apt update
```

## Uso a partir do HTC

O wrapper fica em `~\.htc\bin\kali.cmd`, que já está no PATH de usuário:

```powershell
kali nmap -sV 10.0.0.10
kali ffuf -u https://alvo/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt
kali sqlmap -u "https://alvo/item?id=1" --batch
kali chisel --version          # instale antes: kali apt install -y chisel
```

Dentro do Kali, `htc` também enxerga o disco do Windows em `/mnt/c/...`.

## Arsenal

```bash
# ART: extrair dentro do Kali (o tarball está no Windows)
mkdir -p /opt/art
tar -xzf /mnt/c/Users/<usuario>/Desktop/Workbench/arsenal/atomic-red-team.tar.gz -C /opt/art
ls /opt/art/atomic-red-team-master/atomics | head

# chisel: vem do repositório do Kali, binário Linux (não passa pelo AV do Windows)
sudo apt install -y chisel
```

No Windows ficam apenas os **arquivos** oficiais (`atomic-red-team.tar.gz`, `chisel-windows-amd64.zip`)
como fonte, íntegros e inertes. Nunca por exclusão de antivírus: a exclusão em `Desktop\Workbench`
foi o que deixou o infector de 28/10 circular livremente.

## Verificação rápida

```powershell
wsl -l -v            # deve listar kali-linux, VERSION 2, STATE Running/Stopped
kali uname -a
kali which chisel nmap sqlmap
```

## Estado verificado em 29/10 20:55

| item | valor |
|---|---|
| WSL | **3.0.3.0**, kernel **6.18.54.1-microsoft-standard-WSL2** |
| distro | **Kali GNU/Linux Rolling 2026.2**, WSL2, usuário padrão **`mx`** |
| wrapper | `~\.htc\bin\kali.cmd` → `wsl.exe -d kali-linux -- %*` (no PATH) |
| ferramentas | `chisel 1.12.1-0kali2`, `nmap 7.99`, `sqlmap 1.10.8#stable`, `ffuf 2.1.0-dev`, `nikto`, `whatweb`, `gobuster`, `dirb`, `jq`, `socat`, `nc` |
| ART | `/opt/art/atomic-red-team-master` — **349 técnicas**, **43 payloads .exe**, legível por `mx` (root:root 755) |

### DNS do WSL (precisa, senão `apt` não baixa)

O host usa DNS não-público (`192.0.2.53/1`) e bloqueia `1.1.1.1`/`8.8.8.8`. O proxy do WSL
(`10.255.255.254`) não repassa, então o Kali fica sem resolver. Correção aplicada:

```bash
printf "[network]\ngenerateResolvConf = false\n" | sudo tee /etc/wsl.conf
printf "nameserver 192.0.2.53\nnameserver 192.0.2.54\n" | sudo tee /etc/resolv.conf
```

Consequência: `sudo` no Kali pede a senha do `mx` (não é NOPASSWD).

## Rust no Windows sem Visual Studio (GNU)

```
rustup toolchain: stable-x86_64-pc-windows-gnu  (default)
mingw-w64:        C:\Users\Public\mingw64\bin   (WinLibs 16.2.0, UCRT)
build de prova:   exit=0, "Hello, world!", em 2m17s
```

**Atenção:** o mingw **não aceita caminho com espaço**. O pacote do winget fica em
`C:\Users\<usuario>\AppData\Local\...` e o `ld.exe` quebra (`cannot find C:/Users/Daniel`).
Por isso a cópia foi para `C:\Users\Public\mingw64` — se o PATH apontar para o caminho com espaço,
o link falha mesmo com tudo instalado.

```powershell
$env:PATH = "C:\Users\Public\mingw64\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo build
```

