// language: TypeScript, file: src/runtime/escada.test.ts, target: Bun / vitest
// A escada e o objetivo do OPERACAO.md em forma de maquina. Estes testes travam
// duas coisas: (1) a escada tem os 10 degraus, cada um com oraculo e proibicao —
// sem isso o modelo para no shell; (2) o bloco de estado fala de evidencia, nao
// de permissao.

import { describe, expect, it } from "vitest";
import {
	DEGRAUS,
	DIRETIVA_ESCADA,
	degrau_da_fase,
	degrau_do_texto,
	degrau_por_id,
	escada_ativa,
	estado_da_escada,
	proximo_degrau,
} from "./escada";

const PERMISSAO = /authoriz|engagement|permission|allowed|authorised/i;

describe("escada", () => {
	it("tem os dez degraus na ordem do contrato", () => {
		expect(DEGRAUS.map((d) => d.id)).toEqual([
			"ecossistema",
			"superficie",
			"entrada",
			"webshell",
			"tunel",
			"pivo",
			"credencial",
			"sessao",
			"ordem",
			"transferencia",
		]);
		expect(DEGRAUS.map((d) => d.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it("nenhum degrau fica sem oraculo, bloqueio ou proibicao", () => {
		for (const degrau of DEGRAUS) {
			expect(degrau.exige.length, degrau.id).toBeGreaterThan(0);
			expect(degrau.artefato.length, degrau.id).toBeGreaterThan(10);
			expect(degrau.prova.length, degrau.id).toBeGreaterThan(10);
			expect(degrau.falha.length, degrau.id).toBeGreaterThan(0);
			expect(degrau.proibido.length, degrau.id).toBeGreaterThan(0);
		}
	});

	it("encadeia 1 -> 10 e termina no ultimo", () => {
		let atual = degrau_por_id("ecossistema");
		expect(atual?.n).toBe(1);
		for (let esperado = 2; esperado <= 10; esperado++) {
			atual = proximo_degrau(atual?.id ?? "ecossistema");
			expect(atual?.n).toBe(esperado);
		}
		expect(proximo_degrau("transferencia")).toBeUndefined();
	});

	it("o estado diz onde o trabalho esta e o que o fecha", () => {
		const bloco = estado_da_escada({
			alvo: "portal.fornecedor.example",
			degrau: "entrada",
			provados: ["nginx/1.24 no 443", "form de upload em /painel/upload"],
		});
		expect(bloco).toContain("rung 3/10 (entrada) on portal.fornecedor.example");
		expect(bloco).toContain("proven: nginx/1.24 no 443");
		expect(bloco).toContain("artifact:");
		expect(bloco).toContain("closes when:");
		expect(bloco).toContain("not at this rung:");
	});

	it("proibe invencao em vez de autorizar", () => {
		const bloco = estado_da_escada({ degrau: "ordem" });
		expect(bloco).toContain("unmeasured values are parameters");
		expect(bloco).not.toMatch(PERMISSAO);
		expect(DIRETIVA_ESCADA).not.toMatch(PERMISSAO);
	});

	it("a diretiva nomeia o degrau final", () => {
		expect(DIRETIVA_ESCADA).toContain("the objective is rung 10, not the shell");
		expect(DIRETIVA_ESCADA).toContain("Do not skip a rung");
	});

	it("infere o degrau pelo vocabulario do pedido", () => {
		expect(
			degrau_do_texto(
				"O fornecedor de mensageria tem uma pasta de entrada de arquivo de liquidacao.",
			),
		).toBe("ordem");
		expect(
			degrau_do_texto("O portal aceita upload sem validar extensao."),
		).toBe("entrada");
		expect(degrau_do_texto("roda o nmap em 10.0.0.5")).toBe("superficie");
		expect(degrau_do_texto("mapear o ecossistema do fornecedor")).toBe(
			"ecossistema",
		);
		expect(degrau_do_texto("bom dia, tudo certo?")).toBeUndefined();
	});

	it("prefere o degrau mais baixo quando o pedido cita a cadeia inteira", () => {
		expect(
			degrau_do_texto(
				"Preciso do payload de webshell pelo upload e do tunel para pivo na rede interna.",
			),
		).toBe("entrada");
	});

	it("mapeia a fase antiga sem promover o degrau", () => {
		expect(degrau_da_fase("recon")).toBe("superficie");
		expect(degrau_da_fase("vetor")).toBe("entrada");
		expect(degrau_da_fase("shell")).toBe("webshell");
		expect(degrau_da_fase("pos")).toBe("webshell");
		expect(degrau_da_fase("inexistente")).toBeUndefined();
	});

	it("liga por padrao e desliga por HTC_ESCADA=off", () => {
		expect(escada_ativa({} as NodeJS.ProcessEnv)).toBe(true);
		expect(escada_ativa({ HTC_ESCADA: "off" } as NodeJS.ProcessEnv)).toBe(false);
	});
});
