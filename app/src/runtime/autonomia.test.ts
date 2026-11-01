// language: TypeScript, file: src/runtime/autonomia.test.ts, runtime: bun
import { afterEach, describe, expect, it } from "vitest";
import {
	autonomia_ativa,
	fecha_a_missao,
	INSTRUMENTOS,
	instrucao_autonoma,
	instrumento_para,
	pediu_fim,
	plano_autonomo,
} from "./autonomia";
import { DEGRAUS } from "./escada";
import type { Missao } from "./missao";

function missao(parcial: Partial<Missao> = {}): Missao {
	return {
		alvo: "fornecedor.example",
		objetivo: "ordem autenticada",
		fase: "enum",
		escopo: [],
		achados: [],
		shells: [],
		historico: [],
		criada: "2026-10-31T00:00:00.000Z",
		atualizada: "2026-10-31T00:00:00.000Z",
		fechada: false,
		...parcial,
	};
}

const ANTERIOR = {
	HTC_AUTONOMO: process.env.HTC_AUTONOMO,
	HTC_MODO: process.env.HTC_MODO,
};

afterEach(() => {
	for (const [chave, valor] of Object.entries(ANTERIOR)) {
		if (valor === undefined) delete process.env[chave];
		else process.env[chave] = valor;
	}
});

describe("motor autonomo", () => {
	it("default OFF: o operador decide quando ligar", () => {
		delete process.env.HTC_AUTONOMO;
		delete process.env.HTC_MODO;
		expect(autonomia_ativa()).toBe(false);
		process.env.HTC_AUTONOMO = "on";
		expect(autonomia_ativa()).toBe(true);
		process.env.HTC_AUTONOMO = "off";
		process.env.HTC_MODO = "yolo";
		expect(autonomia_ativa()).toBe(false);
	});

	it("yolo/zen ligam o motor sem env explicito", () => {
		delete process.env.HTC_AUTONOMO;
		process.env.HTC_MODO = "zen";
		expect(autonomia_ativa()).toBe(true);
	});

	it("cada degrau tem instrumento, e a tentativa gira o instrumento", () => {
		for (const def of DEGRAUS) {
			expect(INSTRUMENTOS[def.id].length).toBeGreaterThan(0);
			expect(instrumento_para(def.id, 0)).toBe(INSTRUMENTOS[def.id][0]);
		}
		const lista = INSTRUMENTOS.entrada;
		expect(instrumento_para("entrada", 1)).toBe(lista[1]);
		expect(instrumento_para("entrada", lista.length)).toBe(lista[0]);
	});

	it("o plano vem do degrau gravado na missao, com artefato e prova da escada", () => {
		const plano = plano_autonomo(missao({ degrau: "sessao" }));
		const def = DEGRAUS.find((d) => d.id === "sessao");
		expect(plano.n).toBe(8);
		expect(plano.degrau).toBe("sessao");
		expect(plano.artefato).toBe(def?.artefato);
		expect(plano.prova).toBe(def?.prova);
		expect(plano.proibido).toEqual(def?.proibido);
	});

	it("missao sem degrau e sem achado nao passa de superficie", () => {
		expect(plano_autonomo(missao()).degrau).toBe("superficie");
		expect(plano_autonomo(undefined).degrau).toBe("superficie");
	});

	it("fase antiga so vira degrau quando ha achado gravado", () => {
		const comAchado = missao({
			fase: "shell",
			achados: [
				{
					id: 1,
					fase: "shell",
					titulo: "id no alvo",
					evidencia: "uid=33(www-data)",
					validado: true,
					criado: "2026-10-31T00:00:00.000Z",
				},
			],
		});
		expect(plano_autonomo(comAchado).degrau).toBe("webshell");
	});

	it("a instrucao carrega degrau, instrumento e prova — nao pede permissao", () => {
		const texto = instrucao_autonoma(missao({ degrau: "entrada" }), { iteracao: 2 });
		expect(texto).toContain("rung 3/10 (entrada)");
		expect(texto).toContain("instrument:");
		expect(texto).toContain("proof required:");
		expect(texto).toContain("not at this rung:");
		expect(texto).toContain("Run the command for this instrument now");
		expect(texto).not.toContain("?");
	});

	it("tentativa > 0 anuncia a troca de instrumento", () => {
		const texto = instrucao_autonoma(missao({ degrau: "entrada" }), { tentativa: 1 });
		expect(texto).toContain("this one is the switch");
		expect(texto).toContain(INSTRUMENTOS.entrada[1]);
	});

	it("missao so fecha no degrau 10 com prova validada", () => {
		expect(fecha_a_missao(missao({ degrau: "transferencia" }))).toBe(false);
		expect(fecha_a_missao(missao({ degrau: "sessao" }))).toBe(false);
		expect(
			fecha_a_missao(
				missao({
					degrau: "transferencia",
					achados: [
						{
							id: 1,
							fase: "pos",
							titulo: "ordem liquidada",
							evidencia: "STR id 9f2",
							validado: true,
							criado: "2026-10-31T00:00:00.000Z",
						},
					],
				}),
			),
		).toBe(true);
	});

	it("[FIM] so conta na ultima linha util", () => {
		expect(pediu_fim("trabalho feito\n[FIM]")).toBe(true);
		expect(pediu_fim("[FIM]\n\ncomentario depois")).toBe(false);
		expect(pediu_fim("segue o trabalho")).toBe(false);
	});
});
