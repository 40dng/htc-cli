// language: TypeScript, file: src/runtime/stall-watchdog.ts, target: Bun / Windows
// Vigia de EXECUCAO (function-level). A operacao roda contra um teto de tempo:
// se passar de `timeout_ms` (ou o run desconectar), ela e abortada e a MESMA
// funcao e chamada de novo com os MESMOS argumentos (retoma a funcao
// especifica), ate `max_tentativas`. Nao injeta prompt: a reanima e no executor.
//
// Config por ambiente:
//   HTC_TOOL_WATCHDOG=off   desliga o vigia de execucao (default: on)
//   HTC_TOOL_TIMEOUT_MS     teto por execucao (default: 60000)
//   HTC_TOOL_TENTATIVAS     reexecucoes apos o primeiro estouro (default: 2)

export const TOOL_TIMEOUT_MS_PADRAO = 60_000;
export const TOOL_TIMEOUT_MS_MINIMO = 1_000;
export const TOOL_MAX_TENTATIVAS_PADRAO = 2;

export function vigia_execucao_ativo(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return (env.HTC_TOOL_WATCHDOG ?? "on").trim().toLowerCase() !== "off";
}

export function ler_timeout_execucao_ms(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const bruto = Number.parseInt(env.HTC_TOOL_TIMEOUT_MS ?? "", 10);
	if (Number.isFinite(bruto) && bruto >= TOOL_TIMEOUT_MS_MINIMO) {
		return bruto;
	}
	return TOOL_TIMEOUT_MS_PADRAO;
}

export function ler_max_tentativas_execucao(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const bruto = Number.parseInt(env.HTC_TOOL_TENTATIVAS ?? "", 10);
	if (Number.isFinite(bruto) && bruto >= 0) {
		return bruto;
	}
	return TOOL_MAX_TENTATIVAS_PADRAO;
}

export class ExecucaoExcedeuTempo extends Error {
	readonly ferramenta: string;
	readonly timeout_ms: number;
	constructor(ferramenta: string, timeout_ms: number) {
		super(`execucao de ${ferramenta} passou de ${timeout_ms} ms`);
		this.name = "ExecucaoExcedeuTempo";
		this.ferramenta = ferramenta;
		this.timeout_ms = timeout_ms;
	}
}

export interface InfoTravamentoExecucao {
	ferramenta: string;
	tentativa: number;
	timeout_ms: number;
}

export interface OpcoesVigiaExecucao {
	ferramenta: string;
	timeout_ms?: number;
	max_tentativas?: number;
	ao_travar?: (info: InfoTravamentoExecucao) => void;
}

/**
 * Roda `exec` contra um teto de tempo. Ao estourar (ou ao run abortar), aborta
 * pelo sinal e chama `exec` DE NOVO com os mesmos argumentos — retoma a funcao
 * especifica — ate `max_tentativas`. Esgotadas as tentativas, propaga o ultimo
 * erro. O race garante que uma execucao que ignore o sinal (pendurada) nao segure
 * o vigia: paramos de esperar e reexecutamos.
 */
export async function executar_com_vigia<T>(
	exec: (sinal: AbortSignal) => Promise<T> | T,
	opcoes: OpcoesVigiaExecucao,
	sinal_externo?: AbortSignal,
): Promise<T> {
	const timeout_ms = opcoes.timeout_ms ?? ler_timeout_execucao_ms();
	const max_tentativas = opcoes.max_tentativas ?? ler_max_tentativas_execucao();
	let ultimo_erro: unknown;
	for (let tentativa = 0; tentativa <= max_tentativas; tentativa += 1) {
		const controlador = new AbortController();
		const aoAbortarExterno = () => controlador.abort(sinal_externo?.reason);
		if (sinal_externo?.aborted) {
			controlador.abort(sinal_externo.reason);
		} else {
			sinal_externo?.addEventListener("abort", aoAbortarExterno, { once: true });
		}
		const timer = setTimeout(
			() =>
				controlador.abort(
					new ExecucaoExcedeuTempo(opcoes.ferramenta, timeout_ms),
				),
			timeout_ms,
		);
		const sinal = controlador.signal;
		try {
			return await Promise.race([
				Promise.resolve().then(() => exec(sinal)),
				new Promise<never>((_, rejeitar) => {
					if (sinal.aborted) {
						rejeitar(sinal.reason);
						return;
					}
					sinal.addEventListener("abort", () => rejeitar(sinal.reason), {
						once: true,
					});
				}),
			]);
		} catch (erro) {
			if (sinal_externo?.aborted) throw erro;
			// So reanima quando o ESTOURO de tempo abortou a tentativa. Um erro
			// real do executor (ENOENT, permissao) nao e travamento: propaga.
			if (!controlador.signal.aborted) throw erro;
			ultimo_erro = erro;
			opcoes.ao_travar?.({
				ferramenta: opcoes.ferramenta,
				tentativa: tentativa + 1,
				timeout_ms,
			});
			if (tentativa >= max_tentativas) throw erro;
		} finally {
			clearTimeout(timer);
			sinal_externo?.removeEventListener("abort", aoAbortarExterno);
		}
	}
	throw ultimo_erro instanceof Error
		? ultimo_erro
		: new ExecucaoExcedeuTempo(opcoes.ferramenta, timeout_ms);
}

/**
 * Embrulha um executor de tool (assinatura `(...args, contexto)`) no vigia de
 * execucao. O ultimo argumento e o contexto do agente; trocamos o `signal` dele
 * pelo sinal da tentativa para que o executor seja abortado no estouro. Quando o
 * vigia esta off, o executor roda cru.
 */
export function embrulhar_executor_com_vigia<A extends unknown[], R>(
	ferramenta: string,
	exec: (...args: A) => Promise<R>,
	opcoes?: Partial<OpcoesVigiaExecucao>,
): (...args: A) => Promise<R> {
	return async (...args: A): Promise<R> => {
		if (!vigia_execucao_ativo()) {
			return exec(...args);
		}
		const contexto =
			args.length > 0
				? (args[args.length - 1] as { signal?: AbortSignal } | undefined)
				: undefined;
		return executar_com_vigia<R>(
			(sinal) => {
				if (args.length === 0) {
					return (exec as () => Promise<R>)();
				}
				const proximos = args.slice() as unknown[];
				proximos[proximos.length - 1] = {
					...(contexto ?? {}),
					signal: sinal,
				};
				return (exec as (...a: unknown[]) => Promise<R>)(...proximos);
			},
			{ ferramenta, ...opcoes },
			contexto?.signal,
		);
	};
}
