// language: TypeScript, file: src/tui/utils/entry-budget.ts, target: Bun / Windows
// Teto de memoria do transcript. O corte por numero de entradas nao limita o
// tamanho: 500 entradas com blocos grandes (assistant_text/reasoning longos,
// outputs capados mas somados) chegam a centenas de MB e a sessao fica lenta ate
// a IDE recarregar (#13306). Aqui as entradas mais antigas sao descartadas ate o
// total de texto caber em `MAX_BUFFERED_BYTES`, mantendo sempre a ultima.

import type { ChatEntry } from "../types";
import { MAX_BUFFERED_BYTES, MAX_BUFFERED_LINES } from "../types";

/** Bytes de texto de uma entrada; so os tipos que carregam blocos grandes. */
export function entrada_tamanho_bytes(entry: ChatEntry): number {
	switch (entry.kind) {
		case "assistant_text":
		case "reasoning":
		case "error":
		case "status":
		case "team":
		case "user_submitted":
		case "user":
			return Buffer.byteLength(entry.text, "utf8");
		case "tool_call": {
			const saida =
				typeof entry.result?.rawOutput === "string"
					? entry.result.rawOutput
					: "";
			return (
				Buffer.byteLength(entry.inputSummary, "utf8") +
				Buffer.byteLength(saida, "utf8")
			);
		}
		default:
			return 0;
	}
}

/**
 * Aplica os dois tetos do transcript: numero de entradas e orcamento de bytes.
 * O de bytes descarta as entradas mais antigas ate o total caber, mantendo
 * sempre ao menos a ultima (mesmo se sozinha passar do teto).
 */
export function cortar_entradas(entries: ChatEntry[]): ChatEntry[] {
	let inicio = Math.max(0, entries.length - MAX_BUFFERED_LINES);
	let total = 0;
	for (let i = entries.length - 1; i >= inicio; i -= 1) {
		total += entrada_tamanho_bytes(entries[i] as ChatEntry);
		if (total > MAX_BUFFERED_BYTES) {
			inicio = i + 1;
			break;
		}
	}
	if (inicio >= entries.length) {
		inicio = Math.max(0, entries.length - 1);
	}
	return inicio === 0 ? entries : entries.slice(inicio);
}
