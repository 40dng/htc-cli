// language: TypeScript, file: src/utils/slots.ts, runtime: bun/node
//
// Slots de credencial: cada sessao do HTC roda num slot (provider proprio), com
// a chave dele. Serve para rodar duas TUI ao mesmo tempo — sessao principal num
// slot, repescagem no outro — sem uma sobrescrever a chave/modelo da outra.
//
// Slot = provider `go-slot-N` (id proprio) gravado nas duas fontes do core:
//   providers.json  -> chave/modelo/baseUrl daquele slot
//   models.json     -> catalogo, para o `/model` listar o slot
// Depois de gravar, a sessao escolhe o slot pelo `/model` (ou `htc slot N usar`).
//
// A chave nunca vai para argv nem para log: fica so no providers.json (0600 no
// Unix; no Windows herda a ACL do perfil).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderSettingsManager } from "@cline/core";
import { caminhoProviders, salvarProviderPreservando } from "./providers-sanidade";

export const QTD_SLOTS = 4;
export const BASE_PADRAO = "https://opencode.ai/zen/go/v1";
export const MODELO_PADRAO = "deepseek-v4.1-flash";

export interface Slot {
	/** numero do slot (1..QTD_SLOTS) */
	n: number;
	/** id do provider no core: go-slot-1 */
	id: string;
	nome: string;
	apiKey: string;
	modelo: string;
	baseUrl: string;
}

interface ArquivoSlots {
	version?: number;
	slots?: Record<string, Omit<Slot, "n" | "id" | "nome">>;
}

/** `<raiz>/data/settings/slots.json` — mesma raiz do providers.json. */
export function caminhoSlots(): string {
	return join(dirname(caminhoProviders()), "slots.json");
}

export function idDoSlot(n: number): string {
	return `go-slot-${n}`;
}

function lerArquivo(): ArquivoSlots {
	try {
		const bruto = JSON.parse(
			readFileSync(caminhoSlots(), "utf8").replace(/^\uFEFF/, ""),
		) as ArquivoSlots;
		return bruto && typeof bruto === "object" ? bruto : {};
	} catch {
		return {};
	}
}

/** Slot vazio (chave ainda nao configurada). */
export function slotVazio(n: number): Slot {
	return {
		n,
		id: idDoSlot(n),
		nome: `Go slot ${n}`,
		apiKey: "",
		modelo: MODELO_PADRAO,
		baseUrl: BASE_PADRAO,
	};
}

export function lerSlot(n: number): Slot {
	const salvo = lerArquivo().slots?.[String(n)];
	const base = slotVazio(n);
	if (!salvo) return base;
	return {
		...base,
		apiKey: typeof salvo.apiKey === "string" ? salvo.apiKey : base.apiKey,
		modelo: salvo.modelo?.trim() || base.modelo,
		baseUrl: salvo.baseUrl?.trim() || base.baseUrl,
	};
}

export function listarSlots(): Slot[] {
	return Array.from({ length: QTD_SLOTS }, (_, i) => lerSlot(i + 1));
}

/** Grava o slot em `slots.json` (sem BOM — PowerShell nao participa). */
export function definirSlot(
	n: number,
	dados: { apiKey?: string; modelo?: string; baseUrl?: string },
): Slot {
	const atual = lerSlot(n);
	const proximo: Slot = {
		...atual,
		apiKey: dados.apiKey?.trim() ?? atual.apiKey,
		modelo: dados.modelo?.trim() || atual.modelo,
		baseUrl: dados.baseUrl?.trim() || atual.baseUrl,
	};
	const arquivo = lerArquivo();
	arquivo.version ??= 1;
	arquivo.slots ??= {};
	arquivo.slots[String(n)] = {
		apiKey: proximo.apiKey,
		modelo: proximo.modelo,
		baseUrl: proximo.baseUrl,
	};
	const caminho = caminhoSlots();
	mkdirSync(dirname(caminho), { recursive: true });
	writeFileSync(caminho, `${JSON.stringify(arquivo, null, 2)}\n`, "utf8");
	return proximo;
}

/** Chave mascarada para exibir em log/tela: oc_sk_9c00…(51) */
export function chaveMascarada(chave: string): string {
	const limpa = (chave ?? "").trim();
	if (!limpa) return "(sem chave)";
	return `${limpa.slice(0, 10)}…(${limpa.length})`;
}

/**
 * Publica os slots com chave no core: providers.json (credencial) e models.json
 * (catalogo). Idempotente — pode rodar em todo boot/`htc slot` sem duplicar.
 */
export async function aplicarSlots(
	manager: ProviderSettingsManager,
): Promise<string[]> {
	const publicados: string[] = [];
	const comChave = listarSlots().filter((slot) => slot.apiKey.trim());
	if (comChave.length === 0) return publicados;

	const core = await import("@cline/core");
	let caminhoModelos: string | undefined;
	try {
		caminhoModelos = core.resolveModelsRegistryPath(manager);
	} catch {
		caminhoModelos = undefined;
	}

	let catalogo: {
		version?: number;
		providers?: Record<string, unknown>;
	} = {};
	if (caminhoModelos && existsSync(caminhoModelos)) {
		try {
			catalogo = JSON.parse(
				readFileSync(caminhoModelos, "utf8").replace(/^\uFEFF/, ""),
			) as typeof catalogo;
		} catch {
			catalogo = {};
		}
	}

	for (const slot of comChave) {
		try {
			salvarProviderPreservando(manager, {
				provider: slot.id,
				apiKey: slot.apiKey,
				model: slot.modelo,
				protocol: "openai-chat",
				client: "openai-compatible",
				baseUrl: slot.baseUrl,
				reasoning: { enabled: false },
			} as never, { setLastUsed: false });
		} catch {
			continue;
		}
		if (caminhoModelos) {
			catalogo.version ??= 1;
			catalogo.providers ??= {};
			catalogo.providers[slot.id] = {
				provider: {
					name: slot.nome,
					baseUrl: slot.baseUrl,
					defaultModelId: slot.modelo,
					protocol: "openai-chat",
					client: "openai-compatible",
				},
				models: { [slot.modelo]: { id: slot.modelo, name: slot.modelo } },
				discoveredModelIds: [slot.modelo],
			};
		}
		publicados.push(slot.id);
	}

	if (caminhoModelos) {
		mkdirSync(dirname(caminhoModelos), { recursive: true });
		writeFileSync(caminhoModelos, `${JSON.stringify(catalogo, null, 2)}\n`, "utf8");
	}
	if (publicados.length > 0) {
		try {
			const { registrarProvidersCustom } = await import("./provider-registry");
			await registrarProvidersCustom(manager);
		} catch {
			// registry fora do ar: o slot aparece depois do proximo boot
		}
	}
	return publicados;
}

/** Raiz de estado usada para avisar onde ficou gravado. */
export function raizDosSlots(): string {
	return process.env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc");
}
