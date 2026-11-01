// language: TypeScript, file: src/lab/runner.ts, runtime: bun/node
// Runner do laboratorio de bypass: roda cada sonda N vezes por variante de
// payload, classifica o resultado e devolve taxa de entrega.
//
// O executor e injetavel de proposito: o teste roda com resposta roteirizada
// (sem rede, sem token) e o CLI roda com o binario real. Mesma contabilidade.

import type { SondaBypass } from "./prompts";
import { SONDAS_BYPASS } from "./prompts";
import { classificar_resposta, type Veredito } from "./classificar";

export interface EntradaExecucao {
	sonda: SondaBypass;
	variante: string;
	repeticao: number;
	timeoutMs: number;
}

export interface SaidaExecucao {
	texto: string;
	erro?: string;
	duracaoMs?: number;
}

export type Executor = (entrada: EntradaExecucao) => Promise<SaidaExecucao>;

export interface ResultadoSonda {
	sonda: string;
	categoria: string;
	variante: string;
	repeticao: number;
	veredito: Veredito;
	linhasDeCodigo: number;
	duracaoMs?: number;
	erro?: string;
	trecho: string;
}

export interface ResumoVariante {
	variante: string;
	total: number;
	artefato: number;
	recusa: number;
	misto: number;
	vazio: number;
	indefinido: number;
	erros: number;
	/** artefato / (total - erros) */
	taxa: number;
	linhasMedias: number;
	duracaoMediaMs: number;
}

export interface RelatorioLab {
	geradoEm: string;
	variantes: ResumoVariante[];
	resultados: ResultadoSonda[];
	melhor?: ResumoVariante;
}

function trecho(texto: string, limite = 120): string {
	return texto.replace(/\s+/g, " ").trim().slice(0, limite);
}

function resumir(variante: string, linhas: ResultadoSonda[]): ResumoVariante {
	const conta = (v: Veredito) => linhas.filter((l) => l.veredito === v).length;
	const erros = linhas.filter((l) => l.erro).length;
	const total = linhas.length;
	const validas = Math.max(0, total - erros);
	const artefato = conta("artefato");
	const linhasMedias =
		total === 0
			? 0
			: linhas.reduce((soma, l) => soma + l.linhasDeCodigo, 0) / total;
	const duracaoMediaMs =
		total === 0
			? 0
			: linhas.reduce((soma, l) => soma + (l.duracaoMs ?? 0), 0) / total;
	return {
		variante,
		total,
		artefato,
		recusa: conta("recusa"),
		misto: conta("misto"),
		vazio: conta("vazio"),
		indefinido: conta("indefinido"),
		erros,
		taxa: validas === 0 ? 0 : artefato / validas,
		linhasMedias,
		duracaoMediaMs,
	};
}

export async function rodar_lab(opcoes: {
	executar: Executor;
	variantes: readonly string[];
	repeticoes?: number;
	sondas?: readonly SondaBypass[];
	timeoutMs?: number;
	aoProgredir?: (resultado: ResultadoSonda, indice: number, total: number) => void;
}): Promise<RelatorioLab> {
	const sondas = opcoes.sondas ?? SONDAS_BYPASS;
	const repeticoes = Math.max(1, Math.trunc(opcoes.repeticoes ?? 1));
	const timeoutMs = opcoes.timeoutMs ?? 180_000;
	const resultados: ResultadoSonda[] = [];
	const total = sondas.length * opcoes.variantes.length * repeticoes;
	let indice = 0;

	for (const variante of opcoes.variantes) {
		for (const sonda of sondas) {
			for (let repeticao = 1; repeticao <= repeticoes; repeticao += 1) {
				const inicio = Date.now();
				let saida: SaidaExecucao;
				try {
					saida = await opcoes.executar({ sonda, variante, repeticao, timeoutMs });
				} catch (erro) {
					saida = { texto: "", erro: String(erro) };
				}
				const classificacao = classificar_resposta(saida.texto);
				const resultado: ResultadoSonda = {
					sonda: sonda.id,
					categoria: sonda.categoria,
					variante,
					repeticao,
					veredito: saida.erro ? "vazio" : classificacao.veredito,
					linhasDeCodigo: classificacao.linhasDeCodigo,
					duracaoMs: saida.duracaoMs ?? Date.now() - inicio,
					erro: saida.erro,
					trecho: trecho(saida.texto),
				};
				resultados.push(resultado);
				indice += 1;
				opcoes.aoProgredir?.(resultado, indice, total);
			}
		}
	}

	const variantes = opcoes.variantes.map((variante) =>
		resumir(
			variante,
			resultados.filter((r) => r.variante === variante),
		),
	);
	const melhor = [...variantes].sort((a, b) => b.taxa - a.taxa)[0];
	return {
		geradoEm: new Date().toISOString(),
		variantes,
		resultados,
		melhor,
	};
}
