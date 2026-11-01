// language: TypeScript, file: src/utils/provider-registry.ts, runtime: bun/node
// O `@cline/llms` so conhece os providers do catalogo embutido. Um provider
// custom vive no models.json do HTC e NAO no catalogo, entao precisa ser
// registrado a mao antes de qualquer handler ser criado — senao o primeiro
// turno morre com `Unknown or disabled provider "htc-free"`.
//
// `ensureCustomProvidersLoaded` le o models.json uma vez por processo;
// `syncStoredProviderRegistration` reaplica a entrada na hora, para refletir
// escrita feita depois do boot (refresh do /models).

import type { ProviderSettingsManager } from "@cline/core";

/**
 * `htc-free` e um provider CUSTOM: nao existe no catalogo embutido do llms, e
 * registrar a entrada no models.json nao basta — o handler generico resolve o
 * manifest pelo id e morre com `Unknown or disabled provider "htc-free"`.
 *
 * O caminho suportado e a fabrica de handlers (`registerAsyncHandler`): ela e
 * consultada ANTES do manifest e devolve um handler pronto. Delegamos para o
 * provider de catalogo `openai-compatible`, preservando baseUrl/apiKey/modelo
 * que o core montou a partir das settings do HTC.
 */
export async function registrarHandlerCustom(): Promise<boolean> {
	const llms = await import("@cline/llms");
	if (llms.hasRegisteredHandler("htc-free")) return true;
	try {
		llms.registerAsyncHandler("htc-free", async (config) =>
			llms.createHandlerAsync({
				...(config as Record<string, unknown>),
				providerId: "openai-compatible",
			} as never),
		);
		return true;
	} catch {
		return false;
	}
}

/** Registra no llms todo provider do models.json. Devolve os ids aplicados. */
export async function registrarProvidersCustom(
	manager: ProviderSettingsManager,
): Promise<string[]> {
	const core = await import("@cline/core");
	try {
		await core.ensureCustomProvidersLoaded(manager);
	} catch {
		// sem models.json legivel: segue para o sync por entrada
	}
	const aplicados: string[] = [];
	try {
		const caminho = core.resolveModelsRegistryPath(manager);
		const estado = core.readModelsFileSync(caminho) as {
			providers?: Record<string, unknown>;
		};
		for (const [id, entrada] of Object.entries(estado.providers ?? {})) {
			if (!entrada) continue;
			try {
				core.syncStoredProviderRegistration(
					id,
					undefined,
					entrada as Parameters<typeof core.syncStoredProviderRegistration>[2],
				);
				aplicados.push(id);
			} catch {
				// entrada invalida: nao derruba o boot por um provider
			}
		}
	} catch {
		// registry fora do ar: o handler custom cobre o htc-free
	}
	await registrarHandlerCustom();
	if (process.env.HTC_DEBUG_FREE === "1") {
		console.error(`[free] aplicados: ${aplicados.join(",") || "(nenhum)"}`);
	}
	return aplicados;
}
