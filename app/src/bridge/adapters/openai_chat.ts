// language: TypeScript, file: src/bridge/adapters/openai_chat.ts, runtime: Bun/Node
// Traduz Anthropic Messages <-> OpenAI Chat Completions para providers cujo
// upstream fala OpenAI (opencode-go, opencode/zen, deepseek, nvidia). Cobre
// texto, imagens, tool_use/tool_result e tool_choice. Resposta completa
// (stream:false) para permitir correcao antes de emitir ao Claude Code.

import type { BlocoConteudo, ResultadoUpstream, RespostaAnthropic } from "../anthropic_sse";
import { injetar_system } from "../injection";
import {
	endpoint_do_provider,
	type ProviderResolvido,
} from "../provider_resolver";
import { criar_sinal_com_timeout, TIMEOUT_RESPOSTA_UPSTREAM_MS } from "../timeouts";

interface BlocoAnthropic {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
	source?: { type?: string; media_type?: string; data?: string; url?: string };
}

interface MensagemAnthropic {
	role: "user" | "assistant";
	content: string | BlocoAnthropic[];
}

interface FerramentaAnthropic {
	name: string;
	description?: string;
	input_schema?: unknown;
}

interface MensagemOpenAI {
	role: "system" | "user" | "assistant" | "tool";
	content: unknown;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

interface RequisicaoOpenAI {
	model?: string;
	max_tokens?: number;
	messages: MensagemOpenAI[];
	tools?: Array<{
		type: "function";
		function: { name: string; description?: string; parameters?: unknown };
	}>;
	tool_choice?: unknown;
	temperature?: number;
	top_p?: number;
	stop?: string[];
	stream: false;
}

export interface RequisicaoAnthropic {
	model?: string;
	max_tokens?: number;
	system?: unknown;
	messages?: MensagemAnthropic[];
	tools?: FerramentaAnthropic[];
	tool_choice?: { type?: string; name?: string };
	temperature?: number;
	top_p?: number;
	stop_sequences?: string[];
	[key: string]: unknown;
}

function texto_de_system(system: unknown): string | undefined {
	if (typeof system === "string") return system;
	if (Array.isArray(system)) {
		const partes = system
			.map((b) => (b && typeof b === "object" ? (b as BlocoAnthropic).text : undefined))
			.filter((t): t is string => typeof t === "string" && t.length > 0);
		return partes.length ? partes.join("\n\n") : undefined;
	}
	return undefined;
}

function texto_de_blocos(content: string | BlocoAnthropic[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n");
}

function converter_tool_choice(
	escolha: RequisicaoAnthropic["tool_choice"],
): unknown {
	if (!escolha) return undefined;
	if (escolha.type === "any") return "required";
	if (escolha.type === "auto") return "auto";
	if (escolha.type === "tool" && escolha.name) {
		return { type: "function", function: { name: escolha.name } };
	}
	return undefined;
}

/** Converte as mensagens Anthropic em mensagens OpenAI, expandindo tool_result. */
function converter_mensagens(mensagens: MensagemAnthropic[]): MensagemOpenAI[] {
	const saida: MensagemOpenAI[] = [];
	for (const mensagem of mensagens) {
		if (typeof mensagem.content === "string") {
			saida.push({ role: mensagem.role, content: mensagem.content });
			continue;
		}
		const blocos = mensagem.content ?? [];

		if (mensagem.role === "assistant") {
			const textos: string[] = [];
			const toolCalls: MensagemOpenAI["tool_calls"] = [];
			for (const bloco of blocos) {
				if (bloco.type === "text" && bloco.text) textos.push(bloco.text);
				if (bloco.type === "tool_use") {
					toolCalls.push({
						id: bloco.id ?? `call_${toolCalls.length}`,
						type: "function",
						function: {
							name: bloco.name ?? "",
							arguments: JSON.stringify(bloco.input ?? {}),
						},
					});
				}
			}
			const msg: MensagemOpenAI = {
				role: "assistant",
				content: textos.join("\n") || null,
			};
			if (toolCalls.length) msg.tool_calls = toolCalls;
			saida.push(msg);
			continue;
		}

		// role user: tool_result vira mensagem "tool"; o resto vira content.
		const partes: unknown[] = [];
		for (const bloco of blocos) {
			if (bloco.type === "tool_result") {
				saida.push({
					role: "tool",
					tool_call_id: bloco.tool_use_id ?? "",
					content:
						typeof bloco.content === "string"
							? bloco.content
							: JSON.stringify(bloco.content ?? ""),
				});
				continue;
			}
			if (bloco.type === "text" && bloco.text) {
				partes.push({ type: "text", text: bloco.text });
				continue;
			}
			if (bloco.type === "image" && bloco.source) {
				const fonte = bloco.source;
				const url =
					fonte.type === "base64" && fonte.data
						? `data:${fonte.media_type ?? "image/png"};base64,${fonte.data}`
						: fonte.url;
				if (url) partes.push({ type: "image_url", image_url: { url } });
			}
		}
		if (partes.length === 1 && (partes[0] as { type?: string }).type === "text") {
			saida.push({ role: "user", content: (partes[0] as { text: string }).text });
		} else if (partes.length > 0) {
			saida.push({ role: "user", content: partes });
		}
	}
	return saida;
}

export function montar_requisicao_openai(
	corpo: RequisicaoAnthropic,
	modelo: string | undefined,
): RequisicaoOpenAI {
	const mensagens: MensagemOpenAI[] = [];
	const system = texto_de_system(injetar_system(corpo.system as never));
	if (system) mensagens.push({ role: "system", content: system });
	mensagens.push(...converter_mensagens(corpo.messages ?? []));

	const requisicao: RequisicaoOpenAI = {
		model: modelo,
		max_tokens: corpo.max_tokens,
		messages: mensagens,
		stream: false,
	};
	if (Array.isArray(corpo.tools) && corpo.tools.length > 0) {
		requisicao.tools = corpo.tools.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema ?? { type: "object", properties: {} },
			},
		}));
		requisicao.tool_choice = converter_tool_choice(corpo.tool_choice);
	}
	if (typeof corpo.temperature === "number") requisicao.temperature = corpo.temperature;
	if (typeof corpo.top_p === "number") requisicao.top_p = corpo.top_p;
	if (Array.isArray(corpo.stop_sequences) && corpo.stop_sequences.length) {
		requisicao.stop = corpo.stop_sequences;
	}
	return requisicao;
}

interface RespostaOpenAI {
	id?: string;
	model?: string;
	choices?: Array<{
		message?: {
			content?: string | null;
			reasoning_content?: string | null;
			reasoning?: string | null;
			tool_calls?: Array<{
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string;
	}>;
	usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function mapear_stop_reason(motivo: string | undefined): string {
	if (motivo === "tool_calls") return "tool_use";
	if (motivo === "length") return "max_tokens";
	if (motivo === "stop") return "end_turn";
	return "end_turn";
}

function parsear_argumentos(bruto: string | undefined): unknown {
	if (!bruto) return {};
	try {
		return JSON.parse(bruto);
	} catch {
		return {};
	}
}

export function converter_resposta_openai(
	resposta: RespostaOpenAI,
	modeloPedido: string,
): RespostaAnthropic {
	const escolha = resposta.choices?.[0];
	const conteudo: BlocoConteudo[] = [];
	const texto = escolha?.message?.content;
	if (typeof texto === "string" && texto.length > 0) {
		conteudo.push({ type: "text", text: texto });
	}
	for (const chamada of escolha?.message?.tool_calls ?? []) {
		conteudo.push({
			type: "tool_use",
			id: chamada.id ?? `call_${conteudo.length}`,
			name: chamada.function?.name ?? "",
			input: parsear_argumentos(chamada.function?.arguments),
		});
	}
	return {
		id: `msg_${resposta.id ?? Date.now().toString(36)}`,
		type: "message",
		role: "assistant",
		model: resposta.model ?? modeloPedido,
		content: conteudo,
		stop_reason: mapear_stop_reason(escolha?.finish_reason),
		stop_sequence: null,
		usage: {
			input_tokens: resposta.usage?.prompt_tokens ?? 0,
			output_tokens: resposta.usage?.completion_tokens ?? 0,
		},
	};
}

/** Chama um upstream OpenAI-compatible e devolve a resposta em formato Anthropic. */
export async function chamar_openai_chat(
	provider: ProviderResolvido,
	corpo: RequisicaoAnthropic,
	signalExterno?: AbortSignal,
): Promise<ResultadoUpstream> {
	const modelo = corpo.model || provider.modelo;
	const requisicao = montar_requisicao_openai(corpo, modelo);
	const { signal, cancelar } = criar_sinal_com_timeout(
		TIMEOUT_RESPOSTA_UPSTREAM_MS,
		signalExterno,
	);
	try {
		const resposta = await fetch(endpoint_do_provider(provider), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...provider.headers,
			},
			body: JSON.stringify(requisicao),
			signal,
		});
		const texto = await resposta.text();
		if (!resposta.ok) {
			throw new Error(
				`upstream openai ${resposta.status}: ${texto.slice(0, 500)}`,
			);
		}
		const json = JSON.parse(texto) as RespostaOpenAI;
		const mensagem = json.choices?.[0]?.message;
		const raciocinio = (mensagem?.reasoning_content ?? mensagem?.reasoning ?? "") || "";
		return {
			resposta: converter_resposta_openai(json, modelo ?? "unknown"),
			raciocinio,
		};
	} finally {
		cancelar();
	}
}
