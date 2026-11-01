// language: TypeScript, file: src/runtime/vigia.test.ts, runtime: bun
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abrirMissao, fecharMissao, registrarAchado } from "./missao";
import { criarOperacao, estadoDaOperacao } from "./op";
import { caminhoDaPista, lerSteer } from "./steer";
import {
	calcularDelta,
	caminhoRelatorio,
	caminhoTurnos,
	decidirTurno,
	lerTurnos,
	liberarLock,
	limparFim,
	relatorioDaOperacao,
	sinalizarFim,
	tomarLock,
	turnosSecos,
	vigiar,
	type EstadoTurno,
} from "./vigia";

const ALVO = "integra.coop-a.example.com";

function estado(parcial: Partial<EstadoTurno> = {}): EstadoTurno {
	return {
		degrau: "superficie",
		n: 2,
		fase: "recon",
		achados: 0,
		validados: 0,
		shells: 0,
		...parcial,
	};
}

describe("decisao do vigia", () => {
	const base = {
		antes: estado(),
		depois: estado(),
		secos: 0,
		limiteSecos: 3,
		laneFechada: false,
		missaoFechada: false,
		fim: false,
		restanteMs: 3_600_000,
		turnosRestantes: 5,
		intervaloMs: 0,
		timeout: false,
		falhou: false,
		falhas: 0,
	};

	it("para quando o operador sinaliza .fim", () => {
		const d = decidirTurno({ ...base, fim: true });
		expect(d.acao).toBe("parar");
		expect(d.motivo).toContain("operador");
	});

	it("para com a missao fechada: objetivo encerrado", () => {
		const d = decidirTurno({ ...base, missaoFechada: true });
		expect(d.acao).toBe("parar");
		expect(d.motivo).toContain("objetivo");
	});

	it("para no prazo e no teto de turnos, nessa ordem", () => {
		expect(decidirTurno({ ...base, restanteMs: 0 }).motivo).toContain("prazo");
		expect(decidirTurno({ ...base, turnosRestantes: 0 }).motivo).toContain("turnos");
	});

	it("steer de prova quando o degrau sobe sem validados novos", () => {
		const d = decidirTurno({
			...base,
			depois: estado({ degrau: "entrada", n: 3, achados: 1 }),
		});
		expect(d.acao).toBe("continuar");
		expect(d.steer).toContain("sem validados novos");
		expect(d.steer).toContain("volte ao degrau anterior");
	});

	it("steer de bloqueio quando enche de turnos secos", () => {
		const d = decidirTurno({ ...base, secos: 3 });
		expect(d.acao).toBe("continuar");
		expect(d.steer).toContain("Sem artefato ha 3 turnos");
		expect(d.steer).toContain("proximo vetor");
	});

	it("steer de tempo quando o turno estoura o teto", () => {
		const d = decidirTurno({ ...base, timeout: true });
		expect(d.steer).toContain("estourou o teto de tempo");
	});

	it("falha de infraestrutura insiste sem steer e para em cinco", () => {
		const uma = decidirTurno({ ...base, falhou: true, falhas: 1 });
		expect(uma.acao).toBe("continuar");
		expect(uma.steer).toBeUndefined();
		expect(uma.esperaMs).toBeGreaterThanOrEqual(60_000);
		const cinco = decidirTurno({ ...base, falhou: true, falhas: 5 });
		expect(cinco.acao).toBe("parar");
		expect(cinco.motivo).toContain("falhou 5 turnos");
	});

	it("sem nada errado, continua limpo", () => {
		const d = decidirTurno(base);
		expect(d).toMatchObject({ acao: "continuar", motivo: "ok", esperaMs: 0 });
		expect(d.steer).toBeUndefined();
	});
});

describe("medicao do turno", () => {
	it("delta conta achados, validados, shells e degrau", () => {
		const delta = calcularDelta(
			estado({ achados: 2, validados: 1, shells: 0 }),
			estado({ achados: 4, validados: 3, shells: 1, degrau: "entrada", n: 3 }),
		);
		expect(delta).toEqual({ achados: 2, validados: 2, shells: 1, degrau: true });
	});

	it("turnos secos so contam a cauda sem artefato", () => {
		const seco = { artefato: false } as never;
		const comArtefato = { artefato: true } as never;
		expect(turnosSecos([seco, comArtefato, seco, seco])).toBe(2);
		expect(turnosSecos([comArtefato])).toBe(0);
		expect(turnosSecos([])).toBe(0);
	});
});
describe("vigia da lane", () => {
	let raiz = "";
	let anterior: Record<string, string | undefined> = {};

	beforeEach(() => {
		raiz = mkdtempSync(join(tmpdir(), "htc-vigia-"));
		anterior = {
			HTC_STATE_DIR: process.env.HTC_STATE_DIR,
			HTC_OP: process.env.HTC_OP,
			HTC_SESSION_ID: process.env.HTC_SESSION_ID,
		};
		process.env.HTC_STATE_DIR = raiz;
		delete process.env.HTC_OP;
		delete process.env.HTC_SESSION_ID;
		criarOperacao({ nome: "op1", alvo: ALVO, env: process.env });
		abrirMissao({ alvo: ALVO, env: { ...process.env, HTC_OP: "op1" } });
	});

	afterEach(() => {
		for (const [chave, valor] of Object.entries(anterior)) {
			if (valor === undefined) delete process.env[chave];
			else process.env[chave] = valor;
		}
		rmSync(raiz, { recursive: true, force: true });
	});

	it("roda turnos, mede o disco e para com a missao fechada", async () => {
		let chamadas = 0;
		const resultado = await vigiar("op1", {
			horas: 3,
			turnos: 10,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 2,
			dormir: async () => {},
			log: () => {},
			executar: async ({ env, promptPath }) => {
				chamadas += 1;
				expect(existsSync(promptPath)).toBe(true);
				if (chamadas === 1) {
					registrarAchado(
						{
							titulo: "upload sem validacao",
							evidencia: "200 + arquivo",
							validado: true,
						},
						env,
					);
				}
				if (chamadas === 2) fecharMissao(env);
				return { codigo: 0, timeout: false };
			},
		});
		expect(chamadas).toBe(2);
		expect(resultado.motivo).toContain("missao fechada");
		expect(resultado.turnos).toHaveLength(2);
		expect(resultado.turnos[0].artefato).toBe(true);
		expect(resultado.turnos[0].delta.achados).toBe(1);
		expect(resultado.turnos[0].delta.validados).toBe(1);

		const turnos = lerTurnos("op1");
		expect(turnos).toHaveLength(2);
		expect(turnos[1].artefato).toBe(false);
		expect(existsSync(caminhoTurnos("op1"))).toBe(true);

		const relatorio = readFileSync(caminhoRelatorio("op1"), "utf8");
		expect(relatorio).toContain("# OP1");
		expect(relatorio).toContain("upload sem validacao");
		expect(relatorio).toContain("## Proximo passo");
	});

	it("grava steer no turno seco e o prompt seguinte o carrega", async () => {
		let chamadas = 0;
		await vigiar("op1", {
			horas: 3,
			turnos: 10,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 1,
			dormir: async () => {},
			log: () => {},
			executar: async ({ env }) => {
				chamadas += 1;
				if (chamadas === 2) fecharMissao(env);
				return { codigo: 0, timeout: false };
			},
		});
		expect(chamadas).toBe(2);
		expect(lerSteer("op1")).toContain("Sem artefato ha 1 turnos");
		const prompt = readFileSync(caminhoDaPista("op1", process.env, "md"), "utf8");
		expect(prompt).toContain("## Correcao do vigia");
	});

	it("apaga o steer quando o turno produz artefato", async () => {
		let chamadas = 0;
		await vigiar("op1", {
			horas: 3,
			turnos: 5,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 1,
			dormir: async () => {},
			log: () => {},
			executar: async ({ env }) => {
				chamadas += 1;
				if (chamadas === 1) return { codigo: 0, timeout: false };
				registrarAchado(
					{ titulo: "sessao emitida", evidencia: "cookie", validado: true },
					env,
				);
				fecharMissao(env);
				return { codigo: 0, timeout: false };
			},
		});
		expect(chamadas).toBe(2);
		expect(lerSteer("op1")).toBeUndefined();
	});

	it("respeita o prazo mesmo com turno que demora", async () => {
		let relogio = 1_000_000;
		let chamadas = 0;
		const resultado = await vigiar("op1", {
			horas: 0.001,
			turnos: 10,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 3,
			agora: () => relogio,
			dormir: async () => {},
			log: () => {},
			executar: async () => {
				chamadas += 1;
				relogio += 5_000;
				return { codigo: 0, timeout: false };
			},
		});
		expect(chamadas).toBe(1);
		expect(resultado.motivo).toContain("prazo");
	});

	it("nao arranca com .fim sinalizado e registra zero turnos", async () => {
		sinalizarFim("op1");
		let chamadas = 0;
		const resultado = await vigiar("op1", {
			horas: 1,
			turnos: 5,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 3,
			dormir: async () => {},
			log: () => {},
			executar: async () => {
				chamadas += 1;
				return { codigo: 0, timeout: false };
			},
		});
		expect(chamadas).toBe(0);
		expect(resultado.turnos).toHaveLength(0);
		expect(resultado.motivo).toContain("parada sinalizada");
		limparFim("op1");
	});

	it("um vigia por lane: o lock barra o segundo", () => {
		const primeiro = tomarLock("op1");
		expect(primeiro.ok).toBe(true);
		const segundo = tomarLock("op1");
		expect(segundo.ok).toBe(false);
		expect(segundo.pid).toBe(process.pid);
		liberarLock("op1");
		expect(tomarLock("op1").ok).toBe(true);
		liberarLock("op1");
	});

	it("abre a missao da lane quando ela ainda nao existe", async () => {
		criarOperacao({
			nome: "op2",
			alvo: "contaonline.coop-b.example.com",
			objetivo: "sessao de cooperado -> ordem",
			env: process.env,
		});
		sinalizarFim("op2");
		await vigiar("op2", {
			horas: 1,
			turnos: 1,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 3,
			dormir: async () => {},
			log: () => {},
			executar: async () => ({ codigo: 0, timeout: false }),
		});
		const medida = estadoDaOperacao("op2");
		expect(medida?.alvo).toBe("contaonline.coop-b.example.com");
		expect(medida?.fase).not.toBe("sem missao");
	});

	it("cinco turnos com codigo != 0 param a lane sem steer", async () => {
		let chamadas = 0;
		const resultado = await vigiar("op1", {
			horas: 3,
			turnos: 20,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 3,
			dormir: async () => {},
			log: () => {},
			executar: async () => {
				chamadas += 1;
				return { codigo: 1, timeout: false };
			},
		});
		expect(chamadas).toBe(5);
		expect(resultado.motivo).toContain("falhou 5 turnos");
		expect(lerSteer("op1")).toBeUndefined();
	});

	it("o estado da lane continua medivel depois do vigia", async () => {
		await vigiar("op1", {
			horas: 1,
			turnos: 1,
			tetoTurnoMs: 60_000,
			intervaloMs: 0,
			limiteSecos: 3,
			dormir: async () => {},
			log: () => {},
			executar: async ({ env }) => {
				registrarAchado(
					{ titulo: "painel exposto", evidencia: "200", validado: true },
					env,
				);
				return { codigo: 0, timeout: false };
			},
		});
		const medida = estadoDaOperacao("op1");
		expect(medida?.achados).toBe(1);
		expect(medida?.validados).toBe(1);
		expect(relatorioDaOperacao("op1")).toContain("painel exposto");
	});
});

