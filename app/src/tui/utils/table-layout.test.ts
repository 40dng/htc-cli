import { describe, expect, it } from "vitest";
import { displayWidth } from "./display-width";
import { JUNCAO_SEPARADOR, LARGURA_MINIMA, montar_tabela, SEPARADOR_COLUNA } from "./table-layout";

const CABECALHO = ["item", "resultado"];
const LINHAS = [
	["testes novos", "25 (recusa 9, checkpoint 5)"],
	["suíte `runtime + utils`", "**359 pass / 31 fail**"],
	["typecheck", "limpo"],
];

function colunas(linha: string): number[] {
	// posicao inicial de cada coluna, medida em colunas de terminal
	const partes = linha.split(SEPARADOR_COLUNA);
	const inicios: number[] = [];
	let cursor = 0;
	for (const parte of partes) {
		inicios.push(displayWidth(linha.slice(0, cursor)));
		cursor += parte.length + SEPARADOR_COLUNA.length;
	}
	return inicios;
}

describe("montar_tabela", () => {
	it("alinha todas as linhas na mesma coluna", () => {
		const tabela = montar_tabela(CABECALHO, LINHAS, 80);
		const referencia = colunas(tabela.cabecalho);
		for (const linha of tabela.linhas) {
			expect(colunas(linha)).toEqual(referencia);
		}
	});

	it("nao deixa a tabela passar da largura disponivel", () => {
		const largas = [
			["coluna-que-nao-acaba-mais-e-vai-embora", "x".repeat(120)],
		];
		const tabela = montar_tabela(["a", "b"], largas, 60);
		expect(tabela.larguraTotal).toBeLessThanOrEqual(60);
		for (const linha of tabela.linhas) {
			expect(displayWidth(linha)).toBeLessThanOrEqual(60);
		}
	});

	it("quebra a celula longa em varias linhas em vez de cortar", () => {
		const tabela = montar_tabela(
			["bug", "sintoma", "correcao"],
			[
				[
					"run-agent",
					"o turno termina por submit e o send nao devolve result, entao o one-shot sai com erro",
					"usa o ultimo content_end/text como run_result",
				],
			],
			40,
		);
		expect(tabela.linhas.length).toBeGreaterThan(1);
		for (const linha of tabela.linhas) {
			expect(displayWidth(linha)).toBeLessThanOrEqual(40);
		}
	});

	it("mantem a grade do separador no tamanho das colunas", () => {
		const tabela = montar_tabela(CABECALHO, LINHAS, 80);
		expect(tabela.separador).toContain(JUNCAO_SEPARADOR);
		expect(displayWidth(tabela.separador)).toBe(tabela.larguraTotal);
	});

	it("respeita a largura minima por coluna", () => {
		const tabela = montar_tabela(["a", "b"], [["", ""]], 4);
		for (const largura of tabela.larguras) {
			expect(largura).toBeGreaterThanOrEqual(LARGURA_MINIMA);
		}
	});

	it("normaliza quebra de linha e espaco duplo na celula", () => {
		const tabela = montar_tabela(CABECALHO, [["a\nb", "c   d"]], 80);
		expect(tabela.linhas[0]).toContain("a b");
		expect(tabela.linhas[0]).toContain("c d");
	});
});
