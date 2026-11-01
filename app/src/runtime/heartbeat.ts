// language: TypeScript, file: src/runtime/heartbeat.ts, target: Bun / Windows
// Batimento cardiaco do processo CLI. E a base do vigia EXTERNO: se o event loop
// travar de verdade (o freeze que nenhum setTimeout interno alcanca, porque o
// timer roda no MESMO loop congelado), este arquivo para de ser atualizado. Um
// processo separado le a idade do batimento e sabe que o CLI congelou.
//
// O batimento e escrito no intervalo ocioso (para o modelo pensando) e na troca
// de fase/tool (para o supervisor saber o que esta em voo e o risco). Escrita
// atomica (tmp + rename) para o leitor nunca ver JSON truncado.
//
// Config por ambiente:
//   HTC_HEARTBEAT=off   desliga (default: on)
//   HTC_HEARTBEAT_MS    intervalo do pulso ocioso (default: 2000)

import {
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const HEARTBEAT_MS_PADRAO = 2_000;
export const HEARTBEAT_MS_MINIMO = 250;

export interface EstadoHeartbeat {
	v: 1;
	pid: number;
	seq: number;
	atualizado_ms: number;
	fase: string;
	ferramenta?: string;
	risco?: string;
	sessao?: string;
	nota?: string;
}

export interface LeituraHeartbeat {
	estado: EstadoHeartbeat;
	idade_ms: number;
}

export function heartbeat_ativo(env: NodeJS.ProcessEnv = process.env): boolean {
	return (env.HTC_HEARTBEAT ?? "on").trim().toLowerCase() !== "off";
}

export function ler_intervalo_heartbeat_ms(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const bruto = Number.parseInt(env.HTC_HEARTBEAT_MS ?? "", 10);
	if (Number.isFinite(bruto) && bruto >= HEARTBEAT_MS_MINIMO) {
		return bruto;
	}
	return HEARTBEAT_MS_PADRAO;
}

/** Diretorio de coordenacao entre o CLI e o supervisor externo. */
export function diretorio_do_supervisor(): string {
	return join(tmpdir(), "htc-supervisor");
}

export function caminho_do_heartbeat(pid: number): string {
	return join(diretorio_do_supervisor(), `${pid}.heartbeat.json`);
}

export function caminho_do_abort(pid: number): string {
	return join(diretorio_do_supervisor(), `${pid}.abort.json`);
}

export function caminho_da_retomada(pid: number): string {
	return join(diretorio_do_supervisor(), `${pid}.resume.json`);
}

export function escrever_heartbeat(
	caminho: string,
	estado: EstadoHeartbeat,
): void {
	mkdirSync(dirname(caminho), { recursive: true });
	const tmp = `${caminho}.${estado.seq}.tmp`;
	writeFileSync(tmp, JSON.stringify(estado), "utf8");
	renameSync(tmp, caminho);
}

/**
 * Le o batimento e devolve o estado junto da idade. Se o JSON falhar (arquivo
 * truncado por kill no meio da escrita), cai para o mtime do arquivo — a idade
 * ainda serve para decidir congelamento.
 */
export function ler_heartbeat(caminho: string): LeituraHeartbeat | undefined {
	try {
		const bruto = readFileSync(caminho, "utf8");
		const estado = JSON.parse(bruto) as EstadoHeartbeat;
		if (!estado || typeof estado.atualizado_ms !== "number") {
			throw new Error("batimento sem atualizado_ms");
		}
		return {
			estado,
			idade_ms: Math.max(0, Date.now() - estado.atualizado_ms),
		};
	} catch {
		try {
			const info = statSync(caminho);
			return {
				estado: {
					v: 1,
					pid: 0,
					seq: 0,
					atualizado_ms: info.mtimeMs,
					fase: "desconhecido",
				},
				idade_ms: Math.max(0, Date.now() - info.mtimeMs),
			};
		} catch {
			return undefined;
		}
	}
}

export interface Batimento {
	caminho: string;
	pulso: () => void;
	atualizar: (
		parcial: Partial<
			Omit<EstadoHeartbeat, "v" | "pid" | "seq" | "atualizado_ms">
		>,
	) => void;
	parar: () => void;
}

/**
 * Cria o batimento. Escreve de imediato, pulsa no intervalo e escreve na hora
 * quando a fase/tool/risco muda (o supervisor usa isso para saber o que esta em
 * voo). `parar()` remove o arquivo — o supervisor le a ausencia como "acabou".
 */
export function criar_batimento(input: {
	caminho: string;
	pid?: number;
	intervalo_ms?: number;
	fase_inicial?: string;
	sessao?: string;
}): Batimento {
	const pid = input.pid ?? process.pid;
	const intervalo = input.intervalo_ms ?? ler_intervalo_heartbeat_ms();
	let seq = 0;
	let fase = input.fase_inicial ?? "inicio";
	let ferramenta: string | undefined;
	let risco: string | undefined;
	let sessao = input.sessao;
	let nota: string | undefined;

	const pulso = (): void => {
		seq += 1;
		escrever_heartbeat(input.caminho, {
			v: 1,
			pid,
			seq,
			atualizado_ms: Date.now(),
			fase,
			ferramenta,
			risco,
			sessao,
			nota,
		});
	};

	pulso();
	const timer = setInterval(pulso, intervalo);
	(timer as { unref?: () => void }).unref?.();

	return {
		caminho: input.caminho,
		pulso,
		atualizar(parcial) {
			let mudou = false;
			if (parcial.fase !== undefined && parcial.fase !== fase) {
				fase = parcial.fase;
				mudou = true;
			}
			if (parcial.ferramenta !== undefined && parcial.ferramenta !== ferramenta) {
				ferramenta = parcial.ferramenta;
				mudou = true;
			}
			if (parcial.risco !== undefined && parcial.risco !== risco) {
				risco = parcial.risco;
				mudou = true;
			}
			if (parcial.sessao !== undefined && parcial.sessao !== sessao) {
				sessao = parcial.sessao;
				mudou = true;
			}
			if (parcial.nota !== undefined && parcial.nota !== nota) {
				nota = parcial.nota;
				mudou = true;
			}
			if (mudou) pulso();
		},
		parar() {
			clearInterval(timer);
			try {
				unlinkSync(input.caminho);
			} catch {
				// Melhor esforco: a ausencia do arquivo e o sinal de encerramento.
			}
		},
	};
}

export interface ObservadorDeAbort {
	parar: () => void;
}

/**
 * Vigia o arquivo de abort escrito pelo supervisor externo. Se ele aparecer, o
 * run chama `ao_abortar` UMA vez. Cobre o caso em que o loop ainda responde mas
 * o turno esta pendurado (o supervisor externo nao precisa matar o processo).
 */
export function criar_observador_de_abort(input: {
	caminho: string;
	ao_abortar: (nudge?: string) => void;
	intervalo_ms?: number;
}): ObservadorDeAbort {
	const intervalo = input.intervalo_ms ?? 1_000;
	let disparou = false;
	const timer = setInterval(() => {
		if (disparou) return;
		let bruto: string;
		try {
			bruto = readFileSync(input.caminho, "utf8");
		} catch {
			return;
		}
		disparou = true;
		let nudge: string | undefined;
		try {
			nudge = (JSON.parse(bruto) as { nudge?: string }).nudge;
		} catch {
			nudge = undefined;
		}
		input.ao_abortar(nudge);
	}, intervalo);
	(timer as { unref?: () => void }).unref?.();
	return {
		parar() {
			clearInterval(timer);
		},
	};
}
