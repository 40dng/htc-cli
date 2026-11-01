/**
 * HTC — buddy
 *
 * Companion compacto (como o do Claude Code) + a arte grande do peixe.
 * A arte grande vem do peixe enviado pelo operador; a compacta e a mesma
 * silhueta reduzida a mao para caber em 5 linhas.
 */
import { PEIXE } from "../assets/peixe";

export const BUDDY = [
	"    ▄▄▄▄▄▄▄▄",
	" ▄████████████▄",
	"███◉███████████◄",
	" ▀████████████▀",
	"    ▀▀▀▀▀▀▀▀",
];

const CORES = ["#FF5C7A", "#F04E6D", "#E04060", "#D03353", "#C02848", "#A81E3B"];

export function carregarPeixe(): string[] {
	return PEIXE.length > 0 ? PEIXE : BUDDY;
}

function hexParaAnsi(hex: string, texto: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\u001b[38;2;${r};${g};${b}m${texto}\u001b[0m`;
}

/** Pinta as linhas com o gradiente da marca (para terminal, fora da TUI). */
export function pintarGradiente(linhas: string[]): string {
	const total = linhas.length;
	return linhas
		.map((linha, i) => {
			const cor = CORES[Math.round((i / Math.max(1, total - 1)) * (CORES.length - 1))];
			return hexParaAnsi(cor ?? CORES[0]!, linha);
		})
		.join("\n");
}

export function corDaLinha(i: number, total: number): string {
	const idx = Math.round((i / Math.max(1, total - 1)) * (CORES.length - 1));
	return CORES[idx] ?? CORES[0]!;
}

export async function runBuddy(args: {
	grande?: boolean;
	linhas?: number;
}): Promise<number> {
	const linhas = args.grande ? carregarPeixe() : BUDDY;
	const corte =
		args.linhas && args.linhas > 0 ? linhas.slice(0, args.linhas) : linhas;
	process.stdout.write(`${pintarGradiente(corte)}\n`);
	return 0;
}
