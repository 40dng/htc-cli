/**
 * HTC — catalogo global de modelos
 *
 * `/models` abre com TODOS os modelos dos providers que tem credencial
 * configurada (api key, oauth ou endpoint local). Provider sem chave nao
 * entra na lista.
 */
import { rotuloDoProvider } from "./provider-label";

export interface ModeloGlobal {
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	maxInputTokens?: number;
}

export function chaveDoModelo(m: { providerId: string; modelId: string }): string {
	return `${m.providerId}::${m.modelId}`;
}

export function separarChave(chave: string): { providerId: string; modelId: string } {
	const corte = chave.indexOf("::");
	if (corte < 0) return { providerId: "", modelId: chave };
	return {
		providerId: chave.slice(0, corte),
		modelId: chave.slice(corte + 2),
	};
}

/**
 * Varre os providers configurados e devolve os modelos de todos eles.
 * Provider sem credencial fica fora, como pedido.
 */
export async function listarTodosOsModelos(): Promise<ModeloGlobal[]> {
	const { listLocalProviders, ProviderSettingsManager } = await import("@cline/core");
	const llms = await import("@cline/llms");
	const manager = new ProviderSettingsManager();
	let providers: Array<{ id: string; configured?: boolean }> = [];
	try {
		const res = await listLocalProviders(manager, { isClinePassEnabled: false });
		providers = res.providers as Array<{ id: string; configured?: boolean }>;
	} catch {
		return [];
	}

	const saida: ModeloGlobal[] = [];
	for (const prov of providers) {
		if (!prov?.id || prov.configured !== true) continue;
		const providerName = rotuloDoProvider(prov.id);
		let detalhes: Record<string, { name?: string; maxInputTokens?: number; contextWindow?: number }> = {};
		try {
			const cfg = manager.getProviderConfig(prov.id, { includeKnownModels: true });
			detalhes = (cfg as { knownModels?: typeof detalhes })?.knownModels ?? {};
		} catch {
			// sem knownModels: cai no catalogo gerado
		}
		// Catalogo gerado entra em UNIAO com o knownModels: um modelo que saiu da
		// lista do endpoint (mas existe) nao pode desaparecer da tela.
		try {
			const gerados = llms.getGeneratedModelsForProvider?.(prov.id) as
				| Record<string, { name?: string; maxInputTokens?: number; contextWindow?: number }>
				| undefined;
			for (const [id, info] of Object.entries(gerados ?? {})) {
				if (!detalhes[id]) detalhes[id] = info;
			}
		} catch {
			// provider sem catalogo gerado
		}
		// O modelo ATUAL do provider sempre aparece, mesmo fora dos catalogos
		// (era o caso do `deepseek-v4.1-flash`, que sumiu da lista do endpoint).
		try {
			const salvo = manager.getProviderSettings(prov.id)?.model?.trim();
			if (salvo && !detalhes[salvo]) detalhes[salvo] = { name: salvo };
		} catch {
			// sem settings: segue
		}
		for (const [modelId, info] of Object.entries(detalhes)) {
			saida.push({
				providerId: prov.id,
				providerName,
				modelId,
				modelName: info?.name ?? modelId,
				maxInputTokens: info?.maxInputTokens ?? info?.contextWindow,
			});
		}
	}
	return saida.sort(
		(a, b) =>
			a.providerName.localeCompare(b.providerName) || a.modelName.localeCompare(b.modelName),
	);
}
