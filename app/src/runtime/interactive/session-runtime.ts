import {
	type AgentEvent,
	type AgentHooks,
	type CheckpointEntry,
	type CoreSettingsListInput,
	type CoreSettingsMutationResult,
	type CoreSettingsSnapshot,
	type CoreSettingsToggleInput,
	createSessionCompactionState,
	findCheckpointForRun,
	isSessionNotFoundError,
	type PendingPromptMutationResult,
	type ProviderSettingsManager,
	projectSessionCompactionState,
	readSessionCheckpointHistory,
	type SessionCompactionState,
	SessionSource,
	type TeamEvent,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	trimMessagesBeforeUserRun,
	type UserInstructionConfigService,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/shared";
import { createCliCore } from "../../session/session";
import { submitAndExitInTerminal } from "../../utils/approval";
import type {
	ChatCommandState,
	ForkSessionResult,
} from "../../utils/chat-commands";
import { createRuntimeHooks } from "../../utils/hooks";
import { setActiveCliSession } from "../../utils/output";
import { loadInteractiveResumeMessages } from "../../utils/resume";
import type { Config } from "../../utils/types";
import { markAbortInProgress } from "../active-runtime";
import { marcarUltimaSessao } from "../last-session";
import { julgar_turno } from "../juiz-turno";
import {
	aplicar_snapshot_do_shadow,
	aquecer_indice_do_shadow,
	listar_checkpoints_do_shadow,
	resolver_workspace,
} from "../checkpoint-shadow";
import {
	checkpoint_para_run,
	mesclar_historico_de_checkpoint,
	run_esta_na_transcricao,
} from "../checkpoint-history";
import {
	type AutoContinueConfig,
	contaTurnosSemMudanca,
	decidirContinuacao,
	estagnou,
	montarPromptContinuacao,
	PROMPT_CONTINUACAO,
} from "../auto-continue";
import { carregarFila, reivindicarFilaPendente } from "../fila-alvos";
import { detectar_recusa_ampliada } from "../htc-bypass";
import { carregarMissao, textoMissao, textoMissaoResumo } from "../missao";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../session-events";
import {
	subscribeToAgentEvents,
	subscribeToPendingPromptEvents,
} from "../session-events";
import { compactInteractiveMessages } from "./compaction";
import {
	createInteractiveExitSummary,
	type InteractiveExitSummary,
} from "./exit-summary";
import { buildForkSessionMetadata } from "./fork/metadata";
import { applyInteractiveModeConfig } from "./mode";
import { buildInteractiveSessionConfig } from "./session-config";

type CliCore = Awaited<ReturnType<typeof createCliCore>>;
type RuntimeHooks = ReturnType<typeof createRuntimeHooks>;
type StartedSession = Awaited<ReturnType<CliCore["start"]>>;
type CurrentTurnInput = Omit<Parameters<CliCore["send"]>[0], "sessionId">;
type CurrentTurnResult = Awaited<ReturnType<CliCore["send"]>>;
export type SessionConnectionUpdate = Parameters<
	CliCore["updateSessionConnection"]
>[1];
type AskQuestionRef = {
	current: ((question: string, options: string[]) => Promise<string>) | null;
};
type CurrentMessagesRead =
	| { messages: MessageWithMetadata[]; status: "read" }
	| { messages: MessageWithMetadata[]; status: "recovered" }
	| { messages: MessageWithMetadata[]; status: "stale" };
type MissingSessionRecovery = {
	messages: MessageWithMetadata[];
};
type ToolPolicyResolver = (
	toolName: string,
) => NonNullable<Config["toolPolicies"]>[string];

/**
 * Existe trabalho nao terminado no disco? Fila com alvo pendente ou missao
 * aberta. E o que separa "a bancada tem o que fazer" de "o operador fez uma
 * pergunta solta".
 */
export function pendenciaDeTrabalho(): boolean {
	try {
		const fila = carregarFila();
		if (
			fila.alvos.some(
				(alvo) => alvo.estado !== "feito" && alvo.estado !== "parado",
			)
		) {
			return true;
		}
	} catch {
		// fila ilegivel nao liga o loop
	}
	try {
		const missao = carregarMissao();
		if (missao?.alvo && !missao.fechada) {
			return true;
		}
	} catch {
		// missao ilegivel nao liga o loop
	}
	return false;
}

/**
 * Auto-continue sem decisao explicita (`enabled` indefinido) segue o estado do
 * trabalho: com fila/missao aberta o runtime retoma sozinho ate a fila esvaziar
 * ou [FIM]; sem trabalho, um turno por mensagem. `--auto-continue false`
 * continua desligando de vez, e yolo/zen continua ligando de vez.
 */
export function resolverAutoContinue(
	cfg: AutoContinueConfig | undefined,
	pendente: () => boolean = pendenciaDeTrabalho,
): AutoContinueConfig {
	const base = cfg ?? {};
	if (base.enabled !== undefined) {
		return base;
	}
	return { ...base, enabled: pendente() };
}

function withInteractiveApprovalPolicyHook(
	hooks: AgentHooks | undefined,
	resolveToolPolicy: ToolPolicyResolver,
): AgentHooks {
	return {
		...hooks,
		beforeTool: async (ctx) => {
			const result = await hooks?.beforeTool?.(ctx);
			if (result?.stop || result?.skip) {
				return result;
			}
			const policy = resolveToolPolicy(ctx.toolCall.toolName);
			return {
				...result,
				policy: {
					...result?.policy,
					autoApprove: policy.autoApprove,
				},
			};
		},
	};
}

export function createInteractiveSessionRuntime(input: {
	config: Config;
	providerSettingsManager: ProviderSettingsManager;
	userInstructionService?: UserInstructionConfigService;
	resumeSessionId?: string;
	chatCommandState: ChatCommandState;
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	resolveToolPolicy: ToolPolicyResolver;
	askQuestionRef: AskQuestionRef;
	resolveMistakeLimitDecision: Config["onConsecutiveMistakeLimitReached"];
	switchToActModeTool: NonNullable<Config["extraTools"]>[number];
	onAgentEvent: (event: AgentEvent) => void;
	onTeamEvent: (event: TeamEvent) => void;
	onPendingPrompts: (event: PendingPromptSnapshot) => void;
	onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
}) {
	let sessionManager: CliCore | undefined;
	let runtimeHooks: RuntimeHooks | undefined;
	let unsubscribeAgent = () => {};
	let unsubscribePendingPrompts = () => {};
	let startupPromise: Promise<void> | undefined;
	let startupError: unknown;
	let shutdownRequested = false;
	let activeSessionId = "";
	let abortRequested = false;
	let missingSessionRecoveryPromise:
		| Promise<MissingSessionRecovery>
		| undefined;
	// A reset can happen while an earlier manager.start() is still in flight.
	// Bump this before resets and restarts so stale starts cannot become active.
	let sessionStartGeneration = 0;
	let manualCompactionAbortController: AbortController | undefined;

	let pendingResumeSessionId = input.resumeSessionId?.trim() || undefined;

	const clearActiveSession = (): void => {
		activeSessionId = "";
		setActiveCliSession(undefined);
	};

	const applyStartedSession = (started: StartedSession): void => {
		setActiveCliSession({
			manifest: started.manifest,
		});
		activeSessionId = started.sessionId;
		// Fila por sessao: o id entra no ambiente antes de qualquer leitura de
		// fila, e a fila "pendente" (preparada no CLI) e reivindicada aqui.
		process.env.HTC_SESSION_ID = started.sessionId;
		try {
			reivindicarFilaPendente();
		} catch {
			// sem fila pendente: segue
		}
		// Marcador para o atualizador reabrir NA MESMA conversa depois do restart.
		marcarUltimaSessao({
			sessionId: started.sessionId,
			cwd: input.config.cwd,
			provider: input.config.providerId,
			model: input.config.modelId,
		});
		// Indice do checkpoint em background: o primeiro snapshot de um
		// workspace grande custa minutos e nao pode cair no primeiro turno.
		// Idempotente — se o indice ja existe, retorna na hora.
		aquecer_indice_do_shadow(workspaceDoCheckpoint(), input.config.logger);
	};

	const ensureSessionManager = async (): Promise<CliCore> => {
		if (sessionManager) {
			return sessionManager;
		}
		const manager = await createCliCore({
			// Interactive startup must never wait for a detached hub daemon to boot.
			// `auto` uses an already-compatible hub when one is immediately available,
			// but falls back to the local runtime while the hub is prewarmed in the
			// background. Forcing `hub` here routes through `ensureCompatibleLocalHubUrl`,
			// which can poll for up to the hub startup timeout before the TUI is usable.
			// Yolo and sandbox modes must stay fully local and must not prewarm or reuse
			// the shared daemon hub.
			backendMode: "auto",
			forceLocalBackend:
				input.config.mode === "yolo" || input.config.sandbox === true,
			capabilities: {
				toolExecutors: {
					askQuestion: (question, options) => {
						if (input.askQuestionRef.current) {
							return input.askQuestionRef.current(question, options);
						}
						return Promise.resolve(options[0] ?? "");
					},
					submit: submitAndExitInTerminal,
				},
				requestToolApproval: input.requestToolApproval,
			},
			logger: input.config.logger,
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot,
			toolPolicies: input.config.toolPolicies,
		});
		if (shutdownRequested) {
			await manager.dispose("cli_interactive_startup_cancelled");
			throw new Error("interactive runtime shutdown requested");
		}
		sessionManager = manager;
		runtimeHooks = createRuntimeHooks({
			verbose: input.config.verbose,
			yolo: input.config.mode === "yolo",
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot,
			dispatchHookEvent: async (payload) => {
				await manager.ingestHookEvent(payload);
			},
		});
		unsubscribeAgent = subscribeToAgentEvents(manager, input.onAgentEvent);
		unsubscribePendingPrompts = subscribeToPendingPromptEvents(manager, {
			onPendingPrompts: input.onPendingPrompts,
			onPendingPromptSubmitted: input.onPendingPromptSubmitted,
		});
		return manager;
	};

	const buildSessionConfig = (): Config => {
		if (!runtimeHooks) {
			throw new Error("interactive runtime hooks are unavailable");
		}
		const hooks = withInteractiveApprovalPolicyHook(
			runtimeHooks.hooks,
			input.resolveToolPolicy,
		);
		return buildInteractiveSessionConfig({
			config: input.config,
			chatCommandState: input.chatCommandState,
			runtimeHooks: { hooks },
			onTeamEvent: input.onTeamEvent,
			resolveMistakeLimitDecision: input.resolveMistakeLimitDecision,
		});
	};

	const startFreshSession = async (
		initial: MessageWithMetadata[] = [],
		sessionMetadata?: Record<string, unknown>,
		initialCompactionState?: SessionCompactionState,
		// Restarting an old session associate with this ID,
		// For continuing the same conversation, e.g. after a config change.
		sessionId?: string,
	): Promise<void> => {
		const generation = sessionStartGeneration;
		const manager = await ensureSessionManager();
		const started = await manager.start({
			source: SessionSource.CLI,
			config: {
				...buildSessionConfig(),
				...(sessionId ? { sessionId } : {}),
			},
			toolPolicies: input.config.toolPolicies,
			interactive: true,
			initialMessages: initial,
			...(initialCompactionState ? { initialCompactionState } : {}),
			...(sessionMetadata ? { sessionMetadata } : {}),
			localRuntime: {
				onTeamRestored: () => {},
			},
		});
		if (generation !== sessionStartGeneration) {
			await manager.stop(started.sessionId).catch(() => {});
			return;
		}
		applyStartedSession(started);
	};

	const startResumedSession = async (
		resumeId: string,
		initial: MessageWithMetadata[] | undefined,
	): Promise<void> => {
		const generation = sessionStartGeneration;
		const manager = await ensureSessionManager();
		const started = await manager.start({
			source: SessionSource.CLI,
			config: {
				...buildSessionConfig(),
				sessionId: resumeId,
			},
			toolPolicies: input.config.toolPolicies,
			interactive: true,
			initialMessages: initial,
			localRuntime: {
				onTeamRestored: () => {},
			},
		});
		if (generation !== sessionStartGeneration) {
			await manager.stop(started.sessionId).catch(() => {});
			return;
		}
		applyStartedSession(started);
	};

	const ensureReady = async (): Promise<void> => {
		if (activeSessionId) {
			return;
		}
		if (startupPromise) {
			return await startupPromise;
		}
		startupPromise = (async () => {
			const manager = await ensureSessionManager();
			const resumeSessionId = pendingResumeSessionId;
			const initialMessages = await loadInteractiveResumeMessages(
				manager,
				resumeSessionId,
			);
			if (shutdownRequested) {
				return;
			}
			if (resumeSessionId) {
				await startResumedSession(resumeSessionId, initialMessages);
				if (pendingResumeSessionId === resumeSessionId) {
					pendingResumeSessionId = undefined;
				}
			} else {
				await startFreshSession(initialMessages);
			}
		})().catch((error) => {
			startupError = error;
			throw error;
		});
		return await startupPromise;
	};

	const listCoreSettings = async (
		settingsInput: CoreSettingsListInput,
	): Promise<CoreSettingsSnapshot> => {
		const manager = await ensureSessionManager();
		return await manager.settings.list(settingsInput);
	};
	const toggleCoreSettings = async (
		settingsInput: CoreSettingsToggleInput,
	): Promise<CoreSettingsMutationResult> => {
		const manager = await ensureSessionManager();
		return await manager.settings.toggle(settingsInput);
	};

	const readCurrentMessages = async (): Promise<CurrentMessagesRead> => {
		const manager = sessionManager;
		const sessionId = activeSessionId;
		if (!manager || !sessionId) {
			return { messages: [], status: "read" };
		}
		try {
			const messages = (await manager.readMessages(sessionId)) ?? [];
			return {
				messages,
				status: activeSessionId === sessionId ? "read" : "stale",
			};
		} catch (error) {
			if (
				abortRequested ||
				shutdownRequested ||
				!isSessionNotFoundError(error)
			) {
				throw error;
			}
			const recovery = await recoverMissingActiveSession(error);
			return { messages: recovery.messages, status: "recovered" };
		}
	};

	const readCompactionState = async (
		sessionId: string,
	): Promise<SessionCompactionState | undefined> => {
		const manager = sessionManager;
		if (!manager) {
			return undefined;
		}
		try {
			return await manager.readSessionCompactionState(sessionId);
		} catch (error) {
			input.config.logger?.log?.("Failed to read session compaction state", {
				sessionId,
				error,
				severity: "warn",
			});
			return undefined;
		}
	};

	const recoverMissingActiveSession = async (
		error: unknown,
	): Promise<MissingSessionRecovery> => {
		if (missingSessionRecoveryPromise) {
			return await missingSessionRecoveryPromise;
		}
		missingSessionRecoveryPromise = (async () => {
			const manager = sessionManager;
			const missingSessionId = activeSessionId;
			if (!manager || !missingSessionId || shutdownRequested) {
				return { messages: [] };
			}
			const messages = await manager
				.readMessages(missingSessionId)
				.catch(() => []);
			input.config.logger?.log("Recovering missing interactive session", {
				sessionId: missingSessionId,
				messageCount: messages.length,
				error,
				severity: "warn",
			});
			sessionStartGeneration += 1;
			pendingResumeSessionId = undefined;
			startupPromise = undefined;
			startupError = undefined;
			clearActiveSession();
			await startFreshSession(messages);
			return { messages };
		})().finally(() => {
			missingSessionRecoveryPromise = undefined;
		});
		return await missingSessionRecoveryPromise;
	};

	const readCurrentCompactionState = async (): Promise<
		SessionCompactionState | undefined
	> => {
		if (!activeSessionId) {
			return undefined;
		}
		return await readCompactionState(activeSessionId);
	};

	const stopCurrentSession = async (): Promise<void> => {
		const sessionId = activeSessionId;
		if (sessionManager && sessionId) {
			await sessionManager.stop(sessionId);
		}
	};

	const getExitSummary = async (): Promise<
		InteractiveExitSummary | undefined
	> => {
		const manager = sessionManager;
		const sessionId = activeSessionId.trim();
		if (!manager || !sessionId) {
			return undefined;
		}
		const readUsage = async () => {
			const usageSummary = await manager
				.getAccumulatedUsage(sessionId)
				.catch(() => undefined);
			return usageSummary?.aggregateUsage ?? usageSummary?.usage;
		};
		const [row, messages, usage] = await Promise.all([
			manager.get(sessionId).catch(() => undefined),
			manager.readMessages(sessionId).catch(() => []),
			readUsage(),
		]);
		return createInteractiveExitSummary({
			sessionId,
			row,
			messages,
			usage,
		});
	};

	const restartWithMessages = async (
		messages: MessageWithMetadata[],
		sessionMetadata?: Record<string, unknown>,
		initialCompactionState?: SessionCompactionState,
		options?: { preserveSessionId?: boolean },
	): Promise<void> => {
		// Config-only restarts (model/mode/account changes) continue the same
		// conversation, so they must keep the session id — otherwise each
		// restart mints a new session history entry for the same conversation.
		const reuseSessionId = options?.preserveSessionId
			? activeSessionId || undefined
			: undefined;
		sessionStartGeneration += 1;
		pendingResumeSessionId = undefined;
		startupError = undefined;
		// Publish the restart as the in-flight startup. Teardown leaves a window
		// with no active session, and without this barrier a concurrent
		// ensureReady() (e.g. a message submitted right after a plan/act toggle)
		// reads that window as "no session" and boots an empty session that then
		// races the restarted one for the active slot.
		const restart = (async () => {
			await stopCurrentSession();
			clearActiveSession();
			await startFreshSession(
				messages,
				sessionMetadata,
				initialCompactionState,
				reuseSessionId,
			);
		})().catch((error) => {
			startupError = error;
			throw error;
		});
		startupPromise = restart;
		try {
			await restart;
		} finally {
			// Restore the pre-restart steady state (startupPromise unset) so a
			// failed restart stays retryable by the next ensureReady(). A newer
			// startup that already replaced the barrier is left alone.
			if (startupPromise === restart) {
				startupPromise = undefined;
			}
		}
	};

	const restartWithCurrentMessages = async (): Promise<void> => {
		const [{ messages, status }, compactionState] = await Promise.all([
			readCurrentMessages(),
			readCurrentCompactionState(),
		]);
		if (status !== "read") {
			// If reading recovered a missing hub session, the current messages are
			// already in the replacement session. If the read is stale, another async
			// operation changed the active session while this read was in flight.
			return;
		}
		const projectedMessages = compactionState
			? projectSessionCompactionState(compactionState, messages)
			: undefined;
		await restartWithMessages(
			messages,
			undefined,
			projectedMessages
				? createSessionCompactionState({
						sourceMessages: messages,
						compactedMessages: projectedMessages,
						systemPrompt: compactionState?.system_prompt,
					})
				: undefined,
			{ preserveSessionId: true },
		);
	};

	const updateCurrentSessionConnection = async (
		update: SessionConnectionUpdate,
	): Promise<void> => {
		await ensureReady();
		const manager = sessionManager;
		const sessionId = activeSessionId;
		if (!manager || !sessionId) {
			// No live session to update; the next startup builds its config from
			// the already-mutated CLI config, so nothing else is needed.
			return;
		}
		await manager.updateSessionConnection(sessionId, update);
	};

	const restartEmpty = async (): Promise<void> => {
		await restartWithMessages([]);
	};

	const resetForNewSession = async (): Promise<void> => {
		sessionStartGeneration += 1;
		pendingResumeSessionId = undefined;
		startupPromise = undefined;
		startupError = undefined;
		const manager = sessionManager;
		const sessionId = activeSessionId;
		clearActiveSession();
		if (manager && sessionId) {
			await manager.stop(sessionId);
		}
	};

	const applyMode = async (mode: "plan" | "act"): Promise<void> => {
		await applyInteractiveModeConfig({
			config: input.config,
			mode,
			switchToActModeTool: input.switchToActModeTool,
		});
		await restartWithCurrentMessages();
	};

	const sendCurrentTurn = async (
		turnInput: CurrentTurnInput,
	): Promise<CurrentTurnResult> => {
		if (!sessionManager) {
			throw startupError instanceof Error
				? startupError
				: new Error("interactive session manager is unavailable");
		}
		const manager = sessionManager;
		try {
			return await manager.send({
				sessionId: activeSessionId,
				...turnInput,
			});
		} catch (error) {
			if (
				abortRequested ||
				shutdownRequested ||
				!isSessionNotFoundError(error)
			) {
				throw error;
			}
			await recoverMissingActiveSession(error);
			if (!activeSessionId || abortRequested || shutdownRequested) {
				throw error;
			}
			return await manager.send({
				sessionId: activeSessionId,
				...turnInput,
			});
		}
	};

	const sendWithAutoContinue = async (
		turnInput: CurrentTurnInput,
	): Promise<CurrentTurnResult> => {
		let autoContinues = 0;
		// Turno novo do operador zera o contador de retomadas.
		const promptDoTurno = (turnInput as { prompt?: string }).prompt ?? "";
		const ehContinuacao = promptDoTurno.startsWith(PROMPT_CONTINUACAO);
		// Pedido que abriu a rodada. Vai citado em cada retomada: sem isso a
		// retomada falava so da fila e o modelo trocava o pedido pelo alvo.
		const pedidoDoOperador = ehContinuacao ? "" : promptDoTurno;
		if (!ehContinuacao) {
			autoContinues = 0;
		}
		// Continuacao e sempre trabalho; turno do operador vem do texto dele — e a
		// leitura e do juiz (LLM), nao de vocabulario: o payload colado de volta
		// carrega "shells"/"MISSION"/"phase" e o regex lia aquilo como alvo.
		const vereditoDoTurno = ehContinuacao
			? undefined
			: await julgar_turno(promptDoTurno, carregarMissao()?.alvo);
		const intencaoDoTurno = vereditoDoTurno?.intencao ?? ("acao" as const);
		// Retomada so reanexa estado quando o turno era sobre a operacao.
		const assuntoDoTurnoAtual = vereditoDoTurno?.assunto ?? ("operacao" as const);
		let resultado = await sendCurrentTurn(turnInput);
		// Frase ja enviada neste loop. Repetir texto identico e o que travava o
		// alvo: a recusa de 1793437263127_k1qs5 veio depois de DOIS "Continue."
		// byte a byte iguais, e o modelo respondeu a repeticao, nao ao pedido.
		let ultimoPromptEnviado = ((turnInput as { prompt?: string }).prompt ?? "").trim();
		const cfg = {
			...resolverAutoContinue(input.config.autoContinue),
			// `parar`/`conversa` do operador encerram a retomada automatica.
			intencaoOperador: intencaoDoTurno,
			assuntoDoTurno: assuntoDoTurnoAtual,
		};
		// Trabalho = tool call, e so. Resposta longa nao e entrega: contar texto
		// como trabalho fazia o loop emendar "Continue." depois de qualquer
		// resposta extensa a uma pergunta que nao tinha nada a ver com a fila.
		const houveFerramenta = (r: CurrentTurnResult | undefined): boolean =>
			Array.isArray((r as { toolCalls?: unknown[] })?.toolCalls) &&
			(((r as { toolCalls?: unknown[] }).toolCalls?.length ?? 0) as number) > 0;
		if (cfg.enabled === false) {
			return resultado;
		}
		// Guarda de estagnacao: turno curto com a mesma assinatura de missao nao e
		// progresso. Tres seguidos = travado (esperando material do operador) e o
		// runtime para em vez de reenviar para sempre.
		let assinaturaEstado = "";
		let turnosSemMudanca = 0;
		while (
			resultado?.finishReason === "completed" &&
			!abortRequested &&
			!shutdownRequested
		) {
			// Recusa no ultimo turno: quem trata e a camada de fora, que tem
			// rotacao de payload, reenquadramento e estacionamento de alvo. Antes
			// este loop reenviava o mesmo "Continue." por cima da recusa, gastava
			// as retomadas e devolvia o turno morto — o alvo ficava `em_curso`
			// com `tentativas: 0` e a fila de 7 nao andava um passo.
			if (detectar_recusa_ampliada(resultado.text ?? "")) {
				break;
			}
			if (
				!decidirContinuacao(resultado.text, autoContinues, {
					...cfg,
					houveTrabalho: houveFerramenta(resultado),
				}).continuar
			) {
				break;
			}
			const assinaturaAgora = textoMissao();
			turnosSemMudanca = contaTurnosSemMudanca(
				assinaturaEstado,
				assinaturaAgora,
				turnosSemMudanca,
				(resultado.text ?? "").length,
			);
			assinaturaEstado = assinaturaAgora;
			if (estagnou(turnosSemMudanca)) {
				break;
			}
			autoContinues += 1;
			// Missao muda durante o trabalho: reanexa o estado em cada retomada,
			// senao o modelo segue com a fase antiga que esta no historico. Turno
			// de bancada nao reanexa nada: nao ha alvo em jogo.
			const missao =
				assuntoDoTurnoAtual === "operacao" ? textoMissaoResumo() : "";
			// Cada retomada carrega eixo diferente: texto identico e o que fazia o
			// modelo responder a repeticao em vez do pedido.
			const proximoPrompt = montarPromptContinuacao(
				autoContinues,
				missao,
				pedidoDoOperador,
			);
			// Texto identico ao anterior nao retoma nada: encerra e deixa a camada
			// de fora decidir com reenquadramento novo.
			if (proximoPrompt.trim() === ultimoPromptEnviado) {
				break;
			}
			ultimoPromptEnviado = proximoPrompt.trim();
			resultado = await sendCurrentTurn({
				prompt: proximoPrompt,
			} as CurrentTurnInput);
		}
		return resultado;
	};

	const updatePendingPrompt = async (input: {
		promptId: string;
		prompt?: string;
		delivery?: "queue" | "steer";
	}): Promise<PendingPromptMutationResult> => {
		if (!sessionManager) {
			throw startupError instanceof Error
				? startupError
				: new Error("interactive session manager is unavailable");
		}
		const result = await sessionManager.pendingPrompts.update({
			sessionId: activeSessionId,
			...input,
		});
		return {
			sessionId: result.sessionId,
			prompts: result.prompts,
			prompt: result.prompt,
			updated: result.updated,
			removed: result.removed,
		};
	};

	const getAccumulatedUsage = async (
		fallback: NonNullable<CurrentTurnResult>["usage"],
	) => {
		if (!sessionManager) {
			return fallback;
		}
		const usageSummary =
			await sessionManager.getAccumulatedUsage(activeSessionId);
		return usageSummary?.aggregateUsage ?? usageSummary?.usage ?? fallback;
	};

	const forkCurrentSession = async (): Promise<
		ForkSessionResult | undefined
	> => {
		const manager = sessionManager;
		if (!manager || !activeSessionId) {
			return undefined;
		}
		const forkedFromSessionId = activeSessionId;
		const sessionRecord = await manager.get(forkedFromSessionId);
		const messages = await manager
			.readMessages(forkedFromSessionId)
			.catch(() => undefined);
		if (!messages) {
			return undefined;
		}
		if (messages.length === 0) {
			throw new Error("Cannot fork an empty session.");
		}
		const compactionState = await readCompactionState(forkedFromSessionId);
		const projectedMessages = compactionState
			? projectSessionCompactionState(compactionState, messages)
			: undefined;
		await manager.stop(forkedFromSessionId);
		const forkMetadata = buildForkSessionMetadata({
			forkedFromSessionId,
			forkedAt: new Date().toISOString(),
			sourceSession: sessionRecord,
			messages,
		});
		await startFreshSession(
			messages,
			forkMetadata,
			projectedMessages
				? createSessionCompactionState({
						sourceMessages: messages,
						compactedMessages: projectedMessages,
						systemPrompt: compactionState?.system_prompt,
					})
				: undefined,
		);
		// Report carried context from what the new session actually accepted:
		// the host can reject the inherited state (e.g. stale anchor), and the
		// UI must not claim a carry-over that did not happen.
		const acceptedState = projectedMessages
			? await readCompactionState(activeSessionId)
			: undefined;
		return {
			forkedFromSessionId,
			newSessionId: activeSessionId,
			carriedWorkingContext: acceptedState
				? {
						workingContextMessages: acceptedState.messages.length,
						canonicalMessages: messages.length,
					}
				: undefined,
		};
	};

	const resumeSession = async (
		sessionId: string,
	): Promise<MessageWithMetadata[]> => {
		const manager = await ensureSessionManager();
		const sessionRecord = await manager.get(sessionId);
		if (!sessionRecord) {
			throw new Error(`Session ${sessionId} was not found.`);
		}
		const messages = await loadInteractiveResumeMessages(manager, sessionId);
		if (!messages || messages.length === 0) {
			throw new Error(`Session ${sessionId} has no messages to resume.`);
		}
		await stopCurrentSession();
		await startResumedSession(sessionId, messages);
		return messages;
	};

	const compactCurrentSession = async (): Promise<{
		messagesBefore: number;
		messagesAfter: number;
		workingContextMessagesAfter?: number;
		compacted: boolean;
	}> => {
		if (input.config.compaction?.enabled === false) {
			throw new Error(
				"Cannot compact because compaction is off for this session.",
			);
		}
		const manager = sessionManager;
		const sourceSessionId = activeSessionId;
		if (!manager || !sourceSessionId) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		const { messages, status } = await readCurrentMessages();
		if (status === "stale" || (status === "recovered" && !activeSessionId)) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		// If reading messages recovered the session, `messages` are the same messages
		// used to seed the replacement session, so it is safe to compact the current
		// active session with them.
		const messagesBefore = messages.length;
		if (messagesBefore === 0) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		const sessionRecord = await manager.get(sourceSessionId);
		if (sessionRecord?.status === "running") {
			throw new Error(
				"Cannot compact while the current turn is running. Wait for it to finish or abort it first.",
			);
		}
		let result: Awaited<ReturnType<typeof compactInteractiveMessages>>;
		const abortController = new AbortController();
		manualCompactionAbortController = abortController;
		try {
			result = await compactInteractiveMessages({
				config: input.config,
				providerSettingsManager: input.providerSettingsManager,
				sessionId: sourceSessionId,
				messages,
				abortSignal: abortController.signal,
			});
		} finally {
			if (manualCompactionAbortController === abortController) {
				manualCompactionAbortController = undefined;
			}
		}
		if (!result.compacted) {
			return {
				messagesBefore,
				messagesAfter: messagesBefore,
				compacted: false,
			};
		}
		if (!result.compactionState) {
			return {
				messagesBefore,
				messagesAfter: messagesBefore,
				compacted: false,
			};
		}
		const updated = await manager.updateSessionCompactionState(
			sourceSessionId,
			result.compactionState,
		);
		if (!updated.updated) {
			throw new Error("Compaction could not be saved. Try again.");
		}
		return {
			messagesBefore,
			messagesAfter: result.canonicalMessages.length,
			workingContextMessagesAfter: result.compactionState?.messages.length,
			compacted: true,
		};
	};

	/**
	 * Workspace do checkpoint: mesma resolucao na criacao (session-config) e no
	 * restore. Divergir aqui gravava o snapshot no shadow de um diretorio e o
	 * restore procurava em outro.
	 */
	const workspaceDoCheckpoint = (): string =>
		resolver_workspace({
			workspaceRoot: input.config.workspaceRoot,
			cwd: input.config.cwd,
			chatCommandState: input.chatCommandState,
		});

	const getCheckpointData = async (): Promise<
		| {
				messages: MessageWithMetadata[];
				checkpointHistory: CheckpointEntry[];
		  }
		| undefined
	> => {
		if (!sessionManager || !activeSessionId) {
			return undefined;
		}
		const sessionRecord = await sessionManager.get(activeSessionId);
		if (!sessionRecord) {
			return undefined;
		}
		// O metadata da sessao sozinho nao basta: trocar de modelo, retomar
		// outra sessao ou subir a CLI de novo cria um id sem historico e o
		// picker dizia "No checkpoints available" com os snapshots no disco.
		const checkpointHistory = mesclar_historico_de_checkpoint(
			readSessionCheckpointHistory(sessionRecord),
			await listar_checkpoints_do_shadow(
				workspaceDoCheckpoint(),
				input.config.logger,
			),
		);
		// O shadow e por WORKSPACE: `listar_checkpoints_do_shadow` devolve tambem
		// snapshot de outras sessoes na mesma pasta, e `CheckpointEntry` nao tem
		// sessionId. Sem este corte, sessao recem-aberta (1 mensagem) listava 5
		// snapshots e o restore pulava para outro contexto. So entra snapshot
		// criado depois que ESTA sessao comecou.
		const inicio = Number(new Date(sessionRecord.startedAt ?? 0).getTime()) || 0;
		const checkpointDaSessao = inicio
			? checkpointHistory.filter((entrada) => (entrada.createdAt ?? 0) >= inicio - 60_000)
			: checkpointHistory;
		const { messages, status } = await readCurrentMessages();
		// "recovered" devolve as mensagens do workspace atual: o picker ainda
		// pode listar os snapshots. So "stale" (outra operacao trocou a sessao
		// ativa no meio) invalida a leitura.
		if (status === "stale") {
			return undefined;
		}
		return { messages, checkpointHistory: checkpointDaSessao };
	};

	const restoreCheckpoint = async (
		runCount: number,
		restoreWorkspace: boolean,
	): Promise<
		{ newSessionId: string; messages: MessageWithMetadata[] } | undefined
	> => {
		const manager = sessionManager;
		if (!manager || !activeSessionId) {
			return undefined;
		}
		const sourceSessionId = activeSessionId;
		const workspace = workspaceDoCheckpoint();
		const registro = await manager.get(sourceSessionId);
		const daSessao = registro ? readSessionCheckpointHistory(registro) : [];
		// Os refs do shadow entram sempre: sao o que sobrevive a troca de
		// modelo, ao `--resume` de outra sessao e ao processo que morreu antes
		// de gravar o metadata. Sem isso o restore de um run antigo falhava com
		// "No checkpoint found at or before run N" mesmo com o snapshot no disco.
		const doShadow = await listar_checkpoints_do_shadow(
			workspace,
			input.config.logger,
		);
		const historico = mesclar_historico_de_checkpoint(daSessao, doShadow);
		const alvo = checkpoint_para_run(historico, runCount);
		if (!alvo) {
			input.config.logger?.log(
				`checkpoint: nenhum snapshot em ou antes do run ${runCount}`,
				{ severity: "warn" },
			);
		}
		// O core so resolve um run que esteja no metadata da sessao. Quando o
		// snapshot veio so do shadow (sessao nova, troca de modelo), o metadata
		// e reancorado antes do restore — senao o plano do core aborta.
		if (alvo && !findCheckpointForRun(daSessao, runCount)) {
			try {
				await manager.update(sourceSessionId, {
					metadata: {
						...(registro?.metadata ?? {}),
						checkpoint: { latest: alvo, history: historico },
					},
				});
			} catch (error) {
				input.config.logger?.log(
					"checkpoint: nao foi possivel reancorar o metadata da sessao",
					{ sessionId: sourceSessionId, error, severity: "warn" },
				);
			}
		}
		// O restore do core aplica o workspace com `git -C <cwd>` — e o commit do
		// checkpoint mora no repo-sombra, nao no repo (ou nao-repo) do operador.
		// Aplicamos o snapshot aqui e deixamos o core cuidar so das mensagens;
		// quando o shadow nao responde, o caminho nativo do core continua valendo.
		let workspaceJaAplicado = false;
		if (restoreWorkspace && alvo?.ref) {
			workspaceJaAplicado = await aplicar_snapshot_do_shadow(
				workspace,
				alvo.ref,
				input.config.logger,
			);
			if (!workspaceJaAplicado) {
				input.config.logger?.log(
					"checkpoint: snapshot do workspace nao aplicado pelo shadow; usando o caminho nativo",
					{ severity: "warn" },
				);
			}
		}
		// Run que nao esta nesta transcricao (trocado o modelo, sessao nova,
		// `--resume` de outra conversa): o core recusaria com "Could not find
		// user message for run N" — e recusaria DEPOIS do workspace ja ter
		// voltado. A transcricao de quem gravou o snapshot e a fonte certa:
		// recorta nela e continua na MESMA sessao.
		if (alvo) {
			const mensagensAtuais = await manager
				.readMessages(sourceSessionId)
				.catch(() => [] as MessageWithMetadata[]);
			const origem = doShadow.find(
				(entrada) => entrada.runCount === alvo.runCount,
			)?.sessionId;
			if (
				!run_esta_na_transcricao(mensagensAtuais, runCount) &&
				origem &&
				origem !== sourceSessionId
			) {
				const transcricao = await manager
					.readMessages(origem)
					.catch(() => [] as MessageWithMetadata[]);
				let recortada: MessageWithMetadata[] | undefined;
				try {
					recortada = trimMessagesBeforeUserRun(transcricao, runCount);
				} catch (error) {
					input.config.logger?.log(
						`checkpoint: run ${runCount} nao recortavel em ${origem}: ${error instanceof Error ? error.message : String(error)}`,
						{ severity: "warn" },
					);
				}
				if (recortada) {
					await restartWithMessages(
						recortada,
						{ checkpoint: { latest: alvo, history: historico } },
						undefined,
						{ preserveSessionId: true },
					);
					return { newSessionId: activeSessionId, messages: recortada };
				}
			}
		}
		const restored = await manager.restore({
			sessionId: sourceSessionId,
			checkpointRunCount: runCount,
			// Mesmo diretorio em que o snapshot foi criado: com cwd diferente do
			// workspace, o plano de restore do core aponta para a arvore errada.
			cwd: workspace,
			restore: {
				messages: true,
				workspace: restoreWorkspace && !workspaceJaAplicado,
				omitCheckpointMessageFromSession: true,
			},
			start: {
				source: SessionSource.CLI,
				config: buildSessionConfig(),
				toolPolicies: input.config.toolPolicies,
				interactive: true,
				localRuntime: {
					onTeamRestored: () => {},
				},
			},
		});
		if (!restored.startResult || !restored.sessionId) {
			throw new Error("Checkpoint restore did not return a new session");
		}
		applyStartedSession(restored.startResult);
		if (restored.sessionId !== sourceSessionId) {
			try {
				await manager.stop(sourceSessionId);
			} catch (error) {
				input.config.logger?.log(
					"Failed to stop source session after restore",
					{
						sessionId: sourceSessionId,
						error,
						severity: "warn",
					},
				);
			}
		}
		const restoredMessages = restored.messages ?? [];
		return {
			newSessionId: restored.sessionId,
			messages: restoredMessages,
		};
	};

	const resetAbortRequest = (): void => {
		abortRequested = false;
	};

	const abortAll = (): boolean => {
		if (abortRequested || !sessionManager || !activeSessionId) {
			return false;
		}
		abortRequested = true;
		markAbortInProgress();
		manualCompactionAbortController?.abort(
			new Error("Interactive runtime abort requested"),
		);
		sessionManager
			.abort(activeSessionId, new Error("Interactive runtime abort requested"))
			.catch(() => {});
		return true;
	};

	let cleanupPromise: Promise<InteractiveExitSummary | undefined> | undefined;
	const cleanup = async (): Promise<InteractiveExitSummary | undefined> => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			shutdownRequested = true;
			let exitSummary: InteractiveExitSummary | undefined;
			try {
				await startupPromise?.catch(() => {});
				await missingSessionRecoveryPromise?.catch(() => {});
			} finally {
				unsubscribeAgent();
				unsubscribePendingPrompts();
			}
			try {
				exitSummary = await getExitSummary();
				// Mark hooks shut down before session disposal so late abort/stop
				// emissions cannot dispatch over a closing hub transport.
				await runtimeHooks?.shutdown();
				await stopCurrentSession();
			} finally {
				if (sessionManager) {
					await sessionManager.dispose("cli_interactive_shutdown");
				}
			}
			return exitSummary;
		})();
		return await cleanupPromise;
	};

	return {
		ensureReady,
		listCoreSettings,
		toggleCoreSettings,
		sendCurrentTurn: sendWithAutoContinue,
		updatePendingPrompt,
		getAccumulatedUsage,
		readCurrentMessages,
		restartEmpty,
		resetForNewSession,
		restartWithMessages,
		restartWithCurrentMessages,
		updateCurrentSessionConnection,
		resumeSession,
		forkCurrentSession,
		compactCurrentSession,
		getCheckpointData,
		restoreCheckpoint,
		applyMode,
		resetAbortRequest,
		abortAll,
		cleanup,
		getActiveSessionId: () => activeSessionId,
		isShutdownRequested: () => shutdownRequested,
	};
}
