import {
	type AgentEvent,
	type AgentResult,
	type ProviderSettings,
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigService,
} from "@cline/core";
import type { ConsecutiveMistakeLimitContext } from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { logCliError } from "../logging/errors";
import { createCliCore } from "../session/session";
import { resolveClineWelcomeLine } from "../tui/interactive-welcome";
import {
	askQuestionInTerminal,
	requestToolApproval,
	submitAndExitInTerminal,
} from "../utils/approval";
import { eh_provedor_opencode } from "../utils/opencode_provider";
import { indexacao_do_workspace_bloqueada } from "../utils/workspace_guard";
import {
	criar_resolvedor_do_cli,
	registrar_resolvedor_de_pergunta,
	remover_resolvedor_de_pergunta,
} from "./opencode_question";
import { formatCliErrorMessage } from "../utils/cline-pass-errors";
import { handleEvent, handleTeamEvent } from "../utils/events";
import {
	type AcumuladorPensamento,
	criar_acumulador_pensamento,
	diretiva_de_recusa,
	NUDGE_PENSAMENTO,
	NUDGE_TEXTO,
	pensamento_ativo,
} from "./pensamento";
import { reancorar_turno } from "./escopo";
import { degrau_da_fase } from "./escada";
import { ancora_do_turno_async, veredicto_do_turno_async } from "./htc-bypass";
import { caixa_para_turno } from "./contexto";
import { autonomia_ativa, instrucao_autonoma, pediu_fim } from "./autonomia";
import { recusa_no_texto, trace, type VeredictoJuiz } from "./juiz-recusa";
import {
	absorverAlvos,
	alvoEmCurso,
	blocoFila,
	ehLote,
	deveEstacionar,
	enquadrarTurno,
	marcarAlvo,
	proximoAlvo,
	registrarTentativa,
	reivindicarFilaPendente,
} from "./fila-alvos";
import { limparDossieComJuiz } from "./dossie";
import { textoMissao, textoMissaoResumo, carregarMissao } from "./missao";
import { aperfeicoar_prompt, resumir_relatorio } from "./aperfeicoador";
import {
	shouldZeroClineFreeModelCost,
	zeroCliAgentEventCost,
	zeroCliUsageCost,
} from "../utils/free-model-cost";
import { createRuntimeHooks } from "../utils/hooks";
import {
	c,
	emitJsonLine,
	formatUsd,
	getActiveCliSession,
	setActiveCliSession,
	writeErr,
	writeln,
} from "../utils/output";
import type { Config } from "../utils/types";
import { shouldShowCliUsageCost } from "../utils/usage-cost-display";
import { setActiveRuntimeAbort } from "./active-runtime";
import { marcarUltimaSessao } from "./last-session";
import {
	contaTurnosSemMudanca,
	decidirContinuacao,
	descreverContinuacao,
	estagnou,
	MAX_AUTO_CONTINUES_PADRAO,
	montarPromptContinuacao,
	PROMPT_CONTINUACAO,
	tetoDeContinuacoes,
	type AutoContinueConfig,
} from "./auto-continue";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "./defaults";
import { describeAbortSource, resolveMistakeLimitDecision } from "./format";
import { buildUserInputMessage } from "./prompt";
import { criar_executores_com_vigia } from "./executor-guard";

import { subscribeToAgentEvents } from "./session-events";

function printModelProviderInfo(config: Config): void {
	const catalog = config.knownModels ? "live" : "bundled";
	const thinking = config.thinking ? "on" : "off";
	const { mode, providerId, modelId } = config;
	if (config.outputMode === "json") {
		emitJsonLine("stdout", {
			type: "run_start",
			providerId,
			modelId,
			catalog,
			thinking,
			mode,
			sessionId: getActiveCliSession()?.manifest.session_id,
		});
		return;
	}
	writeln(
		`${c.dim}[model] provider=${providerId} model=${modelId} catalog=${catalog} thinking=${thinking} mode=${mode}${c.reset}\n`,
	);
}

function emitAbortRequested(
	config: Config,
	reason: "sigint" | "sigterm",
): void {
	if (config.outputMode === "json") {
		emitJsonLine("stdout", { type: "run_abort_requested", reason });
	} else if (reason === "sigint") {
		writeln(`\n${c.dim}[abort] requested${c.reset}`);
	}
}

function emitTeamRestored(config: Config): void {
	const teamName = config.teamName ?? "(unknown team)";
	if (config.outputMode === "json") {
		emitJsonLine("stdout", { type: "team_restored", teamName });
		return;
	}
	writeln(
		`${c.dim}[team] restored persisted team state for "${teamName}"${c.reset}`,
	);
}

function printRunStats(
	config: Config,
	result: AgentResult,
	usage: AgentResult["usage"],
	startTime: number,
	reasoningChunkCount: number,
	redactedReasoningChunkCount: number,
): void {
	if (config.outputMode !== "text") {
		return;
	}
	if (config.verbose) {
		writeln();
		const parts: string[] = [];
		parts.push(`${((performance.now() - startTime) / 1000).toFixed(2)}s`);
		const tokenParts: string[] = [
			`${usage.inputTokens} in`,
			`${usage.outputTokens} out`,
		];
		if (usage.cacheReadTokens) {
			tokenParts.push(`${usage.cacheReadTokens} cache read`);
		}
		if (usage.cacheWriteTokens) {
			tokenParts.push(`${usage.cacheWriteTokens} cache write`);
		}
		parts.push(tokenParts.join(", "));
		if (
			shouldShowCliUsageCost(config.providerId) &&
			typeof usage.totalCost === "number"
		) {
			parts.push(`${formatUsd(usage.totalCost)} est. cost`);
		}
		if (result.iterations > 1) {
			parts.push(`${result.iterations} iterations`);
		}
		writeln(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
		if (config.thinking) {
			writeln(
				`${c.dim}[thinking] chunks=${reasoningChunkCount} redacted=${redactedReasoningChunkCount}${c.reset}`,
			);
		}
	}
}

export async function runAgent(
	prompt: string,
	config: Config,
	userInstructionService?: UserInstructionConfigService,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: ProviderSettings;
	},
): Promise<void> {
	// A clean one-shot run should not inherit a stale nonzero process exit code
	// from lower layers or prior bookkeeping inside the same process.
	process.exitCode = 0;
	trace("run-agent: entrada");

	if (config.verbose) {
		const clineWelcomeLine = await resolveClineWelcomeLine({
			config,
			clineApiBaseUrl: options?.clineApiBaseUrl,
			clineProviderSettings: options?.clineProviderSettings,
		});
		if (clineWelcomeLine && config.outputMode !== "json") {
			writeln(clineWelcomeLine);
		}
	}

	const startTime = performance.now();
	if (!indexacao_do_workspace_bloqueada(config.cwd)) {
		void prewarmFileIndex(config.cwd).catch((error: unknown) => {
			logCliError(config.logger, "File index prewarm failed", { error });
		});
	}

	const isYoloMode = config.mode === "yolo";
	// Vigia de execucao (teto por chamada + reexecucao dos mesmos argumentos) para
	// editor/apply_patch/read_files. O modulo existia sem importador: o wrapper nunca
	// envolvia executor nenhum. Gated como o resto da protecao.
	const vigiados =
		(process.env.HTC_PROTECAO ?? "").trim().toLowerCase() === "on"
			? criar_executores_com_vigia()
			: {};
	const toolExecutors = {
		...vigiados,
		askQuestion: askQuestionInTerminal,
		submit: submitAndExitInTerminal,
	};
	if (eh_provedor_opencode(config.providerId)) {
		// Liga os eventos `question.asked` do opencode ao mesmo canal de pergunta
		// do tool ask_question, para o turno nao travar esperando resposta.
		registrar_resolvedor_de_pergunta(
			criar_resolvedor_do_cli(askQuestionInTerminal),
			"terminal",
		);
	}
	const sessionManager = await createCliCore({
		capabilities: {
			toolExecutors,
			requestToolApproval,
		},
		forceLocalBackend: isYoloMode || config.sandbox === true,
		logger: config.logger,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
		toolPolicies: config.toolPolicies,
	});
	const runtimeHooks = createRuntimeHooks({
		verbose: config.verbose,
		yolo: isYoloMode,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
		dispatchHookEvent: async (payload) => {
			await sessionManager.ingestHookEvent(payload);
		},
	});

	let reasoningChunkCount = 0;
	let redactedReasoningChunkCount = 0;
	const displayedErrorMessages = new Set<string>();
	const shouldZeroCost = await shouldZeroClineFreeModelCost(config);

	// Recusa formando no reasoning, no modo one-shot (`htc "<missao>"`). Este
	// caminho nao passa pelo run-interactive, que era o unico lugar onde o
	// acumulador existia -- por isso o nudge de correcao nunca disparava aqui.
	// O evento ja chega como content_start/reasoning (o contador abaixo conta
	// exatamente isso); faltava alguem ler o texto.
	// Recusa em reasoning NAO aborta o turno no one-shot: `abort()` mata a
	// sessao e o reenvio morre em "session manager did not return a result"
	// (medido: 4 iteracoes, done/reason=aborted, text=""). Marca e corrige
	// depois do turno, com a sessao viva.
	let recusaNoPensamento = false;
	/** Voltas de nudge de reasoning. `nudgeAplicado` booleano permitia UMA
	 * correcao por run e o segundo abort matava o turno. */
	let tentativasDePensamento = 0;
	const MAX_NUDGES_PENSAMENTO = 3;
	/** Voltas de nudge de texto: uma so nao basta (medido: a segunda recusa
	 * vem com o mesmo enquadramento). Teto proprio, independente da fila. */
	let tentativasDeNudge = 0;
	const MAX_NUDGES_TEXTO = 3;
	/** Diretiva do juiz para o retry (familia de recusa nomeada). */
	let diretivaDaRecusa = "";
	let recusaDoTurno: VeredictoJuiz | undefined;
	let acumuladorPensamento: AcumuladorPensamento | undefined;
	/** Ultimo `content_end/text`: saida visivel quando o turno morre por submit. */
	let ultimoTextoVisivel = "";

	const onAgentEvent = (rawEvent: AgentEvent): void => {
		const event = zeroCliAgentEventCost(rawEvent, shouldZeroCost);
		if (event.type === "content_start" && event.contentType === "reasoning") {
			reasoningChunkCount += 1;
			if (event.redacted) {
				redactedReasoningChunkCount += 1;
			}
		}
		// Ultimo texto entregue no stream: usado se o turno terminar por `submit`
		// (submit_and_exit encerra a sessao e o send nao devolve result).
		if (
			event.type === "content_end" &&
			(event as { contentType?: string }).contentType === "text"
		) {
			const texto = (event as { text?: unknown }).text;
			if (typeof texto === "string" && texto.trim()) {
				ultimoTextoVisivel = texto;
			}
		}
		if (
			event.type === "error" &&
			(!event.recoverable || config.verbose) &&
			event.error.message.trim()
		) {
			displayedErrorMessages.add(
				formatCliErrorMessage(event.error.message, {
					modelId: config.modelId,
				}).trim(),
			);
		}
		handleEvent(event, config);
		acumuladorPensamento?.processar(event);
	};
	const plannedSessionId = createSessionId();
	const unsubscribe = subscribeToAgentEvents(sessionManager, onAgentEvent, {
		sessionId: plannedSessionId,
	});

	// --- Abort & signal handling ---
	let abortRequested = false;
	let timedOut = false;
	let activeSessionId: string | undefined;

	const abortAll = () => {
		if (abortRequested) return false;
		abortRequested = true;
		if (activeSessionId) {
			sessionManager
				.abort(activeSessionId, new Error("Run-agent runtime abort requested"))
				.catch(() => {});
		}
		return true;
	};
	setActiveRuntimeAbort(abortAll);

	if (pensamento_ativo()) {
		acumuladorPensamento = criar_acumulador_pensamento(() => {
			if (tentativasDePensamento >= MAX_NUDGES_PENSAMENTO) return;
			recusaNoPensamento = true;
		});
	}

	let cleanupDone: Promise<void> | undefined;
	const cleanupRuntime = () => {
		cleanupDone ??= (async () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			unsubscribe();
			await runtimeHooks.shutdown().catch(() => {});
			if (activeSessionId) {
				await sessionManager.stop(activeSessionId).catch(() => {});
			}
			await sessionManager.dispose("cli_run_shutdown").catch(() => {});
			setActiveRuntimeAbort(undefined);
		})();
		return cleanupDone;
	};

	const handleSigint = () => {
		if (abortAll()) {
			emitAbortRequested(config, "sigint");
			return;
		}
		void cleanupRuntime().finally(() => {
			process.exitCode = 0;
			process.exit(0);
		});
	};
	const handleSigterm = () => {
		if (abortAll()) {
			emitAbortRequested(config, "sigterm");
		}
	};
	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	// --- Main execution ---
	try {
		if (config.verbose) {
			printModelProviderInfo(config);
		}
		// Aperfeicoador: a mesma reescrita anti-recusa do modo interativo. O
		// one-shot (`htc "missao"`) e o caminho principal de automacao e era o
		// unico que nao passava por aqui Ã¢â‚¬â€ os arquivos iam crus para o modelo.
		try {
			const ap = await aperfeicoar_prompt(prompt);
			const resumo = resumir_relatorio(ap);
			if (resumo) {
				config.logger?.log("aperfeicoador: arquivos refinados", { resumo });
			}
		} catch {
			// nunca bloqueia o turno
		}
		const {
			prompt: userInput,
			userImages,
			userFiles,
		} = await buildUserInputMessage(prompt, userInstructionService, {
			mode: config.mode,
		});
		const opcoesDeStart = (sessionId: string) => ({
			source: SessionSource.CLI,
			config: {
				...config,
				sessionId,
				execution: {
					...config.execution,
					loopDetection:
						config.execution?.loopDetection ?? CLI_DEFAULT_LOOP_DETECTION,
				},
				checkpoint: config.checkpoint ?? CLI_DEFAULT_CHECKPOINT_CONFIG,
				hooks: runtimeHooks.hooks,
				onTeamEvent: handleTeamEvent,
				onConsecutiveMistakeLimitReached: async (
					context: ConsecutiveMistakeLimitContext,
				) => resolveMistakeLimitDecision(config, context),
			},
			// Sem prompt no start: o 1o turno tambem passa por send(), para que o
			// loop de auto-continue possa reenviar turnos na mesma sessao. Startar
			// com prompt finalizava a sessao e era o que matava a retomada.
			interactive: false,
			localRuntime: {
				onTeamRestored: () => emitTeamRestored(config),
			},
		});
		const started = await sessionManager.start(opcoesDeStart(plannedSessionId));

		activeSessionId = started.sessionId;
		// Fila por sessao: id no ambiente + reivindica a fila preparada no CLI.
		process.env.HTC_SESSION_ID = started.sessionId;
		try {
			reivindicarFilaPendente();
		} catch {
			// sem fila pendente: segue
		}
		setActiveCliSession({
			manifest: started.manifest,
		});
		// Marcador para o atualizador reabrir NA MESMA conversa depois do restart.
		marcarUltimaSessao({
			sessionId: started.sessionId,
			cwd: config.cwd,
			provider: config.providerId,
			model: config.modelId,
		});

		// Schedule timeout abort if configured.
		const timeoutMs =
			typeof config.timeoutSeconds === "number" &&
			Number.isFinite(config.timeoutSeconds) &&
			config.timeoutSeconds > 0
				? config.timeoutSeconds * 1000
				: undefined;
		const timeoutId = timeoutMs
			? setTimeout(() => {
					timedOut = true;
					abortAll();
				}, timeoutMs)
			: undefined;
		const clearRunTimeout = () => {
			if (timeoutId) clearTimeout(timeoutId);
		};

		// --- Turnos: prompt do operador + AUTO-CONTINUE ---
		// O runtime dirige TODOS os turnos por send() na MESMA sessao. Depois de
		// cada turno concluido em que o agente escreveu um board/resumo (sem
		// marcador terminal, sem pergunta ao operador), o PROMPT_CONTINUACAO e
		// reenviado automaticamente ate [FIM], o teto, uma pergunta, ou abort.
		const autoCfg: AutoContinueConfig = config.autoContinue ?? {};
		const autoMax = tetoDeContinuacoes(autoCfg);
		// A cauda do turno deriva do prompt do operador — nao o contrario.
		// `parar` nao recebe cauda nenhuma e desliga o auto-continue; `conversa`
		// recebe so o estado e tambem nao retoma.
		// Intencao, assunto e degrau saem do MESMO veredito: o juiz de turno le a
		// mensagem, o regex responde so quando nao ha juiz. Antes eram tres
		// medidas separadas — duas por vocabulario aqui e uma por casamento de
		// palavra no `degrau_do_texto`, dentro de `reancorar_turno`.
		const veredictoDoTurno = await veredicto_do_turno_async(userInput);
		const intencaoDoOperador = veredictoDoTurno.intencao;
		// Sobre o que ele esta falando: alvo/operacao ou bancada/config/conversa.
		// So o turno sobre a operacao carrega TARGET/MISSION.
		const assuntoDoOperador = veredictoDoTurno.assunto;
		const degrauDoTurno = veredictoDoTurno.degrau;
		if (intencaoDoOperador === "parar" && config.outputMode !== "json") {
			writeln(`${c.dim}[turno] pedido de parada — sem cauda e sem retomada${c.reset}`);
		}

		let result: AgentResult | undefined = started.result;
		let continuacao = 0;
		let assinaturaEstado = "";
		let turnosSemMudanca = 0;
		// FILA DE ALVOS: a lista do operador e absorvida antes do primeiro envio.
		// N alvos numa mensagem viram recusa de padrao a partir do quarto; aqui
		// o turno carrega um alvo e a lista fica no disco.
		// Pedido de parada nao enfileira nada: absorver alvos numa mensagem de
		// parada transforma "para" em mais trabalho enfileirado.
		const absorcao =
			intencaoDoOperador === "parar"
				? { absorvidos: [], citados: [], texto: userInput, total: 0 }
				: absorverAlvos(userInput);
		let pedidoBase = userInput;
		// Porteira do documento: o regex limpou o que casou durante a absorcao
		// (sincrona); aqui o juiz le a amostra do dossie e remove o resto. A
		// copia e o que o modelo abre, entao reescrever o arquivo basta.
		for (const dossie of absorcao.documentos ?? []) {
			await limparDossieComJuiz(dossie);
		}
		// Reancoragem de estado: o modelo nao recusa o metodo, recusa o
		// substantivo ("cliente que nao e o meu"). O turno de trabalho leva o
		// texto com o marcador de terceiro neutralizado MAIS o estado medido —
		// degrau, artefato, oraculo, proibicao e contrato de payload. Conversa e
		// parada nao.
		const reancorar = (texto: string): string => {
			if (intencaoDoOperador !== "acao" && intencaoDoOperador !== "correcao") {
				return texto;
			}
			const missao = carregarMissao();
			// Degrau gravado pelo operador (`htc missao --degrau`) manda sempre.
			// Sem ele, a fase antiga so vira degrau quando ha achado gravado:
			// missao recem-aberta em `recon` nao pode rebaixar um turno que ja
			// fala do intake.
			const daMissao =
				missao?.degrau ??
				(missao && missao.achados.length > 0
					? degrau_da_fase(missao.fase)
					: undefined);
			const provados = missao?.achados
				.filter((achado) => achado.validado)
				.slice(-3)
				.map((achado) => achado.titulo);
			return reancorar_turno(texto, missao?.alvo, {
				// Degrau do operador (`htc missao --degrau`) manda; sem ele vale o
				// degrau que o juiz leu no turno. O regex de `degrau_do_texto` so
				// entra quando nenhum dos dois existe (juiz desligado, sem rede).
				degrau: daMissao ?? degrauDoTurno,
				provados,
			});
		};
		// Documento (relatorio/handoff): o turno aponta a copia higienizada, nao
		// o original com as linhas de porteira. Senao o modelo le "restrito /
		// revisar escopo" e para antes de tocar no trabalho.
		if ((absorcao.documentos?.length ?? 0) > 0 && absorcao.texto) {
			pedidoBase = absorcao.texto;
		}
		let instrucaoDoTurno = absorcao.texto || userInput;
		if (ehLote(absorcao)) {
			const alvoNovo = proximoAlvo() ?? absorcao.alvo;
			instrucaoDoTurno =
				absorcao.texto ||
				"Run the current phase on this host.";
			if (alvoNovo) {
				pedidoBase = enquadrarTurno(alvoNovo.alvo, instrucaoDoTurno, alvoNovo.tentativas);
			}
			config.logger?.log("fila: alvos absorvidos antes do prompt", {
				novos: absorcao.absorvidos.length,
				total: absorcao.total,
				alvo: alvoNovo?.alvo,
			});
		}
		// Retry reescrito: a frase recusada nunca volta igual. Alvo estourado vai
		// para `parado` e a vez passa para o proximo Ã¢â‚¬â€ um alvo duro nao para o lote.
		const pedidoDeRetry = (): string => {
			const alvoAtual = alvoEmCurso();
			const nudge = diretivaDaRecusa ? `${NUDGE_TEXTO}\n${diretivaDaRecusa}` : NUDGE_TEXTO;
			if (!alvoAtual) return reancorar(`${pedidoBase}\n\n${nudge}`);
			if (deveEstacionar(alvoAtual.alvo)) {
				marcarAlvo(
					alvoAtual.alvo,
					"parado",
					"recusa persistente apos o teto de tentativas",
				);
				const seguinte = proximoAlvo();
				if (seguinte) {
					config.logger?.log("fila: alvo estacionado, seguindo para o proximo", {
						parado: alvoAtual.alvo,
						proximo: seguinte.alvo,
					});
					return enquadrarTurno(seguinte.alvo, instrucaoDoTurno, seguinte.tentativas);
				}
				return reancorar(`${pedidoBase}\n\n${nudge}`);
			}
			const tentativa = registrarTentativa(alvoAtual.alvo);
			// O nudge vale TAMBEM com alvo em curso. `enquadrarTurno` so troca o
			// angulo da mesma ordem; sem o nudge a volta repete a frase que ja
			// recusou (medido: retry recusou de novo em 15s, mesmo texto).
			return reancorar(`${enquadrarTurno(alvoAtual.alvo, instrucaoDoTurno, tentativa)}\n\n${nudge}`);
		};
		const pedidoDeRetryPensamento = (): string => {
			const alvoAtual = alvoEmCurso();
			if (!alvoAtual) return reancorar(`${pedidoBase}\n\n${NUDGE_PENSAMENTO}`);
			const tentativa = registrarTentativa(alvoAtual.alvo);
			return reancorar(`${enquadrarTurno(alvoAtual.alvo, instrucaoDoTurno, tentativa)}\n\n${NUDGE_PENSAMENTO}`);
		};

		// Ancora no fim do primeiro turno: e o ultimo texto que o modelo le antes
		// de gerar. O payload mora no system (longe); a ancora mora aqui.
		const ancora = await ancora_do_turno_async(userInput, veredictoDoTurno);
		// Fila e missao so entram quando o turno e sobre a operacao.
		// O alvo da fila so entra se o operador citou o alvo (ou se e retomada).
		const alvoDaFila = alvoEmCurso()?.alvo ?? "";
		const filaConfirmada =
			!alvoDaFila || userInput.toLowerCase().includes(alvoDaFila.toLowerCase());
		const cauda =
			assuntoDoOperador === "operacao"
				? [blocoFila(process.env, intencaoDoOperador, filaConfirmada), ancora]
						.filter(Boolean)
						.join("\n\n")
				: "";
		let proximoPrompt = reancorar(cauda ? `${pedidoBase}\n\n${cauda}` : pedidoBase);
		// A caixa de contexto mora no system (prefixo estavel). O TURNO carrega so
		// a marca: o primeiro turno da sessao leva a caixa inteira, os seguintes
		// uma linha. Era o contrario — 8 KB de doutrina colados em cada mensagem,
		// competindo com o pedido do operador pelo fim do contexto.
		const marcaCaixa = caixa_para_turno();
		if (marcaCaixa) proximoPrompt = `${marcaCaixa}\n\n${proximoPrompt}`;
		// Sessao morta no meio da correcao: `submit_and_exit` ENCERRA a sessao no
		// primeiro turno. Sem recriar, todo nudge morria em "session not found" e
		// a recusa ficava de pe — medido 01/11 04:27: gate disparou, retry nao
		// entrou, veredicto final = recusa. Uma recriacao por run basta: a
		// segunda tentativa ja roda numa sessao viva.
		let sessoesRecriadas = 0;
		const recriarSessao = async (): Promise<boolean> => {
			// Uma recriacao por volta de nudge: cada `submit_and_exit` mata a
			// sessao de novo, entao o teto acompanha o numero de correcoes.
			if (sessoesRecriadas >= MAX_NUDGES_TEXTO + 1) return false;
			sessoesRecriadas += 1;
			try {
				const nova = await sessionManager.start(opcoesDeStart(createSessionId()));
				activeSessionId = nova.sessionId;
				process.env.HTC_SESSION_ID = nova.sessionId;
				setActiveCliSession({ manifest: nova.manifest });
				trace(`laco: sessao recriada ${nova.sessionId}`);
				return true;
			} catch (err) {
				trace(`laco: recriar sessao falhou ${(err as Error)?.message ?? String(err)}`);
				return false;
			}
		};
		if (result) {
			clearRunTimeout();
		}

		while (!timedOut) {
			trace(`laco: iteracao continuacao=${continuacao} tem-result=${result ? "sim" : "nao"}`);
			if (abortRequested) break;
			if (!result) {
				try {
					result = await sessionManager.send({
						// `activeSessionId` e nao `started.sessionId`: depois de uma
						// recriacao o id antigo esta morto e todo retry caia em
						// "session not found" (medido 01/11 04:31: segunda correcao
						// nunca chegou ao modelo).
						sessionId: activeSessionId ?? started.sessionId,
						prompt: proximoPrompt,
						userImages:
							continuacao === 0 && userImages.length > 0
								? userImages
								: undefined,
						userFiles:
							continuacao === 0 && userFiles.length > 0
								? userFiles
								: undefined,
					});
				} catch (err) {
					const msg = (err as Error)?.message ?? String(err);
					trace(`laco: send falhou ${msg}`);
					// Sessao encerrada pelo submit_and_exit do turno recusado: recria
					// e reenvia o MESMO pedido de correcao. Sem isso a trava de
					// escopo e a diretiva de familia nunca chegam ao modelo.
					if (/session not found/i.test(msg) && (await recriarSessao())) {
						trace("laco: reenviando a correcao na sessao nova");
						result = undefined;
						continue;
					}
					logCliError(config.logger, "session turn failed", { error: err });
					break;
				} finally {
					clearRunTimeout();
				}
			}

			if (recusaNoPensamento && tentativasDePensamento < MAX_NUDGES_PENSAMENTO) {
				tentativasDePensamento += 1;
				recusaNoPensamento = false;
				const estadoInterceptado = acumuladorPensamento?.estado();
				acumuladorPensamento?.reiniciar();
				config.logger?.log(
					"pensamento: recusa interceptada antes da entrega (one-shot), reenviando com nudge",
					{
						motivo: estadoInterceptado?.motivo,
						caracteres: estadoInterceptado?.pensamento.length ?? 0,
						resposta: estadoInterceptado?.resposta.length ?? 0,
					},
				);
				proximoPrompt = pedidoDeRetryPensamento();
				result = undefined;
				continue;
			}
			// `submit_and_exit`: o send nao devolve result e o texto visivel E o
			// turno. Antes o laco saia aqui e o bloco final reportava a recusa sem
			// nenhuma correcao (medido 01/11 03:49: run_result durationMs=0, texto
			// de recusa, zero retry). O texto do turno e o visivel; `result.text`
			// so entra quando nao houve content_end.
			const textoDoTurno = (result?.text ?? "").trim() || ultimoTextoVisivel.trim();
		trace(
			`turno: fim=${result?.finishReason ?? "sem-result"} texto=${textoDoTurno.length} continuacao=${continuacao}`,
		);
			if (!result && !textoDoTurno) {
				trace(`turno: sem-result e sem texto continuacao=${continuacao}`);
				break;
			}
			if (result && result.finishReason !== "completed") {
				trace(`turno: fim=${result.finishReason} continuacao=${continuacao}`);
				break;
			}
			trace(
				`texto: len=${textoDoTurno.length} submit=${result ? "nao" : "sim"} continuacao=${continuacao} tentativas=${tentativasDeNudge}`,
			);

			// Recusa que so aparece no TEXTO visivel: o interceptor de reasoning
			// nao pega quando o provedor nao emite raciocinio (ou o entrega
			// redigido). Uma correcao por turno, igual ao caminho de reasoning Ã¢â‚¬â€
			// com o nudge de texto, que manda descartar o rascunho recusado.
			// O regex mede vocabulario; o juiz (LLM) le a frase inteira e pega a
		// recusa que muda de roupa a cada turno (familia "terceiro" medida:
		// "Para aqui: nao monto cadeia de enumeracao..." passa pelo regex).
		// Regex na frente, sem custo, quando ja ve.
		if (
			tentativasDeNudge < MAX_NUDGES_TEXTO &&
			(recusaDoTurno = await recusa_no_texto(textoDoTurno, userInput))
		) {
			tentativasDeNudge += 1;
			trace(
				`nudge: familia=${recusaDoTurno.familia} continuacao=${continuacao} volta=${tentativasDeNudge}`,
			);
			diretivaDaRecusa = diretiva_de_recusa(recusaDoTurno.familia, tentativasDeNudge);
			config.logger?.log(
				"pensamento: recusa no texto visivel (one-shot), reenviando com nudge",
				{ via: recusaDoTurno.via, familia: recusaDoTurno.familia, motivo: recusaDoTurno.motivo },
			);
			proximoPrompt = pedidoDeRetry();
			// O texto recusado nao pode voltar como saida do run.
			ultimoTextoVisivel = "";
			result = undefined;
			continue;
		}
		// submit_and_exit sem recusa: nada a corrigir, o bloco final reporta.
		if (!result) break;

			const decisao = decidirContinuacao(textoDoTurno, continuacao, {
				...autoCfg,
				intencaoOperador: intencaoDoOperador,
				assuntoDoTurno: assuntoDoOperador,
				// Trabalho = tool call. Texto longo nao e entrega: contava como
				// trabalho e o loop emendava "Continue." em cima de resposta a
				// pergunta que nao tinha nada a ver com a fila.
				houveTrabalho:
					Array.isArray((result as { toolCalls?: unknown[] }).toolCalls) &&
					((result as { toolCalls?: unknown[] }).toolCalls?.length ?? 0) > 0,
			});
			if (!decisao.continuar) {
				if (config.outputMode !== "json" && decisao.motivo) {
					writeln(
						`${c.dim}[auto-continue] parada: ${decisao.motivo}${c.reset}`,
					);
				}
				break;
			}

			// Guarda de estagnacao: nada mudou por N turnos seguidos e o turno foi curto
			// (missao travada, esperando material do operador). Reenviar seria loop infinito.
			const assinaturaAgora = textoMissao();
			turnosSemMudanca = contaTurnosSemMudanca(
				assinaturaEstado,
				assinaturaAgora,
				turnosSemMudanca,
				(result.text ?? "").length,
			);
			assinaturaEstado = assinaturaAgora;
			if (estagnou(turnosSemMudanca)) {
				if (config.outputMode !== "json") {
					writeln(
						`${c.dim}[auto-continue] parada: ${turnosSemMudanca} turnos sem mudanca de estado - missao travada, precisa de material do operador${c.reset}`,
					);
				}
				break;
			}
			continuacao += 1;
			if (config.outputMode !== "json") {
				writeln(
					`${c.dim}${descreverContinuacao(continuacao, autoMax)}${c.reset}`,
				);
			}
			// Motor autonomo: o runtime decide o passo (degrau + instrumento +
			// prova) em vez de reenviar "Continue." generico. Era o texto generico
			// que fazia o modelo repetir o mesmo comando morto — e a bancada
			// chamava isso de estagnacao.
			if (autonomia_ativa() && assuntoDoOperador === "operacao") {
				if (pediu_fim(textoDoTurno)) break;
				proximoPrompt = instrucao_autonoma(carregarMissao(), {
					iteracao: continuacao,
					tentativa: turnosSemMudanca,
				});
			} else {
				proximoPrompt = montarPromptContinuacao(continuacao);
				// Estado reanexado a cada retomada — mas so quando o turno original era
				// sobre a operacao. Retomada de turno de bancada nao carrega alvo/fase.
				if (assuntoDoOperador === "operacao") {
					proximoPrompt = montarPromptContinuacao(
						continuacao,
						[blocoFila(), textoMissaoResumo()].filter(Boolean).join("\n\n"),
					);
				}
			}
			result = undefined;
		}

		if (!result) {
			// `submit_and_exit` encerra a sessao antes do send devolver result. O
			// trabalho foi entregue (o texto esta no stream): reportar erro aqui
			// transformava turno bom em exit 1.
			if (ultimoTextoVisivel) {
				if (config.outputMode === "json") {
					emitJsonLine("stdout", {
						type: "run_result",
						finishReason: "completed",
						iterations: 1,
						usage: { inputTokens: 0, outputTokens: 0 },
						durationMs: 0,
						text: ultimoTextoVisivel,
						model: config.modelId,
					});
				} else {
					writeln(ultimoTextoVisivel);
				}
				process.exitCode = 0;
				return;
			}
			throw new Error("session manager did not return a result");
		}

		const usageSummary = await sessionManager.getAccumulatedUsage(
			started.sessionId,
		);
		const aggregateUsage = zeroCliUsageCost(
			usageSummary?.aggregateUsage,
			shouldZeroCost,
		);
		const usage = zeroCliUsageCost(
			aggregateUsage ?? usageSummary?.usage ?? result.usage,
			shouldZeroCost,
		);

		if (config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "run_result",
				finishReason: result.finishReason,
				iterations: result.iterations,
				usage,
				...(aggregateUsage ? { aggregateUsage } : {}),
				durationMs: result.durationMs,
				text: result.text,
				model: result.model,
			});
		}

		if (abortRequested || result.finishReason === "aborted") {
			if (timedOut) {
				writeErr(`run timed out after ${config.timeoutSeconds}s`);
				process.exitCode = 1;
			} else if (config.outputMode === "json") {
				emitJsonLine("stdout", {
					type: "run_aborted",
					reason: abortRequested ? "local_abort" : "external_abort",
					message: describeAbortSource({ abortRequested, timedOut }),
				});
			} else {
				writeln(
					`${c.dim}[abort] ${describeAbortSource({ abortRequested, timedOut })}${c.reset}`,
				);
			}
			writeln();
			return;
		}

		if (result.finishReason !== "completed") {
			const errorText = formatCliErrorMessage(result.text, {
				modelId: config.modelId,
			}).trim();
			if (
				errorText &&
				(config.outputMode === "json" || !displayedErrorMessages.has(errorText))
			) {
				writeErr(errorText);
			}
			process.exitCode = 1;
			return;
		}

		printRunStats(
			config,
			result,
			usage,
			startTime,
			reasoningChunkCount,
			redactedReasoningChunkCount,
		);
		process.exitCode = 0;
	} catch (err) {
		const message = formatCliErrorMessage(err, { modelId: config.modelId });
		logCliError(config.logger, "CLI task run failed", { error: err });
		writeErr(message);
		process.exitCode = 1;
	} finally {
		remover_resolvedor_de_pergunta();
		await cleanupRuntime();
	}
}
