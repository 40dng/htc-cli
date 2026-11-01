/**
 * HTC â€” modelos dos canais free
 *
 * O `refreshProviderModelsFromSource` do core so funciona para provider do
 * catalogo embutido (`MODEL_COLLECTIONS_BY_PROVIDER_ID`). `htc-free` e custom,
 * entao a lista tem que ser buscada aqui e gravada via `updateLocalProvider`.
 */
import { spawnSync } from "node:child_process";
import type { ProviderSettingsManager } from "@cline/core";
import { escolherCanalFree, MODELO_FREE_PADRAO } from "./free-endpoints";

/**
 * Endpoint free escolhido agora (env > dsh > gemini) e ja com os modelos lidos
 * do `/models` do proprio canal. Um canal mudo nao bloqueia o outro: quem
 * responde vira o `htc-free`.
 */
async function alvoFree(): Promise<
	{ base: string; chave: string; modelos: string[] } | undefined
> {
	const vivo = await escolherCanalFree(undefined, 2500);
	if (!vivo) return undefined;
	return { base: vivo.base, chave: vivo.key, modelos: vivo.modelos };
}

function idsDeModelos(corpo: unknown): string[] {
	const dados = corpo as { data?: unknown; models?: unknown };
	const lista = Array.isArray(dados?.data)
		? dados.data
		: Array.isArray(dados?.models)
			? dados.models
			: [];
	return lista
		.map((m) => (typeof m === "string" ? m : (m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name))
		.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Le `{base}/models` (OpenAI-compatible) e devolve os ids. */
export async function listarModelosRemotos(base: string, chave = "", timeoutMs = 4000): Promise<string[]> {
	const controle = new AbortController();
	const timer = setTimeout(() => controle.abort(), timeoutMs);
	try {
		const resp = await fetch(`${base.replace(/\/+$/, "")}/models`, {
			headers: chave ? { authorization: `Bearer ${chave}` } : {},
			signal: controle.signal,
		});
		if (!resp.ok) return [];
		return idsDeModelos(await resp.json());
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Grava o `htc-free` direto nas duas fontes do core: providers.json (settings)
 * e models.json (catalogo), e reaplica no registry do llms.
 *
 * Por que nao `addLocalProvider`/`updateLocalProvider`: os dois BAIXAM
 * `<modelsSourceUrl>/models` e abortam a gravacao quando o endpoint exige auth
 * (oneprovider responde 401 para o fetch sem Bearer) â€” o provider ficava com o
 * baseUrl antigo e o primeiro turno morria em ECONNREFUSED.
 */
export async function gravarProviderFree(
	manager: ProviderSettingsManager,
	alvo: { base: string; chave: string; modelos: string[] },
): Promise<number> {
	// A gravacao acontece no caminho real (sincronizarModelosFree -> aqui).
	// Os abortos que eu persegui vinham do harness de teste chamando esta
	// funcao direto; o caminho de producao grava limpo (medido).
	// A mesma escrita aborta o processo nativo DENTRO deste modulo e funciona
	// perfeitamente em processo separado (medido: 9 candidatos eliminados, ver
	// ops/knowledge/free-channel-write-defeito.md). Entao a escrita sai daqui.
	// Preferencia, nao ficcao: o nome so vale se o canal anunciar. Canal que
	// nunca listou `gemini-4-argon` nao deve avisar a cada boot - so avisa se
	// o operador pediu um modelo explicito que nao existe.
	const pedido = process.env.HTC_FREE_MODEL?.trim();
	const modelo =
		(pedido && alvo.modelos.includes(pedido) ? pedido : undefined) ??
		(alvo.modelos.includes(MODELO_FREE_PADRAO) ? MODELO_FREE_PADRAO : undefined) ??
		alvo.modelos[0];
	if (pedido && !alvo.modelos.includes(pedido)) {
		console.warn(
			`htc-free: HTC_FREE_MODEL=${pedido} nao esta no canal; usando ${modelo || "(nenhum)"}`,
		);
	}
	const { escreverProviderFree } = await import("./free-provider-write");
	const escrito = escreverProviderFree({
		base: alvo.base,
		chave: alvo.chave,
		modelo: modelo ?? "",
	});
	return escrito ? alvo.modelos.length : 0;
}

/**
 * Sincroniza o catalogo do `htc-free` com o endpoint vivo.
 * Devolve quantos modelos ficaram gravados.
 */
export async function sincronizarModelosFree(manager: ProviderSettingsManager): Promise<number> {
	const alvo = await alvoFree();
	if (!alvo) return 0;
	if (alvo.modelos.length === 0) {
		// Endpoint mudo: preserva o que ja estava gravado.
		try {
			const { getLocalProviderModels } = await import("@cline/core");
			const cfg = manager.getProviderConfig("htc-free", { includeKnownModels: false });
			if (!cfg) return 0;
			const atual = await getLocalProviderModels("htc-free", cfg as never);
			return atual.models.length;
		} catch {
			return 0;
		}
	}
	try {
		return await gravarProviderFree(manager, alvo);
	} catch {
		return 0;
	}
}

export async function sincronizarTodosOsFree(
	manager: ProviderSettingsManager,
): Promise<{ htcFree: number }> {
	const htcFree = await sincronizarModelosFree(manager).catch(() => 0);
	return { htcFree };
}
