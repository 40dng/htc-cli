// language: TypeScript, file: src/tui/utils/display-width.ts, runtime: bun/node
// Largura de EXIBICAO de texto no terminal, em colunas — nao em unidades UTF-16.
//
// `String.length` mentia em toda tabela: acento conta 1 coluna mas 1 unidade,
// CJK e a maioria dos emoji contam 2 colunas com 1 ou 2 unidades, e combinante
// conta 0. Como a tabela do markdown e alinhada por espacos, qualquer erro de
// 1 coluna desmonta a grade — era o "bugando" das tabelas.

/** Marca de truncamento: cabe em 1 coluna. */
export const ELLIPSIS = "…";

function isZeroWidth(cp: number): boolean {
	return (
		(cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
		(cp >= 0xfe20 && cp <= 0xfe2f) ||
		cp === 0x200b ||
		cp === 0x200c ||
		cp === 0x200d ||
		(cp >= 0x200e && cp <= 0x200f) ||
		cp === 0xfeff
	);
}

function isWide(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
		(cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
		(cp >= 0x3041 && cp <= 0x33ff) || // Hiragana..CJK compatibility
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
		(cp >= 0xa000 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1f64f) || // emoji
		(cp >= 0x1f900 && cp <= 0x1f9ff) ||
		(cp >= 0x1f680 && cp <= 0x1f6ff) ||
		(cp >= 0x2600 && cp <= 0x26ff) || // misc symbols (emoji presentation)
		(cp >= 0x2700 && cp <= 0x27bf)
	);
}

/** Colunas ocupadas por `texto` quando impresso. */
export function displayWidth(texto: string): number {
	let largura = 0;
	for (const char of texto) {
		const cp = char.codePointAt(0) ?? 0;
		if (isZeroWidth(cp)) continue;
		largura += isWide(cp) ? 2 : 1;
	}
	return largura;
}

/** Corta em `max` colunas, marcando o corte com reticencias. */
export function truncateDisplay(texto: string, max: number): string {
	if (max <= 0) return "";
	if (displayWidth(texto) <= max) return texto;
	if (max <= 1) return ELLIPSIS;
	let saida = "";
	let usado = 0;
	for (const char of texto) {
		const cp = char.codePointAt(0) ?? 0;
		const custo = isZeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1;
		if (usado + custo > max - 1) break;
		saida += char;
		usado += custo;
	}
	return `${saida}${ELLIPSIS}`;
}

/** Corta em `max` colunas sem reticencias (para quebra dura de palavra longa). */
export function cortarDisplay(texto: string, max: number): string {
	if (max <= 0) return "";
	let saida = "";
	let usado = 0;
	for (const char of texto) {
		const cp = char.codePointAt(0) ?? 0;
		const custo = isZeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1;
		if (usado + custo > max) break;
		saida += char;
		usado += custo;
	}
	return saida;
}

/** Completa com espacos ate `width` colunas (sem cortar). */
export function padDisplay(texto: string, width: number): string {
	const falta = width - displayWidth(texto);
	return falta > 0 ? texto + " ".repeat(falta) : texto;
}
