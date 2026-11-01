// language: TypeScript, file: src/session/resume-sanidade.ts, runtime: Bun/Node
/**
 * SANIDADE DE RESUME — mensagem do assistente com `tool_use` sem `tool_result` derruba a
 * sessao retomada: a API recusa o turno inteiro porque a conversa tem chamada pendurada.
 *
 * No motor do Claude Code isso vive em `filterIncompleteToolCalls` (AgentTool/runAgent.ts).
 * Aqui a funcao e pura e devolve tambem o que foi cortado, para o resume registrar o motivo
 * em vez de sumir com mensagem em silencio.
 */

import type { BlocoConteudo } from "../bridge/anthropic_sse";

export interface Mensagem {
	role: string;
	content: BlocoConteudo[] | string;
}

export interface ResultadoSanidade<T extends Mensagem> {
	mensagens: T[];
	cortadas: string[];
	orfas: string[];
}

const blocos = (m: Mensagem): BlocoConteudo[] =>
	Array.isArray(m.content) ? m.content : [];

function idsDeToolUse(m: Mensagem): string[] {
	return blocos(m)
		.filter((b) => (b as { type?: string }).type === "tool_use")
		.map((b) => (b as { id?: string }).id ?? "")
		.filter(Boolean);
}

function idsResolvidos(mensagens: readonly Mensagem[]): Set<string> {
	const s = new Set<string>();
	for (const m of mensagens) {
		for (const b of blocos(m)) {
			if ((b as { type?: string }).type !== "tool_result") continue;
			const id = (b as { tool_use_id?: string }).tool_use_id;
			if (id) s.add(id);
		}
	}
	return s;
}

/**
 * Remove mensagens do assistente com `tool_use` sem resultado correspondente.
 *
 * - uma `tool_use` orfa condena a mensagem inteira (mesma escolha do motor de referencia:
 *   remover so o bloco deixaria raciocinio sem a acao que ele descreve)
 * - `tool_result` sem `tool_use` nao e problema de resume e fica como esta
 * - ordem e conteudo das mensagens mantidas nao mudam
 */
export function filtrar_tool_use_orfao<T extends Mensagem>(
	mensagens: readonly T[],
): ResultadoSanidade<T> {
	const resolvidos = idsResolvidos(mensagens);
	const mantidas: T[] = [];
	const cortadas: string[] = [];
	const orfas: string[] = [];

	mensagens.forEach((m, indice) => {
		if (m.role !== "assistant") {
			mantidas.push(m);
			return;
		}
		const pendentes = idsDeToolUse(m).filter((id) => !resolvidos.has(id));
		if (pendentes.length === 0) {
			mantidas.push(m);
			return;
		}
		cortadas.push(`#${indice} (${pendentes.join(",")})`);
		orfas.push(...pendentes);
	});

	return { mensagens: mantidas, cortadas, orfas };
}
