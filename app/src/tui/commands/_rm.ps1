$p = "slash-command-registry.ts"
$all = [System.IO.File]::ReadAllLines((Resolve-Path $p))
$ini = ($all | Select-String -Pattern "^const HTC_SECURITY_COMMANDS" | Select-Object -First 1).LineNumber - 1
$fim = -1
for ($i = $ini; $i -lt $all.Count; $i++) { if ($all[$i] -match "^\];") { $fim = $i; break } }
if ($ini -lt 0 -or $fim -lt 0) { Write-Output "NAO ACHOU"; exit 1 }
$novo = @()
$novo += $all[0..($ini-1)]
$novo += "const HTC_SECURITY_COMMANDS: SlashCommandRegistryEntry[] = [];"
$novo += $all[($fim+1)..($all.Count-1)]
$txt = ($novo -join "`n")
[System.IO.File]::WriteAllText((Resolve-Path $p), $txt, (New-Object System.Text.UTF8Encoding($false)))
"removidas $($fim-$ini+1) linhas"
