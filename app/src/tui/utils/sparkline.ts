const BLOCOS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** Serie -> barra de blocos. `largura` corta pelos valores mais recentes. */
export function sparkline(valores: number[], largura: number): string {
	if (largura <= 0) return "";
	const serie = valores.slice(-largura);
	if (serie.length === 0) return " ".repeat(largura);
	const max = Math.max(...serie, 1);
	const min = Math.min(...serie, 0);
	const faixa = Math.max(max - min, 1);
	const barras = serie.map((v) => {
		const indice = Math.round(((v - min) / faixa) * (BLOCOS.length - 1));
		return BLOCOS[Math.min(BLOCOS.length - 1, Math.max(0, indice))];
	});
	const falta = largura - barras.length;
	return `${" ".repeat(Math.max(0, falta))}${barras.join("")}`;
}

/** Barra de progresso simples (0..1). */
export function barra(fracao: number, largura: number): string {
	const f = Math.min(1, Math.max(0, fracao));
	const cheios = Math.round(f * largura);
	return `${"█".repeat(cheios)}${"░".repeat(Math.max(0, largura - cheios))}`;
}
