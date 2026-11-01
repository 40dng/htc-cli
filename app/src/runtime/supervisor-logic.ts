// language: TypeScript, file: src/runtime/supervisor-logic.ts, target: Bun / Windows
// Logica PURA da decisao do supervisor externo. Fica separada do processo que
// faz o kill/spawn para poder ser exercitada sozinha, sem subir nada.
//
// O supervisor le o batimento do CLI. Idade abaixo do limiar = vivo. Acima =
// congelado: primeiro pede abort (arquivo), espera a graca; se continuar
// congelado, mata a arvore do processo. O processo que sofre o freeze nao tem
// como se salvar — quem salva e o de fora.

export type AcaoSupervisor =
	| "aguardar"
	| "pedir_abort"
	| "matar"
	| "desistir";

export interface ConfigSupervisorLogica {
	/** Idade do batimento que ja conta como congelamento. */
	limiar_freeze_ms: number;
	/** Idade que conta como processo morto/perdido (nao ha o que matar). */
	limiar_morto_ms: number;
	/** Tempo de espera entre pedir abort e matar. */
	grace_abort_ms: number;
	/** Numero maximo de episodios antes de desistir. */
	max_episodios: number;
	/** Limiar encurtado quando a tool em voo e de risco HIGH. */
	limiar_freeze_ms_alto?: number;
	/** Graca encurtada no risco HIGH. */
	grace_abort_ms_alto?: number;
}

export function avaliar_supervisor(input: {
	idade_ms: number | undefined;
	episodio: number;
	abort_pedido_ha_ms: number | undefined;
	config: ConfigSupervisorLogica;
	/** Risco da tool em voo (do batimento): "high" encurta o limiar. */
	risco?: string;
}): AcaoSupervisor {
	const { idade_ms, episodio, abort_pedido_ha_ms, config } = input;
	if (idade_ms === undefined) {
		// Batimento sumiu: o CLI encerrou de forma limpa (parar() remove o
		// arquivo). Nao ha o que vigiar.
		return "desistir";
	}
	// Comando HIGH (ls/dir/find/grep -r em arvore grande) pendura rapido e come
	// memoria: quanto antes o de fora reagir, menor o estrago. Sem risco (ou
	// LOW/MEDIUM) vale o limiar normal.
	const alto = input.risco === "high";
	const limiar_freeze = alto
		? (config.limiar_freeze_ms_alto ?? config.limiar_freeze_ms)
		: config.limiar_freeze_ms;
	const grace = alto
		? (config.grace_abort_ms_alto ?? config.grace_abort_ms)
		: config.grace_abort_ms;
	if (idade_ms >= config.limiar_morto_ms) {
		// Antigo demais para ser espera normal: o processo perdeu o controle.
		return "matar";
	}
	if (idade_ms < limiar_freeze) {
		return "aguardar";
	}
	if (episodio >= config.max_episodios) {
		return "desistir";
	}
	if (abort_pedido_ha_ms === undefined) {
		return "pedir_abort";
	}
	if (abort_pedido_ha_ms < grace) {
		return "aguardar";
	}
	return "matar";
}

export function ler_config_supervisor(
	env: NodeJS.ProcessEnv = process.env,
): ConfigSupervisorLogica {
	const inteiro = (nome: string, padrao: number, minimo: number): number => {
		const bruto = Number.parseInt(env[nome] ?? "", 10);
		if (Number.isFinite(bruto) && bruto >= minimo) return bruto;
		return padrao;
	};
	const limiar_freeze_ms = inteiro("HTC_FREEZE_MS", 12_000, 1_000);
	return {
		limiar_freeze_ms,
		limiar_morto_ms: inteiro(
			"HTC_FREEZE_MORTO_MS",
			Math.max(limiar_freeze_ms * 4, 60_000),
			limiar_freeze_ms,
		),
		grace_abort_ms: inteiro("HTC_FREEZE_GRACE_MS", 5_000, 0),
		max_episodios: inteiro("HTC_FREEZE_MAX_EPISODIOS", 3, 1),
		limiar_freeze_ms_alto: inteiro("HTC_FREEZE_MS_ALTO", 6_000, 1_000),
		grace_abort_ms_alto: inteiro("HTC_FREEZE_GRACE_MS_ALTO", 2_000, 0),
	};
}
