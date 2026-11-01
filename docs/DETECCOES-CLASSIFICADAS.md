# DETECÇÕES CLASSIFICADAS — 2026-10-29

Consolidação de tudo que os dois motores acusaram neste host, com veredito e ação.
Fontes: `Get-MpThreatDetection` (92 registros), quarentena do Bitdefender (64 itens,
`IR\20261029_045738\bitdefender-quarentena.csv`) e as varreduras dirigidas.

## Categorias

| # | categoria | significado |
|---|---|---|
| **A** | malware real | executa por conta própria; precisa sair |
| **B** | infecção secundária | arquivo legítimo **reescrito** pelo infector; não é malware de origem |
| **C** | dual-use | ferramenta ofensiva legítima; não é vírus, mas é risco operacional |
| **D** | payload de teste | conteúdo de repositório público (ART/LOLBAS/Payloads) |
| **E** | FP de conteúdo | documentação que **contém** payload como texto |
| **F** | obsoleto | registro do AV cujo arquivo já não existe |

## A — Malware real

| família | motor | o que é | onde apareceu | ação |
|---|---|---|---|---|
| `Virus:Win64/Expiro.BA!MTB` | Defender | **file infector** de PE (grava em `.exe/.dll`, cria `.tmp`, troca) | 35 registros, perfil inteiro | quarentenado/removido; 57/61 caminhos já não existem |
| `Trojan:Win64/Tedy.GPKM!MTB`, `Tedy!rfn` | Defender | downloader/loader, o "carona" do kit | `Claude Attack\mxc-cli\**\.bin\*.exe` | kit removido (35.363 arq) |
| `Trojan:Win64/HashvaultMiner.A` | Defender | minerador | cache do bun | removido |
| `Trojan:Win64/Cerbu.ARA!MTB` | Defender | loader | perfil | removido |
| `Trojan:Win32/SchoolBoy.GA!MTB` | Defender | stealer/backdoor | Desktop | removido |
| `Sabsik.EN.D`, `Commando.A`, `Yomal`, `Kepavll`, `Acll`, `Wacatac.A/B/H`, `Ravartar` | Defender | loaders/empacotadores | shims e cache npm/bun | removido |
| `ShellcodeInject.INC/TEM/GLN/RTS` | Defender | injetor de shellcode | `arsenal\atomic-red-team\atomics\T1055` | repos removidos |
| `Trojan:Win32/Gamaredon.PSYO` | Defender | APT russo (script) | arsenal | repo removido |
| `Trojan:MacOS/Empyre.D` | Defender | malware de **macOS** (inócuo aqui) | arsenal | repo removido |
| `Phave.MK`, `Malgent`, `Skeeyah` | Defender | trojans genéricos | arsenal | repo removido |
| `Trojan.Generic.40367759` | Bitdefender | dropper do infector | `.config\htop\true.exe` | quarentenado |
| `Trojan.GenericKD.81657968` | Bitdefender | **stage baixado** (o "recurso de internet") | `INetCache\IE\WGGTPK4W\init[1].htm` | quarentenado |
| `CMD:Heur.BZC.PZQ.Boxter.*` | Bitdefender | persistência (APT + multi-vetor) | `Claude Attack\tools\redteam\persistence\*.ps1` | kit removido |
| `Generic.XML.ShellRunner.B` | Bitdefender | shell runner em documento | `pagWay\PagWay\markdown\ATTACK_SCRIPTS.md` | quarentenado |
| `Backdoor:PHP/Perhetshell.A!dha` | Defender | web shell PHP | `01_PagWay\PagWay\markdown\UPLOAD.md` | marcado (texto) |
| `JS:Trojan.Cryxos.5130` | Bitdefender | trojan JS | `atomic-red-team\atomics\T1027.006\bin\*.html` | repo removido |
| `Behavior:Win32/WebBrowserCredAccess.E2` | Defender | roubo de credencial de navegador — **executou** | runtime | sem arquivo (comportamental) |
| `VirTool:Win32/UACBypassExp.gen!B` | Defender | bypass de UAC | runtime | sem arquivo |
| `Trojan:PowerShell/Fleisnam.E` | Defender | bypass de AMSI | `Claude Attack\tools\redteam\evasion\amsi_bypass.ps1` | kit removido |
| `Malgent!AMTB`, `BAT/Malgent`, `PowerShell/Agent`, `PowerShell/MalScript`, `VBS/DomDocBase64`, `XML/Exeselrun`, `Ransom:Win32/CVE`, `ShellCodeRunner` | Defender | famílias genéricas no arsenal | `arsenal\**` | repos removidos |

## B — Infecção secundária (arquivo legítimo reescrito pelo Expiro)

| detecção | o que era | ação |
|---|---|---|
| `Generic.Dacic.22261.6D8DD772` | **mesmo hash** em todo shim `.bin\*.exe` de `HTC\app` e `HTC\app\web` | `node_modules` apagado |
| `Generic.Dacic.22824.*` | Discord, Roblox, Mullvad, `rg.exe` (VS Code), SoftEther `se-server/se-client`, `python.exe`, `Strawberry\c\bin\ar.exe`/`addr2line.exe`, `7zSetup.exe` | quarentenado; apps reinstalados |

Não são malware de origem: são **vítimas** do infector. Mesmo tratamento (não confiar no binário),
mas a classificação correta importa para não acusar o app errado.

## C — Dual-use (não é vírus)

| item | detecção | decisão |
|---|---|---|
| `Mimikatz` | `HackTool:Win64/Mimikatz!MTB` | removido junto com o kit |
| `chisel.exe` | `Trojan.GenericKD.81537365` | removido (`Workbench\tools\chisel`) |
| `Powersploit`, `AdFind`, `Badcastle` | HackTool* | removidos com o arsenal |
| `gsocket` / `gs-netcat.exe` | sem detecção; **estava excluído do AV** | exclusão de processo removida |
| `SoftEther` | `Generic.Dacic` na **cópia** de `tools` | cópia removida; instalação oficial em `Program Files` mantida |
| `netexec`/`impacket`, `7zr.exe` | sem detecção | removidos por serem binário de origem incerta |

## D — Payload de teste de repositório público (59 das 69 do Desktop)

`atomic-red-team`, `LOLBAS`, `GTFOBins`, `PayloadsAllTheThings`. Conteúdo ofensivo, público e
re-clonável — **não é infecção**. Removidos mesmo assim: payload vivo em disco é risco que não
paga o benefício (re-clone em 1 minuto).

## E — FP de conteúdo (documentação)

| arquivo | por que é FP |
|---|---|
| `LOLBAS\yml\OSBinaries\Pcalua.yml` | definição YAML de técnica, sem código executável |
| `atomic-red-team\atomics\T1003.002\*.md/.yaml` | documentação de teste do Mimikatz (`Trojan.Agent.GARB`) |
| `T1027.006\bin\T1027_006_Remote.html` | HTML de teste (Cryxos), sem payload ativo |

## F — Obsoleto

57 dos 61 caminhos marcados como "ativos" pelo Defender não existem mais no disco. Os 4 restantes
são a instalação nova do Discord + 2 atalhos: `no threats`, assinatura `Valid`.

## Rebaixamentos e correções feitas neste incidente

| item | classificação anterior | classificação correta |
|---|---|---|
| `pcalua.exe` | falso positivo | **TTP real** — LOLBin para launch remoto; binário assinado, sem arquivo para quarentenar |
| `Pcalua.yml` | confundido com o binário | FP de conteúdo; são coisas diferentes |
| `%TEMP%\.bun-*.dll` | suspeito | **benigno** — `opentui.dll` extraído pelo próprio `cline` |
| `gsocket` | dropado pelo vírus | **ferramenta do próprio operador** (segredo queimado do mesmo jeito) |
| `atomic-red-team` | suspeito | payload de teste público (removido por política, não por infecção) |
| `Discord.exe` (235 MB) | "infectado" | **vítima** do infector → app reinstalado, assinatura válida |

