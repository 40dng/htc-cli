// language: TypeScript, file: src/bridge/server.ts, runtime: Bun/Node
// Bridge local: expoe uma API Anthropic-compatible em loopback para o Claude
// Code e encaminha para o provider REAL configurado no HTC, aplicando injecao
// no system e correcao (retry) na resposta antes de devolver.

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { chamar_anthropic, type RequisicaoAnthropic } from "./adapters/anthropic";
import {
	chamar_openai_chat,
	type RequisicaoAnthropic as RequisicaoAnthropicOpenAI,
} from "./adapters/openai_chat";
import { chamar_via_handler } from "./adapters/htc_handler";
import { escrever_mensagem_sse, type RespostaAnthropic } from "./anthropic_sse";
import {
	detectar_recusa,
	eixo_de_correcao,
	injetar_system,
	injecao_ativa,
	NUDGE_REFORCO,
	resposta_conforme,
	texto_visivel_da_resposta,
} from "./injection";
import { nivel_para_tentativa } from "../runtime/htc-bypass";
import {
	aplicar_aperfeicoador,
	guarda_de_comando,
	type MensagemBridge,
	reforcar_ultimo_user,
	tool_result_de_bloqueio,
} from "./guards";
import {
	provider_padrao,
	listar_modelos_configurados,
	resolver_provider,
	type ProviderResolvido,
} from "./provider_resolver";
import { CONTEXTO_OPENCODE_GO } from "./contexto_modelo";
import { endpoint_eh_opencode } from "./rota_upstream";
import {
	criar_sinal_com_timeout,
	dormir,
	TIMEOUT_COUNT_TOKENS_MS,
	TIMEOUT_RETRY_BACKOFF_MS,
	TIMEOUT_TOTAL_REQUISICAO_MS,
} from "./timeouts";

/** Tamanho maximo aceito no corpo da requisicao (contexto grande do Claude Code). */
const LIMITE_CORPO_BYTES = 64 * 1024 * 1024;

export interface ConfigBridge {
	host: string;
	port: number;
	providerId: string;
	modelo?: string;
	rotear_por_modelo: boolean;
	tentativas: number;
}

export interface EstadoBridge {
	requisicoes: number;
	correcoes: number;
	ultimoErro?: string;
	ultima?: {
		pedido?: string;
		provider?: string;
		modelo?: string;
		correcoes: number;
		trecho: string;
	};
}

function ler_corpo(
	req: IncomingMessage,
	signal: AbortSignal,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const partes: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > LIMITE_CORPO_BYTES) {
				reject(new Error("corpo da requisicao excede o limite"));
				req.destroy();
				return;
			}
			partes.push(chunk);
		});
		req.on("end", () => {
			if (signal.aborted) return reject(signal.reason);
			const bruto = Buffer.concat(partes).toString("utf8");
			if (!bruto.trim()) return resolve({});
			try {
				resolve(JSON.parse(bruto));
			} catch (erro) {
				reject(erro instanceof Error ? erro : new Error(String(erro)));
			}
		});
		req.on("error", reject);
		signal.addEventListener("abort", () => req.destroy(), { once: true });
	});
}

/** Descobre o provider/modelo alvo: rota por `provider/modelo` se habilitado. */
function resolver_alvo(
	corpo: { model?: string },
	config: ConfigBridge,
): { provider: ProviderResolvido; modelo: string | undefined } {
	const pedido = typeof corpo.model === "string" ? corpo.model.trim() : "";
	if (config.rotear_por_modelo && pedido.includes("/")) {
		const [id, ...resto] = pedido.split("/");
		try {
			const provider = resolver_provider(id);
			return { provider, modelo: resto.join("/") || provider.modelo };
		} catch {
			// cai no default abaixo
		}
	}
	// Preserva o NOME pedido e escolhe o provider por familia: claude* -> Zen
	// free (opencode); o resto -> Go (opencode-go). Assim o rotulo do picker
	// bate com o modelo real e tudo passa pela injecao.
	if (pedido && !pedido.includes("/")) {
		const providerId = /claude/i.test(pedido) ? "opencode" : "opencode-go";
		try {
			return { provider: resolver_provider(providerId), modelo: pedido };
		} catch {
			// cai no default abaixo
		}
	}
	const provider = resolver_provider(config.providerId);
	return { provider, modelo: config.modelo ?? provider.modelo };
}

function responder_json(
	res: ServerResponse,
	status: number,
	corpo: unknown,
): void {
	if (res.headersSent) return;
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(corpo));
}

function responder_erro(res: ServerResponse, status: number, mensagem: string): void {
	responder_json(res, status, {
		type: "error",
		error: { type: "api_error", message: mensagem },
	});
}

/**
 * Chama o upstream. Por default usa o HANDLER do HTC (`Llms.createHandlerAsync`),
 * que herda auth, free tier do OpenCode e OAuth do Cline. `HTC_BRIDGE_HTTP=on`
 * forca o caminho HTTP direto (passthrough/openai-chat).
 */
async function chamar_upstream(
	provider: ProviderResolvido,
	modelo: string | undefined,
	corpo: unknown,
	signal: AbortSignal,
): Promise<{ resposta: RespostaAnthropic; raciocinio: string }> {
	const viaHttp = () =>
		provider.protocolo === "anthropic"
			? chamar_anthropic(provider, corpo as RequisicaoAnthropic, signal)
			: chamar_openai_chat(
					provider,
					corpo as unknown as RequisicaoAnthropicOpenAI,
					signal,
				);

	if ((process.env.HTC_BRIDGE_HTTP ?? "off").trim().toLowerCase() === "on") {
		return await viaHttp();
	}
	// Endpoint do OpenCode (Zen/Go): SO o HTTP direto serve. Ele monta o
	// fingerprint exigido (`x-opencode-session`); o handler do core nao manda
	// esse header e o upstream devolve 400 MissingSessionID — usar o handler
	// aqui trocaria o erro real (402/403/429) por um erro de header enganoso.
	if (endpoint_eh_opencode(provider.baseUrl)) {
		return await viaHttp();
	}
	try {
		return await chamar_via_handler(
			provider,
			modelo ?? provider.modelo ?? "",
			corpo as RequisicaoAnthropic,
			signal,
		);
	} catch {
		return await viaHttp();
	}
}

/** Executa o turno com correcao: reenvia se a resposta parecer recusa. */
async function executar_com_correcao(
	provider: ProviderResolvido,
	corpo: RequisicaoAnthropic,
	modelo: string | undefined,
	tentativas: number,
	signal: AbortSignal,
): Promise<{ resposta: RespostaAnthropic; correcoes: number }> {
	const mensagens = reforcar_ultimo_user(
		aplicar_aperfeicoador((corpo.messages ?? []) as MensagemBridge[]),
	) as unknown[];
	const sistemaOriginal = corpo.system as never;
	const base = {
		...corpo,
		model: modelo,
		system: injetar_system(sistemaOriginal),
		messages: mensagens,
	};
	let correcoes = 0;
	for (;;) {
		const { resposta, raciocinio } = await chamar_upstream(
			provider,
			modelo,
			base,
			signal,
		);
		// O Claude Code guarda o `model` da RESPOSTA no transcript e tenta
		// restaura-lo ao retomar. Devolve o id ROTEADO (provider/modelo), que e o
		// do picker — senao ele avisa "could not be restored".
		resposta.model = modelo ? `${provider.id}/${modelo}` : provider.id;

		// Repassa o reasoning (thinking) ao cliente: os adapters ja o capturam,
		// mas ele nao estava sendo emitido — por isso o "Thinking" sumia. Entra
		// como bloco `thinking` ANTES do texto/tool_use.
		if (raciocinio.trim()) {
			resposta.content = [
				{ type: "thinking", thinking: raciocinio, signature: "" },
				...(resposta.content ?? []),
			];
		}

		// 1) Guarda de comando: nao deixa o Claude Code executar o que pendura o
		// shell. Devolve o motivo como tool_result e o modelo tenta de novo —
		// mesma semantica do beforeTool skip do HTC.
		const guarda = guarda_de_comando(resposta);
		if (guarda && correcoes < tentativas) {
			(base.messages as MensagemBridge[]).push(
				{ role: "assistant", content: resposta.content },
				{ role: "user", content: [tool_result_de_bloqueio(guarda)] },
			);
			correcoes += 1;
			await dormir(TIMEOUT_RETRY_BACKOFF_MS);
			continue;
		}

		// 2) Correcao interna: exige o protocolo (abre com [RAE]) e detecta
		// recusa/moralizacao no texto visivel OU no reasoning.
		//
		// ESCAPE CORRIGIDO: um turno de ACAO (tool_use) nao tem texto visivel, e
		// `resposta_conforme("")` retornava false — a bridge tratava o agente
		// trabalhando como recusa e injetava NUDGE no meio do loop, derrubando a
		// tarefa. Agora: turno com tool_use NAO exige o marcador nem julga o
		// reasoning; so uma recusa EXPLICITA no texto visivel conta.
		const visivel = texto_visivel_da_resposta(resposta);
		const tem_tool_use = (resposta.content ?? []).some(
			(bloco) => (bloco as { type?: string }).type === "tool_use",
		);
		const recusa_no_texto = detectar_recusa(visivel);
		const recusou = tem_tool_use
			? recusa_no_texto
			: !resposta_conforme(visivel) || detectar_recusa(raciocinio);
		if (!recusou || correcoes >= tentativas) {
			return { resposta, correcoes };
		}
		(base.messages as MensagemBridge[]).push({
			role: "user",
			content: `${NUDGE_REFORCO}\n\n${eixo_de_correcao(correcoes + 1)}`,
		});
		correcoes += 1;
		// System reescrito com nivel acima e eixo novo: reenviar o mesmo texto com
		// o mesmo piso devolvia a mesma recusa, palavra por palavra.
		base.system = injetar_system(sistemaOriginal, nivel_para_tentativa(correcoes));
		await dormir(TIMEOUT_RETRY_BACKOFF_MS);
	}
}

async function tratar_mensagens(
	req: IncomingMessage,
	res: ServerResponse,
	config: ConfigBridge,
	estado: EstadoBridge,
): Promise<void> {
	const cliente = new AbortController();
	const { signal, cancelar } = criar_sinal_com_timeout(
		TIMEOUT_TOTAL_REQUISICAO_MS,
		cliente.signal,
	);
	// Aborta o trabalho se o CLIENTE sumir. Nao usar req 'close': ele dispara
	// quando o corpo termina de ser lido (nao so em desconexao) e destruiria a
	// resposta. `res` 'close' com writableEnded=false e a deteccao correta.
	const aoFechar = () => {
		if (!res.writableEnded) cliente.abort(new Error("cliente desconectou"));
	};
	res.on("close", aoFechar);
	try {
		const corpo = (await ler_corpo(req, signal)) as RequisicaoAnthropic & {
			model?: string;
			stream?: boolean;
		};
		if (process.env.HTC_BRIDGE_DUMP === "1") {
			try {
				const { appendFileSync } = await import("node:fs");
				const { homedir } = await import("node:os");
				const { join } = await import("node:path");
				appendFileSync(
					join(homedir(), ".raehook-dump.txt"),
					JSON.stringify({
						model: corpo.model,
						system: corpo.system,
						tools: ((corpo as { tools?: Array<{ name?: string }> }).tools ?? []).map(
							(t) => t?.name,
						),
						msgs: Array.isArray(corpo.messages) ? corpo.messages.length : 0,
					}) + "\n",
				);
			} catch {
				// dump e best-effort
			}
		}
		if (!Array.isArray(corpo.messages)) {
			responder_erro(res, 400, "campo 'messages' ausente ou invalido");
			return;
		}
		const { provider, modelo } = resolver_alvo(corpo, config);
		estado.requisicoes += 1;
		const { resposta, correcoes } = await executar_com_correcao(
			provider,
			corpo,
			modelo,
			config.tentativas,
			signal,
		);
		estado.correcoes += correcoes;
		estado.ultima = {
			pedido: corpo.model,
			provider: provider.id,
			modelo,
			correcoes,
			trecho: texto_visivel_da_resposta(resposta).slice(0, 160),
		};

		if (corpo.stream) {
			res.statusCode = 200;
			res.setHeader("content-type", "text/event-stream");
			res.setHeader("cache-control", "no-cache");
			res.setHeader("connection", "keep-alive");
			res.flushHeaders?.();
			escrever_mensagem_sse(res, resposta);
			res.end();
			return;
		}
		responder_json(res, 200, resposta);
	} catch (erro) {
		const mensagem = erro instanceof Error ? erro.message : String(erro);
		estado.ultimoErro = mensagem;
		responder_erro(res, 502, mensagem);
	} finally {
		cancelar();
		res.off("close", aoFechar);
	}
}

function estimar_tokens(corpo: unknown): number {
	const bruto = JSON.stringify(corpo ?? {});
	return Math.max(1, Math.ceil(bruto.length / 4));
}

function eh_provider_opencode(id: string): boolean {
	return id === "opencode" || id === "opencode-go" || id.startsWith("opencode");
}

export function criar_servidor_bridge(
	config: ConfigBridge,
	estado: EstadoBridge = { requisicoes: 0, correcoes: 0 },
): Server {
	return createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);
		const rota = `${req.method} ${url.pathname}`;

		if (rota === "GET /health") {
			responder_json(res, 200, {
				status: "ok",
				provider: config.providerId,
				modelo: config.modelo,
				injecao: injecao_ativa(),
				...estado,
			});
			return;
		}

		if (rota === "POST /v1/messages/count_tokens") {
			const { signal, cancelar } = criar_sinal_com_timeout(TIMEOUT_COUNT_TOKENS_MS);
			ler_corpo(req, signal)
				.then((corpo) => responder_json(res, 200, { input_tokens: estimar_tokens(corpo) }))
				.catch((erro) =>
					responder_erro(res, 400, erro instanceof Error ? erro.message : String(erro)),
				)
				.finally(cancelar);
			return;
		}

		if (rota === "POST /v1/messages") {
			void tratar_mensagens(req, res, config, estado);
			return;
		}

		if (rota === "GET /v1/models") {
			// Anuncia todos os modelos dos providers configurados no HTC
			// (gateway discovery + picker). Ids `provider/modelo` roteiam sozinhos.
			void listar_modelos_configurados()
				.then((ids) => {
					const lista =
						ids.length > 0
							? ids
							: eh_provider_opencode(config.providerId)
								? Object.keys(CONTEXTO_OPENCODE_GO).map(
										(m) => `${config.providerId}/${m}`,
									)
								: config.modelo
									? [`${config.providerId}/${config.modelo}`]
									: [];
					responder_json(res, 200, {
						data: lista.map((id) => ({
							id,
							type: "model",
							display_name: id,
							owned_by: config.providerId,
						})),
					});
				})
				.catch(() => responder_json(res, 200, { data: [] }));
			return;
		}

		responder_erro(res, 404, `rota desconhecida: ${rota}`);
	});
}

/** Resolve a config efetiva combinando flags, env e providers.json do HTC. */
export function resolver_config_bridge(
	opcoes: Partial<ConfigBridge> = {},
	env: Record<string, string | undefined> = process.env,
): ConfigBridge {
	const providerId =
		opcoes.providerId?.trim() ||
		env.HTC_BRIDGE_PROVIDER?.trim() ||
		provider_padrao(env) ||
		"opencode-go";
	// `lastUsedProvider` do HTC pode apontar para um provider sem credito. O
	// default de trabalho e o Zen (opencode) free; override explicito vence.
	const providerFinal = providerId;
	const portaLida = Number.parseInt(
		String(opcoes.port ?? env.HTC_BRIDGE_PORT ?? "8788"),
		10,
	);
	return {
		host: opcoes.host?.trim() || env.HTC_BRIDGE_HOST?.trim() || "127.0.0.1",
		port: Number.isInteger(portaLida) && portaLida > 0 ? portaLida : 8788,
		providerId: providerFinal,
		modelo: opcoes.modelo?.trim() || env.HTC_BRIDGE_MODEL?.trim() || undefined,
		rotear_por_modelo:
			opcoes.rotear_por_modelo ??
			(env.HTC_BRIDGE_ROUTE_BY_MODEL ?? "on").trim().toLowerCase() !== "off",
		tentativas: opcoes.tentativas ?? 5,
	};
}
