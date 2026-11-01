// language: TypeScript, file: src/tui/utils/table-layout.ts, runtime: bun/node
// Layout de tabela markdown como TEXTO alinhado por colunas de terminal.
//
// O renderer antigo media as celulas com `String.length` e usava o texto cru do
// markdown (com `**` e crases dentro), entao: coluna desalinhada em qualquer
// acento/CJK/emoji, negrito aparecendo como asterisco e tabela estourando a
// largura do terminal (o wrap quebrava a grade no meio da linha). Aqui a
// largura e sempre em colunas de exibicao e a tabela nunca passa do limite.

import { cortarDisplay, displayWidth, padDisplay } from "./display-width";

export const SEPARADOR_COLUNA = " │ ";
export const JUNCAO_SEPARADOR = "─┼─";
export const LARGURA_MINIMA = 3;

export interface TabelaMontada {
	larguras: number[];
	cabecalho: string;
	separador: string;
	linhas: string[];
	larguraTotal: number;
}

function normalizar_celula(valor: string | undefined): string {
	return (valor ?? "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function largura_da_linha(larguras: readonly number[]): number {
	const colunas = larguras.reduce((total, largura) => total + largura, 0);
	const separadores = SEPARADOR_COLUNA.length * Math.max(0, larguras.length - 1);
	return colunas + separadores;
}

/**
 * Distribui a largura disponivel entre as colunas. Comeca pela largura natural
 * (maior celula de cada coluna) e tira 1 coluna de cada vez da coluna MAIS
 * larga enquanto a tabela nao couber — assim uma coluna com texto enorme cede
 * espaco primeiro, em vez de espremer todas por igual.
 */
export function calcular_larguras(
	cabecalho: readonly string[],
	linhas: readonly (readonly string[])[],
	largura_maxima: number,
): number[] {
	const colunas = cabecalho.length;
	if (colunas === 0) return [];
	const larguras = cabecalho.map((celula, indice) => {
		const larguras_celulas = linhas.map((linha) => displayWidth(linha[indice] ?? ""));
		return Math.max(displayWidth(celula), ...larguras_celulas, LARGURA_MINIMA);
	});
	const minimo = LARGURA_MINIMA;
	const alvo = Math.max(colunas * minimo, Math.floor(largura_maxima));
	let guarda = 0;
	while (largura_da_linha(larguras) > alvo && guarda < 10_000) {
		let mais_larga = -1;
		for (let i = 0; i < larguras.length; i += 1) {
			if (larguras[i] <= minimo) continue;
			if (mais_larga < 0 || larguras[i] > larguras[mais_larga]) mais_larga = i;
		}
		if (mais_larga < 0) break;
		larguras[mais_larga] -= 1;
		guarda += 1;
	}
	return larguras;
}

/**
 * Quebra o texto em linhas de ate `largura` colunas. Palavra que nao cabe sozinha
 * e cortada duro — nada e descartado. Era isso que faltava: truncar a celula
 * escondia informacao e o corte da linha pelo terminal desalinhava a grade.
 */
export function quebrarDisplay(texto: string, largura: number): string[] {
	if (largura <= 0) return [""];
	const palavras = texto.split(/\s+/).filter(Boolean);
	if (palavras.length === 0) return [""];
	const linhas: string[] = [];
	let atual = "";
	for (const palavra of palavras) {
		const tentativa = atual ? `${atual} ${palavra}` : palavra;
		if (displayWidth(tentativa) <= largura) {
			atual = tentativa;
			continue;
		}
		if (atual) {
			linhas.push(atual);
			atual = "";
		}
		let resto = palavra;
		while (displayWidth(resto) > largura) {
			const parte = cortarDisplay(resto, largura);
			if (!parte) break;
			linhas.push(parte);
			resto = resto.slice(parte.length);
		}
		atual = resto;
	}
	if (atual) linhas.push(atual);
	return linhas.length > 0 ? linhas : [""];
}

export function montar_tabela(
	cabecalho: readonly string[],
	linhas: readonly (readonly string[])[],
	largura_maxima: number,
): TabelaMontada {
	const normalizado = linhas.map((linha) => linha.map(normalizar_celula));
	const header = cabecalho.map(normalizar_celula);
	const larguras = calcular_larguras(header, normalizado, largura_maxima);

	const montar = (celulas: readonly string[]): string[] => {
		const quebradas = larguras.map((largura, indice) =>
			quebrarDisplay(celulas[indice] ?? "", largura),
		);
		const altura = Math.max(1, ...quebradas.map((linhasDaCelula) => linhasDaCelula.length));
		const fisicas: string[] = [];
		for (let linha = 0; linha < altura; linha += 1) {
			fisicas.push(
				larguras
					.map((largura, indice) => padDisplay(quebradas[indice][linha] ?? "", largura))
					.join(SEPARADOR_COLUNA),
			);
		}
		return fisicas;
	};

	const corpo = normalizado.flatMap((linha) => montar(linha));
	return {
		larguras,
		cabecalho: montar(header).join("\n"),
		separador: larguras.map((largura) => "─".repeat(largura)).join(JUNCAO_SEPARADOR),
		linhas: corpo,
		larguraTotal: largura_da_linha(larguras),
	};
}
