// language: TypeScript, file: src/bridge/anthropic_sse.ts, runtime: Bun/Node
// Converte uma resposta Anthropic COMPLETA (nao-streaming) na sequencia SSE que
// o Claude Code espera. Fazemos a resposta completa de proposito: e o que
// permite detectar recusa e reenviar ANTES de emitir qualquer byte ao cliente.

import type { ServerResponse } from "node:http";

export interface BlocoTexto {
	type: "text";
	text: string;
}
export interface BlocoToolUse {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
}
export type BlocoConteudo = BlocoTexto | BlocoToolUse | { type: string; [k: string]: unknown };

export interface RespostaAnthropic {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	content: BlocoConteudo[];
	stop_reason: string | null;
	stop_sequence?: string | null;
	usage?: { input_tokens?: number; output_tokens?: number };
}

/** Resposta completa + o raciocinio cru (para a correcao interna). */
export interface ResultadoUpstream {
	resposta: RespostaAnthropic;
	raciocinio: string;
}

function escrever_evento(res: ServerResponse, evento: string, dados: unknown): void {
	res.write(`event: ${evento}\n`);
	res.write(`data: ${JSON.stringify(dados)}\n\n`);
}

/** Serializa a mensagem completa como a sequencia SSE canonica da Anthropic. */
export function escrever_mensagem_sse(
	res: ServerResponse,
	mensagem: RespostaAnthropic,
): void {
	const usageEntrada = mensagem.usage?.input_tokens ?? 0;

	escrever_evento(res, "message_start", {
		type: "message_start",
		message: {
			id: mensagem.id,
			type: "message",
			role: "assistant",
			model: mensagem.model,
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: usageEntrada, output_tokens: 0 },
		},
	});

	mensagem.content.forEach((bloco, indice) => {
		if (bloco.type === "text") {
			escrever_evento(res, "content_block_start", {
				type: "content_block_start",
				index: indice,
				content_block: { type: "text", text: "" },
			});
			const texto = (bloco as BlocoTexto).text ?? "";
			if (texto) {
				escrever_evento(res, "content_block_delta", {
					type: "content_block_delta",
					index: indice,
					delta: { type: "text_delta", text: texto },
				});
			}
			escrever_evento(res, "content_block_stop", {
				type: "content_block_stop",
				index: indice,
			});
			return;
		}

		if (bloco.type === "tool_use") {
			const tool = bloco as BlocoToolUse;
			escrever_evento(res, "content_block_start", {
				type: "content_block_start",
				index: indice,
				content_block: {
					type: "tool_use",
					id: tool.id,
					name: tool.name,
					input: {},
				},
			});
			escrever_evento(res, "content_block_delta", {
				type: "content_block_delta",
				index: indice,
				delta: {
					type: "input_json_delta",
					partial_json: JSON.stringify(tool.input ?? {}),
				},
			});
			escrever_evento(res, "content_block_stop", {
				type: "content_block_stop",
				index: indice,
			});
			return;
		}

		// Thinking/reasoning: o cliente renderiza isto como "▶ Thinking: ..." no meio da
		// conversa. Fica DESLIGADO por padrao - o rascunho do modelo nao pertence ao
		// transcript. Ligar com HTC_MOSTRAR_PENSAMENTO=1 quando o traco for util.
		if (bloco.type === "thinking") {
			if (process.env.HTC_MOSTRAR_PENSAMENTO !== "1") return;
			escrever_evento(res, "content_block_start", {
				type: "content_block_start",
				index: indice,
				content_block: { type: "thinking", thinking: "" },
			});
			const pensamento = (bloco as { thinking?: string }).thinking ?? "";
			if (pensamento) {
				escrever_evento(res, "content_block_delta", {
					type: "content_block_delta",
					index: indice,
					delta: { type: "thinking_delta", thinking: pensamento },
				});
			}
			escrever_evento(res, "content_block_stop", {
				type: "content_block_stop",
				index: indice,
			});
			return;
		}

		// Bloco desconhecido (ex.: redacted_thinking): repassa cru.
		escrever_evento(res, "content_block_start", {
			type: "content_block_start",
			index: indice,
			content_block: bloco,
		});
		escrever_evento(res, "content_block_stop", {
			type: "content_block_stop",
			index: indice,
		});
	});

	escrever_evento(res, "message_delta", {
		type: "message_delta",
		delta: {
			stop_reason: mensagem.stop_reason ?? "end_turn",
			stop_sequence: mensagem.stop_sequence ?? null,
		},
		usage: { output_tokens: mensagem.usage?.output_tokens ?? 0 },
	});
	escrever_evento(res, "message_stop", { type: "message_stop" });
}
