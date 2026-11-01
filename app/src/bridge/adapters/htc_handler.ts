// language: TypeScript, file: src/bridge/adapters/htc_handler.ts, runtime: Bun/Node
// Adapter que delega ao PROPRIO stack de providers do HTC
// (`Llms.createHandlerAsync`). E o caminho fiel: herda auth, free tier do
// OpenCode (servidor local), refresh de OAuth do Cline, roteamento, etc.
// Converte Anthropic -> mensagens do HTC, consome o ApiStream e devolve a
// resposta completa em formato Anthropic.

import { Llms } from "@cline/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, Message, ToolDefinition } from "@cline/shared";
import type {
	BlocoConteudo,
	ResultadoUpstream,
	RespostaAnthropic,
} from "../anthropic_sse";
import type { ProviderResolvido } from "../provider_resolver";
import { criar_sinal_com_timeout, TIMEOUT_RESPOSTA_UPSTREAM_MS } from "../timeouts";
import type { RequisicaoAnthropic } from "./anthropic";

/** Chave anonima do OpenCode Zen (libera todos os modelos, sem cobranca). */
const CHAVE_ANONIMA_OPENCODE = "public";

/** Nao ha handler do HTC para este provider — o caller deve cair no HTTP direto. */
export class ErroHandlerIndisponivel extends Error {
	constructor(motivo: string) {
		super(motivo);
		this.name = "ErroHandlerIndisponivel";
	}
}

/**
 * Enxuga o servidor opencode ao minimo (corta ~97%): data-dir ISOLADO (fora do
 * `opencode.db` de ~2.4 GB do usuario) + desliga updater/LSP/plugins/share/web/
 * catalog/autocompact/skills etc. Sem isso o runtime sobe pesado e mexe no
 * banco gigante compartilhado. `HTC_BRIDGE_OC_LEVE=off` desativa.
 */
const FLAGS_OPENCODE_MAGRO = [
	"OPENCODE_DISABLE_CHANNEL_DB",
	"OPENCODE_DISABLE_AUTOUPDATE",
	"OPENCODE_ALWAYS_NOTIFY_UPDATE",
	"OPENCODE_DISABLE_LSP_DOWNLOAD",
	"OPENCODE_DISABLE_DEFAULT_PLUGINS",
	"OPENCODE_DISABLE_EMBEDDED_WEB_UI",
	"OPENCODE_DISABLE_SHARE",
	"OPENCODE_DISABLE_AUTO_SHARE",
	"OPENCODE_DISABLE_MODELS_FETCH",
	"OPENCODE_DISABLE_PRUNE",
	"OPENCODE_DISABLE_FFF",
	"OPENCODE_DISABLE_CLAUDE_CODE",
	"OPENCODE_DISABLE_CLAUDE_CODE_PROMPT",
	"OPENCODE_DISABLE_CLAUDE_CODE_SKILLS",
	"OPENCODE_DISABLE_EXTERNAL_SKILLS",
	"OPENCODE_DISABLE_PROJECT_CONFIG",
	"OPENCODE_DISABLE_AUTOCOMPACT",
	"OPENCODE_DISABLE_TERMINAL_TITLE",
	"OPENCODE_DISABLE_MOUSE",
];

export function configurar_ambiente_opencode(
	env: NodeJS.ProcessEnv = process.env,
): void {
	if ((env.HTC_BRIDGE_OC_LEVE ?? "on").trim().toLowerCase() === "off") return;
	const base = env.HTC_BRIDGE_OC_DIR?.trim() || join(tmpdir(), "htc-opencode");
	env.XDG_DATA_HOME = env.XDG_DATA_HOME || base;
	env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME || join(base, "config");
	env.OPENCODE_DB = env.OPENCODE_DB || join(base, "htc.db");
	for (const flag of FLAGS_OPENCODE_MAGRO) {
		if (env[flag] === undefined) env[flag] = "1";
	}
	// Silencia o ruido do AI SDK/opencode que vazaria pra TUI do Claude Code.
	if (env.AI_SDK_LOG_WARNINGS === undefined) env.AI_SDK_LOG_WARNINGS = "false";
	if (env.OPENCODE_LOG_LEVEL === undefined) env.OPENCODE_LOG_LEVEL = "error";
}

/** Filtra o ruido do opencode/AI-SDK que poluiria a TUI do Claude Code. */
const RUIDO_LOG =
	/opencode-provider|not supported by OpenCode|AI SDK Warning|Parameter 'maxTokens'|Custom tool definitions are ignored|executes tools server-side|cannot use client-provided results|Vercel AI SDK|ai-sdk/i;

let filtro_instalado = false;
export function instalar_filtro_de_logs(): void {
	if (filtro_instalado) return;
	filtro_instalado = true;
	// Desliga os warnings do AI SDK (inclusive stack traces) na origem.
	(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
	for (const metodo of ["warn", "error", "log"] as const) {
		const original = console[metodo].bind(console);
		console[metodo] = (...args: unknown[]) => {
			if (RUIDO_LOG.test(args.map((a) => String(a)).join(" "))) return;
			original(...args);
		};
	}
	// O SDK do opencode as vezes escreve direto no stdout/stderr (nao via console):
	// como `htc claude` compartilha o terminal, isso fura a TUI. Filtramos aqui.
	const filtrar_escrita = (
		escrita: typeof process.stdout.write,
	): typeof process.stdout.write =>
		((chunk: unknown, enc?: unknown, cb?: unknown) => {
			const texto = typeof chunk === "string" ? chunk : String(chunk);
			if (RUIDO_LOG.test(texto)) {
				if (typeof enc === "function") (enc as () => void)();
				else if (typeof cb === "function") (cb as () => void)();
				return true;
			}
			return (escrita as (...a: unknown[]) => boolean)(chunk, enc, cb);
		}) as typeof process.stdout.write;
	process.stdout.write = filtrar_escrita(process.stdout.write.bind(process.stdout));
	process.stderr.write = filtrar_escrita(process.stderr.write.bind(process.stderr));
}

interface BlocoAnthropic {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
	source?: { type?: string; media_type?: string; data?: string };
}

function texto_de_system(system: unknown): string {
	if (typeof system === "string") return system;
	if (Array.isArray(system)) {
		return system
			.map((b) => (b && typeof b === "object" ? (b as BlocoAnthropic).text : undefined))
			.filter((t): t is string => typeof t === "string")
			.join("\n\n");
	}
	return "";
}

function converter_bloco(bloco: BlocoAnthropic): ContentBlock | undefined {
	switch (bloco.type) {
		case "text":
			return { type: "text", text: bloco.text ?? "" };
		case "image":
			if (bloco.source?.data) {
				return {
					type: "image",
					data: bloco.source.data,
					mediaType: bloco.source.media_type ?? "image/png",
				};
			}
			return undefined;
		case "tool_use":
			return {
				type: "tool_use",
				id: bloco.id ?? "",
				name: bloco.name ?? "",
				input: bloco.input ?? {},
			};
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id: bloco.tool_use_id ?? "",
				name: "",
				content:
					typeof bloco.content === "string"
						? bloco.content
						: JSON.stringify(bloco.content ?? ""),
				is_error: bloco.is_error,
			};
		default:
			return undefined;
	}
}

function converter_mensagens(mensagens: unknown): Message[] {
	if (!Array.isArray(mensagens)) return [];
	return mensagens.map((m) => {
		const msg = m as { role: "user" | "assistant"; content: unknown };
		if (typeof msg.content === "string") {
			return { role: msg.role, content: msg.content } as Message;
		}
		const blocos = Array.isArray(msg.content)
			? msg.content.map((b) => converter_bloco(b as BlocoAnthropic)).filter(Boolean)
			: [];
		return { role: msg.role, content: blocos as ContentBlock[] } as Message;
	});
}

function converter_tools(tools: unknown): ToolDefinition[] | undefined {
	if (!Array.isArray(tools) || tools.length === 0) return undefined;
	return tools.map((t) => {
		const tool = t as { name?: string; description?: string; input_schema?: unknown };
		return {
			name: tool.name ?? "",
			description: tool.description ?? "",
			inputSchema: (tool.input_schema ?? { type: "object", properties: {} }) as Record<
				string,
				unknown
			>,
		};
	});
}

function parsear_argumentos(bruto: unknown): Record<string, unknown> {
	if (bruto && typeof bruto === "object") return bruto as Record<string, unknown>;
	if (typeof bruto !== "string" || !bruto) return {};
	try {
		return JSON.parse(bruto) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** Monta a config do handler a partir do provider resolvido. */
function config_do_handler(
	provider: ProviderResolvido,
	modelId: string,
): Llms.ProviderConfig {
	const apiKey =
		provider.apiKey ||
		(provider.id === "opencode" ? CHAVE_ANONIMA_OPENCODE : undefined);
	return {
		providerId: provider.id,
		modelId,
		apiKey,
		baseUrl: provider.baseUrl || undefined,
	};
}

/**
 * Cache de handlers por provider/modelo. Reusar evita recriar o cliente opencode
 * a cada request (que disparava "Client manager already initialized" e subia o
 * servidor varias vezes — pesado e barulhento).
 */
const CACHE_HANDLERS = new Map<string, Promise<Llms.ApiHandler>>();

function obter_handler(
	provider: ProviderResolvido,
	modelId: string,
): Promise<Llms.ApiHandler> {
	const chave = `${provider.id}:${modelId}`;
	let pendente = CACHE_HANDLERS.get(chave);
	if (!pendente) {
		pendente = Llms.createHandlerAsync(config_do_handler(provider, modelId));
		CACHE_HANDLERS.set(chave, pendente);
		pendente.catch(() => CACHE_HANDLERS.delete(chave));
	}
	return pendente;
}

/**
 * Chama o modelo pelo handler do HTC e acumula o stream numa resposta Anthropic
 * completa (o bridge corrige/reenvia antes de emitir ao Claude Code).
 */
export async function chamar_via_handler(
	provider: ProviderResolvido,
	modelId: string,
	corpo: RequisicaoAnthropic,
	signalExterno?: AbortSignal,
): Promise<ResultadoUpstream> {
	const { signal, cancelar } = criar_sinal_com_timeout(
		TIMEOUT_RESPOSTA_UPSTREAM_MS,
		signalExterno,
	);
	configurar_ambiente_opencode();
	try {
		let handler: Llms.ApiHandler;
		try {
			handler = await obter_handler(provider, modelId);
		} catch (erro) {
			throw new ErroHandlerIndisponivel(
				erro instanceof Error ? erro.message : String(erro),
			);
		}
		handler.setAbortSignal?.(signal);
		const { injetar_system } = await import("../injection");
		// O caminho local do OpenCode manda o system DELE; sem isso a injecao do
		// nucleo nunca chegava nesse adapter (era a parte principal do MXC).
		const sistema = texto_de_system(injetar_system(corpo.system as never));
		const mensagens = converter_mensagens(corpo.messages);
		const tools = converter_tools(corpo.tools);

		const conteudo: BlocoConteudo[] = [];
		const toolUses: BlocoConteudo[] = [];
		let texto = "";
		let raciocinio = "";
		let entradaTokens = 0;
		let saidaTokens = 0;
		let erro: string | undefined;

		const stream = handler.createMessage(sistema, mensagens, tools);
		for await (const chunk of stream) {
			if (chunk.type === "text") {
				texto += chunk.text;
			} else if (chunk.type === "reasoning") {
				raciocinio += chunk.reasoning;
			} else if (chunk.type === "tool_calls") {
				const fn = chunk.tool_call.function ?? {};
				toolUses.push({
					type: "tool_use",
					id: chunk.tool_call.call_id ?? fn.id ?? `call_${toolUses.length}`,
					name: fn.name ?? "",
					input: parsear_argumentos(fn.arguments),
				});
			} else if (chunk.type === "usage") {
				entradaTokens = chunk.inputTokens ?? entradaTokens;
				saidaTokens = chunk.outputTokens ?? saidaTokens;
			} else if (chunk.type === "done") {
				if (!chunk.success) erro = chunk.error ?? "stream falhou";
			}
		}
		if (erro) throw new Error(erro);

		if (texto) conteudo.push({ type: "text", text: texto });
		conteudo.push(...toolUses);

		const resposta: RespostaAnthropic = {
			id: `msg_${Date.now().toString(36)}`,
			type: "message",
			role: "assistant",
			model: modelId,
			content: conteudo,
			stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
			stop_sequence: null,
			usage: { input_tokens: entradaTokens, output_tokens: saidaTokens },
		};
		return { resposta, raciocinio };
	} finally {
		cancelar();
	}
}
