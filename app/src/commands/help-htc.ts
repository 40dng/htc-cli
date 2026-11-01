/**
 * HTC — ajuda propria
 *
 * `htc --help` mostra o que o produto faz, nao a ajuda generica do runtime.
 * A lista vem do proprio Commander (nunca fica desatualizada).
 */
import type { Command } from "commander";

const COR = "\u001b[38;2;203;27;69m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const BANNER = [
	"  ██╗  ██╗████████╗ ██████╗ ",
	"  ██║  ██║╚══██╔══╝██╔════╝ ",
	"  ███████║   ██║   ██║      ",
	"  ██╔══██║   ██║   ██║      ",
	"  ██║  ██║   ██║   ╚██████╗ ",
	"  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ",
];

const EXEMPLOS: Array<[string, string]> = [
	["htc", "abre a TUI"],
	['htc "missao"', "one-shot autonomo"],
	["htc correlacao --host bore.pub", "o que ja foi medido naquele host"],
	["htc run \"missao\" -P opencode -m deepseek-v4.1-flash", "modelo free, sem chave"],
	["htc history", "sessoes desta pasta"],
	["htc history --all-history", "sessoes de todas as pastas"],
	["htc upgrade --check", "verifica atualizacao"],
	["htc uninstall --dry-run", "mostra o que seria removido"],
];

export function printHtcHelp(program: Command, versao: string): void {
	const linhas: string[] = [];
	linhas.push("");
	for (const linha of BANNER) linhas.push(`${COR}${linha}${RESET}`);
	linhas.push("");
	linhas.push(`  ${DIM}Hatachi${RESET} · v${versao}`);
	linhas.push("");
	linhas.push(`  ${COR}USO${RESET}  htc [comando] [opcoes] [missao]`);
	linhas.push("");
	linhas.push(`  ${COR}COMANDOS${RESET}`);

	const comandos = program.commands
		.slice()
		.sort((a, b) => a.name().localeCompare(b.name()));
	for (const cmd of comandos) {
		if (cmd.name().startsWith("_")) continue;
		const nome = cmd.name().padEnd(12);
		linhas.push(`    ${nome} ${DIM}${cmd.description() ?? ""}${RESET}`);
	}

	linhas.push("");
	linhas.push(`  ${COR}EXEMPLOS${RESET}`);
	for (const [cmd, desc] of EXEMPLOS) {
		linhas.push(`    ${cmd}`);
		linhas.push(`    ${DIM}${desc}${RESET}`);
	}
	linhas.push("");
	linhas.push(`  ${DIM}htc <comando> --help  detalha um comando${RESET}`);
	linhas.push("");

	process.stdout.write(`${linhas.join("\n")}\n`);
}
