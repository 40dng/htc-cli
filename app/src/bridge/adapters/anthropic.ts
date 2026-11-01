// language: TypeScript, file: src/bridge/adapters/anthropic.ts, runtime: Bun/Node
// Adapter para providers com protocolo Anthropic (ex.: gateway compativel).
// Faz passthrough da requisicao ja injetada e devolve a resposta completa.

import type { ResultadoUpstream, RespostaAnthropic } from "../anthropic_sse";
import {
	endpoint_do_provider,
	type ProviderResolvido,
} from "../provider_resolver";
import { criar_sinal_com_timeout, TIMEOUT_RESPOSTA_UPSTREAM_MS } from "../timeouts";

export interface RequisicaoAnthropic {
	model?: string;
	system?: unknown;
	messages?: unknown[];
	stream?: boolean;
	[key: string]: unknown;
}

/** Extrai o texto de blocos `thinking` (protocolo Anthropic) para correcao. */
function raciocinio_de_blocos(resposta: RespostaAnthropic): string {
	return (resposta.content ?? [])
		.filter(
			(b) =>
				(b as { type?: string }).type === "thinking" &&
				typeof (b as { thinking?: unknown }).thinking === "string",
		)
		.map((b) => (b as unknown as { thinking: string }).thinking)
		.join("\n");
}

/**
 * Chama o upstream Anthropic com `stream:false` (resposta completa). O teto de
 * tempo cobre a resposta inteira; modelos de reasoning podem demorar.
 */
export async function chamar_anthropic(
	provider: ProviderResolvido,
	corpo: RequisicaoAnthropic,
	signalExterno?: AbortSignal,
): Promise<ResultadoUpstream> {
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
			body: JSON.stringify({
				...corpo,
				model: corpo.model || provider.modelo,
				stream: false,
			}),
			signal,
		});
		const texto = await resposta.text();
		if (!resposta.ok) {
			throw new Error(
				`upstream anthropic ${resposta.status}: ${texto.slice(0, 500)}`,
			);
		}
		const completa = JSON.parse(texto) as RespostaAnthropic;
		return { resposta: completa, raciocinio: raciocinio_de_blocos(completa) };
	} finally {
		cancelar();
	}
}
