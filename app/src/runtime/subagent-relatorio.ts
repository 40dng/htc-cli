// language: TypeScript, file: src/runtime/subagent-relatorio.ts, runtime: bun/node
/**
 * RELATORIO DE GALHO EM DISCO — o galho escreve, o pai le o delta.
 *
 * Problema medido: o relatorio do subagente volta dentro do contexto do pai, e o teto de
 * 12 linhas da politica e paliativo enquanto o corpo inteiro volta junto. No motor do
 * Claude Code (`src/utils/task/diskOutput.ts`) o retorno e arquivo: o filho grava, o pai
 * le a partir de um offset.
 *
 * Contrato daqui:
 *  - o filho escreve blocos; cada escrita devolve o novo tamanho
 *  - o pai guarda `offset` e le so o que veio depois
 *  - leitura nunca carrega o arquivo inteiro: ha teto por leitura e teto por arquivo
 *  - arquivo ausente nao e erro: devolve vazio e mantem o offset
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Teto de uma leitura. */
export const MAX_LEITURA_BYTES = 8 * 1024 * 1024;
/** Teto do arquivo: acima disso o galho esta despejando contexto, nao resumindo. */
export const MAX_RELATORIO_BYTES = 16 * 1024 * 1024;

export interface DeltaRelatorio {
	conteudo: string;
	novoOffset: number;
	total: number;
}

export function caminho_relatorio(base: string, sessao: string, id: string): string {
	const seguro = (s: string) =>
		s
			.replace(/[^A-Za-z0-9._-]/g, "_")
			.replace(/\.{2,}/g, ".")
			.replace(/^\.+/, "");
	return join(base, seguro(sessao), `${seguro(id)}.relatorio`);
}

/**
 * Anexa um bloco ao relatorio. Devolve o offset resultante, para o pai nao reler.
 * Bloco vazio nao escreve nada e devolve o tamanho atual.
 */
export function gravar_bloco(arquivo: string, texto: string): number {
	if (!texto) return tamanho_relatorio(arquivo);
	mkdirSync(dirname(arquivo), { recursive: true });
	const corpo = texto.endsWith("\n") ? texto : texto + "\n";
	appendFileSync(arquivo, corpo, "utf8");
	return tamanho_relatorio(arquivo);
}

export function tamanho_relatorio(arquivo: string): number {
	try {
		return statSync(arquivo).size;
	} catch {
		return 0;
	}
}

/**
 * Le de `de` ate o fim (limitado por MAX_LEITURA_BYTES) e devolve o novo offset.
 * `novoOffset` avanca pelo que foi lido, nao pelo tamanho do arquivo: se o teto cortou,
 * o pai recebe a sobra na proxima chamada em vez de perder o meio.
 */
export function ler_delta(
	arquivo: string,
	de: number,
	maxBytes: number = MAX_LEITURA_BYTES,
): DeltaRelatorio {
	if (!existsSync(arquivo)) return { conteudo: "", novoOffset: de, total: 0 };
	const total = tamanho_relatorio(arquivo);
	if (de >= total) return { conteudo: "", novoOffset: total, total };
	const buf = readFileSync(arquivo);
	const inicio = Math.max(0, de);
	const fim = Math.min(total, inicio + Math.max(1, maxBytes));
	const conteudo = buf.subarray(inicio, fim).toString("utf8");
	return { conteudo, novoOffset: fim, total };
}

/**
 * Ultimas `linhas` linhas, com aviso de quanto ficou de fora. E o que o pai coloca no
 * contexto quando precisa do estado atual sem pagar o arquivo inteiro.
 */
export function cauda_do_relatorio(arquivo: string, linhas = 12): string {
	if (!existsSync(arquivo)) return "";
	const total = tamanho_relatorio(arquivo);
	const bruto = readFileSync(arquivo, "utf8");
	const todas = bruto.split(/\r?\n/).filter((l) => l.length > 0);
	const corte = Math.max(0, todas.length - linhas);
	const corpo = todas.slice(corte).join("\n");
	if (corte === 0) return corpo;
	const omitido = Math.max(0, bruto.length - corpo.length);
	const kb = Math.max(1, Math.round(omitido / 1024));
	return `[${kb}KB de relatorio anterior omitidos, ${total} bytes no total]\n${corpo}`;
}
