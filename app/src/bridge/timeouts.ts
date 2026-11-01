// language: TypeScript, file: src/bridge/timeouts.ts, runtime: Bun/Node
// Timeouts nomeados por operacao. Regra do projeto: nenhuma chamada externa
// (fetch, leitura de config, escrita de resposta) roda sem um teto de tempo
// explicito. Cada constante aqui descreve UMA operacao e o motivo do valor.

/** Leitura dos arquivos de config do HTC (~/.cline/data/settings). Disco local. */
export const TIMEOUT_LEITURA_CONFIG_MS = 5_000;

/** Handshake TCP/TLS com o upstream (opencode/anthropic/deepseek). */
export const TIMEOUT_CONEXAO_UPSTREAM_MS = 20_000;

/** Corpo completo da resposta do modelo. Modelos de reasoning podem demorar. */
export const TIMEOUT_RESPOSTA_UPSTREAM_MS = 240_000;

/** Teto absoluto de uma requisicao /v1/messages ponta a ponta. */
export const TIMEOUT_TOTAL_REQUISICAO_MS = 300_000;

/** /v1/messages/count_tokens — so estimativa local; nunca vai ao upstream. */
export const TIMEOUT_COUNT_TOKENS_MS = 10_000;

/** Espera entre tentativas de correcao (rotacao de payload). */
export const TIMEOUT_RETRY_BACKOFF_MS = 400;

/** Encerramento gracioso do servidor ao receber SIGINT/SIGTERM. */
export const TIMEOUT_SHUTDOWN_MS = 5_000;

/**
 * Cria um AbortSignal que dispara em `ms` e, se um sinal externo (do cliente)
 * for abortado antes, propaga o abort externo. O timer e sempre limpo.
 */
export function criar_sinal_com_timeout(
	ms: number,
	externo?: AbortSignal,
): { signal: AbortSignal; cancelar: () => void } {
	const controlador = new AbortController();
	const disparar = () => {
		if (!controlador.signal.aborted) {
			controlador.abort(new Error(`timeout de ${ms} ms excedido`));
		}
	};
	const timer = setTimeout(disparar, ms);
	timer.unref?.();
	const propagar = () => {
		if (!controlador.signal.aborted) {
			controlador.abort(externo?.reason);
		}
	};
	if (externo) {
		if (externo.aborted) propagar();
		else externo.addEventListener("abort", propagar, { once: true });
	}
	const cancelar = () => {
		clearTimeout(timer);
		externo?.removeEventListener("abort", propagar);
	};
	return { signal: controlador.signal, cancelar };
}

/** Pausa cooperativa usada no backoff entre tentativas. */
export function dormir(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}
