/**
 * HTC — graficos de terminal
 *
 * Braille (2x4 pontos por celula) para series: linha continua com 8x a
 * resolucao de um bloco, sem depender de fonte especial. E barra com oitavos
 * (▏▎▍▌▋▊▉█) para progresso com precisao sub-celula.
 */

const PESO_BRAILLE = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
] as const;

/**
 * Serie -> linhas de braille (topo primeiro). `min`/`max` fixos evitam o
 * "grafico que respira" quando o valor oscila pouco (cpu 2% x 3%).
 */
export function graficoBraille(
	valores: number[],
	largura: number,
	altura: number,
	opcoes: { min?: number; max?: number } = {},
): string[] {
	const col = Math.max(1, Math.floor(largura));
	const lin = Math.max(1, Math.floor(altura));
	if (valores.length === 0) return Array.from({ length: lin }, () => " ".repeat(col));

	const pontosX = col * 2;
	const pontosY = lin * 4;
	const janela = valores.length > pontosX ? valores.slice(-pontosX) : valores;
	if (janela.length === 0) return Array.from({ length: lin }, () => " ".repeat(col));

	// Estica a serie para a LARGURA INTEIRA (interpolacao linear). Sem isso a
	// serie curta desenha so na direita e o grafico parece truncado.
	const serie: number[] = [];
	if (janela.length === 1) {
		serie.push(...Array.from({ length: pontosX }, () => janela[0]!));
	} else {
		for (let x = 0; x < pontosX; x++) {
			const pos = (x * (janela.length - 1)) / (pontosX - 1);
			const i = Math.floor(pos);
			const f = pos - i;
			const a = janela[i]!;
			const b = janela[Math.min(janela.length - 1, i + 1)]!;
			serie.push(a + (b - a) * f);
		}
	}

	const min = opcoes.min ?? Math.min(...serie);
	const max = opcoes.max ?? Math.max(...serie, min + 1);
	const faixa = Math.max(max - min, 1e-9);

	const yDe = (v: number) => {
		const normal = (Math.min(max, Math.max(min, v)) - min) / faixa;
		return Math.min(pontosY - 1, Math.max(0, Math.round((1 - normal) * (pontosY - 1))));
	};

	const bits = Array.from({ length: lin }, () => new Uint8Array(col));
	const marca = (x: number, y: number) => {
		if (x < 0 || x >= pontosX || y < 0 || y >= pontosY) return;
		const cx = Math.floor(x / 2);
		const cy = Math.floor(y / 4);
		bits[cy]![cx]! |= PESO_BRAILLE[y % 4]![x % 2]!;
	};

	let anterior = yDe(serie[0] ?? min);
	for (let i = 0; i < serie.length; i++) {
		const y = yDe(serie[i]!);
		const x = i;
		const passo = y > anterior ? 1 : -1;
		if (y !== anterior) {
			for (let yy = anterior; ; yy += passo) {
				marca(x, yy);
				if (yy === y) break;
			}
		} else {
			marca(x, y);
		}
		anterior = y;
	}

	return bits.map((linha) => Array.from(linha, (b) => (b ? String.fromCharCode(0x2800 + b) : " ")).join(""));
}

const OITAVOS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];

/** Barra 0..1 com oitavos de celula; `trilho` desenha o fundo. */
export function barraOitavos(fracao: number, largura: number, trilho = true): string {
	const f = Math.min(1, Math.max(0, Number.isFinite(fracao) ? fracao : 0));
	const cheios = f * largura;
	const inteiros = Math.floor(cheios);
	const resto = Math.round((cheios - inteiros) * 8) % 9;
	const corpo = "█".repeat(inteiros) + OITAVOS[resto]!;
	const usado = inteiros + (resto > 0 ? 1 : 0);
	const vazio = Math.max(0, largura - usado);
	return trilho ? `${corpo}${"░".repeat(vazio)}` : corpo;
}

/** Escala 0..100 para percentuais (nao deixa o grafico achatar). */
export const ESCALA_PCT = { min: 0, max: 100 } as const;
