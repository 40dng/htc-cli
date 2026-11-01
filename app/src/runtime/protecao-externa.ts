// language: TypeScript, file: src/runtime/protecao-externa.ts, target: Bun / Windows
// Liga o batimento, o observador de abort e o supervisor externo numa unica
// peca reaproveitada pelo run-agent (one-shot) e pelo run-interactive. O ponto
// central: o agente escreve o batimento; um processo SEPARADO le e, se congelar,
// mata/relanca. O agente nunca vigia a si mesmo.

import {
	type Batimento,
	criar_batimento,
	criar_observador_de_abort,
	caminho_do_abort,
	caminho_do_heartbeat,
	heartbeat_ativo,
} from "./heartbeat";
import {
	iniciar_supervisor,
	NUDGE_SUPERVISOR,
	type EspecificacaoSupervisor,
} from "./supervisor";

export interface ConfigProtecao {
	cwd: string;
	modo: string;
	sessao?: string;
	tty: boolean;
}

export interface ProtecaoExterna {
	atualizar: Batimento["atualizar"];
	parar: () => void;
}

export interface IniciarProtecaoInput {
	config: ConfigProtecao;
	ao_abortar: (nudge?: string) => void;
	env?: NodeJS.ProcessEnv;
}

export function iniciar_protecao_externa(
	input: IniciarProtecaoInput,
): ProtecaoExterna | undefined {
	const env = input.env ?? process.env;
	if (!heartbeat_ativo(env)) {
		return undefined;
	}
	// Nunca sobe supervisor dentro de teste unitario: o spawn de um processo
	// separado por runAgent poluiria a suite.
	if (env.VITEST) {
		return undefined;
	}
	const pid = process.pid;
	const caminho_batimento = caminho_do_heartbeat(pid);
	const caminho_aborto = caminho_do_abort(pid);
	const batimento = criar_batimento({
		caminho: caminho_batimento,
		sessao: input.config.sessao,
	});
	const observador = criar_observador_de_abort({
		caminho: caminho_aborto,
		ao_abortar: input.ao_abortar,
	});
	const especificacao: EspecificacaoSupervisor = {
		heartbeat: caminho_batimento,
		abort: caminho_aborto,
		pid,
		sessao: input.config.sessao,
		cwd: input.config.cwd,
		modo: input.config.modo,
		tty: input.config.tty,
		nudge: NUDGE_SUPERVISOR,
	};
	const supervisor = iniciar_supervisor(especificacao);
	return {
		atualizar: batimento.atualizar,
		parar() {
			observador.parar();
			batimento.parar();
			supervisor?.parar();
		},
	};
}
