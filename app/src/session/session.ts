import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AgentConfig,
	BasicLogger,
	RuntimeCapabilities,
	RuntimeHostMode,
	SessionHistoryRecord,
	SessionRecord,
} from "@cline/core";
import {
	ClineCore,
	listSessionHistoryFromBackend,
	resolveSessionBackend,
} from "@cline/core";
import {
	createCliMessagesArtifactUploader,
	prepareCliEnterpriseIntegration,
} from "../utils/enterprise";
import { getCliFeatureFlagsService } from "../utils/feature-flags";
import { resolveWorkspaceRoot } from "../utils/helpers";
import { HISTORY_LIST_LIMIT } from "../utils/history-limit";
import { getCliTelemetryService } from "../utils/telemetry";
import type { ConversationHistory } from "./export";

function toSessionRecordLike(
	row: SessionRecord | undefined,
): unknown | undefined {
	return row;
}

export async function createCliCore(options?: {
	capabilities?: RuntimeCapabilities;
	toolPolicies?: AgentConfig["toolPolicies"];
	logger?: BasicLogger;
	backendMode?: RuntimeHostMode;
	forceLocalBackend?: boolean;
	cwd?: string;
	workspaceRoot?: string;
}): Promise<ClineCore> {
	const explicitBackendMode = options?.forceLocalBackend
		? "local"
		: options?.backendMode;
	const cwd = options?.cwd?.trim() || process.cwd();
	const workspaceRoot =
		options?.workspaceRoot?.trim() || resolveWorkspaceRoot(cwd);
	const telemetry = getCliTelemetryService(options?.logger);
	const featureFlags = getCliFeatureFlagsService({
		logger: options?.logger,
		telemetry,
	});
	const core = await ClineCore.create({
		...(explicitBackendMode ? { backendMode: explicitBackendMode } : {}),
		...(options?.forceLocalBackend !== true
			? {
					hub: {
						cwd,
						workspaceRoot,
						clientType: "cli",
						displayName: "Cline CLI",
					},
				}
			: {}),
		capabilities: options?.capabilities,
		telemetry,
		featureFlags,
		logger: options?.logger,
		toolPolicies: options?.toolPolicies,
		messagesArtifactUploader: createCliMessagesArtifactUploader(),
		prepare: prepareCliEnterpriseIntegration,
	});
	try {
		await core.featureFlags.poll();
	} catch (error) {
		options?.logger?.error?.("Error polling CLI feature flags", { error });
	}
	options?.logger?.log("CLI core runtime routing selected", {
		backendMode: explicitBackendMode ?? "env-managed",
		rpcAddress: core.runtimeAddress,
		forceLocalBackend: options?.forceLocalBackend === true,
	});
	return core;
}

async function withCliCore<T>(
	run: (core: ClineCore) => Promise<T>,
	options?: {
		forceLocalBackend?: boolean;
		logger?: BasicLogger;
		cwd?: string;
		workspaceRoot?: string;
	},
): Promise<T> {
	const core = await createCliCore({
		forceLocalBackend: options?.forceLocalBackend,
		logger: options?.logger,
		cwd: options?.cwd,
		workspaceRoot: options?.workspaceRoot,
	});
	try {
		return await run(core);
	} finally {
		await core.dispose("cli_session_helper_dispose");
	}
}

function normalizarCaminho(caminho: string): string {
	return caminho.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/**
 * Sessao que nao e do operador: sub-sessao de time, cwd de sistema, ou casca
 * criada por auto-continue/retry (sem texto dele). Aparecer no /history e ruido
 * — foi o "monte de sessao aleatoria / snapshot" que poluia a lista.
 */
function ehRuidoDeHistorico(registro: SessionHistoryRecord): boolean {
	const id = String(registro.sessionId ?? "");
	if (id.includes("__teamtask__") || id.includes("__subagent__")) return true;
	const bruto =
		(registro as { cwd?: string; workspaceRoot?: string }).cwd ??
		(registro as { workspaceRoot?: string }).workspaceRoot ??
		"";
	const cwd = normalizarCaminho(String(bruto));
	if (cwd.startsWith("c:\\windows") || cwd.startsWith("c:\\program files")) return true;
	return false;
}

export async function listSessions(
	limit = HISTORY_LIST_LIMIT,
	options?: { workspaceRoot?: string; hydrate?: boolean },
): Promise<SessionHistoryRecord[]> {
	const backend = await resolveSessionBackend({
		telemetry: getCliTelemetryService(),
	});
	const todos = await listSessionHistoryFromBackend(backend, {
		limit,
		includeManifestFallback: true,
		hydrate: options?.hydrate ?? false,
		includeSubagents: false,
	});
	// Filtro de ruido: sub-sessao de time, cwd de sistema e casca de continuacao
	// nao sao historico do operador. `HTC_HISTORY_TUDO=1` desliga o filtro.
	const registros =
		process.env.HTC_HISTORY_TUDO?.trim() === "1"
			? todos
			: todos.filter((registro) => !ehRuidoDeHistorico(registro));
	// Historico e por pasta, como no Claude Code: sem workspaceRoot, lista tudo.
	const raiz = options?.workspaceRoot;
	if (!raiz) {
		return registros;
	}
	const alvo = normalizarCaminho(raiz);
	return registros.filter((registro) => {
		const bruto =
			(registro as { cwd?: string; workspaceRoot?: string; workspace_root?: string })
				.cwd ??
			(registro as { workspaceRoot?: string }).workspaceRoot ??
			(registro as { workspace_root?: string }).workspace_root;
		return typeof bruto === "string" ? normalizarCaminho(bruto) === alvo : false;
	});
}

export async function deleteSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	const alvo = sessionId.trim();
	if (!alvo) return { deleted: false };
	const resultado = await withCliCore(
		async (core) => ({
			deleted: await core.delete(alvo),
		}),
		{ forceLocalBackend: true },
	);
	if (resultado.deleted) return resultado;
	// Sessao que existe so como manifesto (o fallback do historico lista diretorio
	// que o core nao indexa) respondia "not found" e o /history nao conseguia
	// apagar nada. Aqui o diretorio sai.
	try {
		const raiz = process.env.CLINE_DIR?.trim() || join(homedir(), ".htc");
		const dir = join(raiz, "data", "sessions", alvo);
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
			return { deleted: true };
		}
	} catch {
		// sem permissao: devolve o que o core disse
	}
	return resultado;
}

export async function updateSession(
	sessionId: string,
	updates: {
		prompt?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	},
): Promise<{ updated: boolean }> {
	return await withCliCore(
		async (core) => await core.update(sessionId, updates),
		{ forceLocalBackend: true },
	);
}

export async function getSessionRow(
	sessionId: string,
): Promise<SessionRecord | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	return await withCliCore(
		async (core) => (await core.get(target)) ?? undefined,
		{ forceLocalBackend: true },
	);
}

export async function getLatestSessionRow(): Promise<unknown | undefined> {
	return await withCliCore(
		async (core) => {
			const rows = await core.list(1, { hydrate: false });
			return toSessionRecordLike(rows[0]);
		},
		{ forceLocalBackend: true },
	);
}

export async function handleSessionHookEvent(
	payload: Parameters<ClineCore["ingestHookEvent"]>[0],
): Promise<void> {
	await withCliCore(
		async (core) => {
			await core.ingestHookEvent(payload);
		},
		{ forceLocalBackend: true },
	);
}

export async function readSessionMessagesArtifact(
	sessionId: string,
): Promise<ConversationHistory | undefined> {
	const target = sessionId.trim();
	if (!target) {
		return undefined;
	}
	return await withCliCore(
		async (core) => {
			const [row, messages] = await Promise.all([
				core.get(target),
				core.readMessages(target),
			]);
			if (!row || messages.length === 0) {
				return undefined;
			}
			return {
				version: 1,
				updated_at: row.updatedAt,
				messages: messages as ConversationHistory["messages"],
				sessionId: row.sessionId,
				systemPrompt:
					typeof row.metadata?.systemPrompt === "string"
						? row.metadata.systemPrompt
						: undefined,
			};
		},
		{ forceLocalBackend: true },
	);
}
