import { describe, expect, it } from "vitest";
import { eixo_de_correcao, injetar_system } from "./injection";
import { nivel_para_tentativa } from "../runtime/htc-bypass";

const BASE = "You are a helpful coding agent.";

/** O system efetivo e a soma dos blocos: o bloco 0 e a caixa (constante). */
function systemCompleto(blocos: unknown): string {
	if (typeof blocos === "string") return blocos;
	if (!Array.isArray(blocos)) return "";
	return blocos
		.map((b) => (b && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
		.join("\n\n");
}

describe("injetar_system — nivel por tentativa", () => {
	it("nivel 1 e nivel 3 nao produzem o mesmo system", () => {
		const n1 = systemCompleto(injetar_system(BASE, 1));
		const n3 = systemCompleto(injetar_system(BASE, 3));
		expect(n1).not.toBe(n3);
		expect(n3).toContain("ARTIFACT OR NOTHING");
		expect(n1).not.toContain("ARTIFACT OR NOTHING");
	});

	it("o nivel default continua sendo o do ambiente (payload intacto)", () => {
		expect(systemCompleto(injetar_system(BASE))).toContain("[HATACHI]");
	});

	it("o bloco 0 e a caixa cacheavel: identico entre niveis, com cache_control", () => {
		const n1 = injetar_system(BASE, 1) as Array<{ text: string; cache_control?: unknown }>;
		const n3 = injetar_system(BASE, 3) as Array<{ text: string; cache_control?: unknown }>;
		expect(n1[0].text).toBe(n3[0].text);
		expect(n1[0].text).toContain("=== END CONSTANTS ===");
		expect(n1[0].cache_control).toEqual({ type: "ephemeral" });
		expect(n3[1].cache_control).toBeUndefined();
	});

	it("a rotacao legada fica suprimida mesmo com HTC_PAYLOAD=capacidade", () => {
		const fechoAntigo = "about the hands that use it";
		const antes = {
			legado: process.env.HTC_PAYLOAD_LEGADO,
			payload: process.env.HTC_PAYLOAD,
		};
		process.env.HTC_PAYLOAD = "capacidade";
		try {
			// Seletor legado apontando para "capacidade": sem o env de legado, o
			// fecho antigo NAO entra — a caixa manda.
			const normal = systemCompleto(injetar_system(BASE, 1));
			expect(normal).not.toContain(fechoAntigo);
			expect(normal).toContain("=== END CONSTANTS ===");

			process.env.HTC_PAYLOAD_LEGADO = "on";
			const legado = systemCompleto(injetar_system(BASE, 1));
			expect(legado).toContain(fechoAntigo);
			expect(legado).not.toContain("=== END CONSTANTS ===");
		} finally {
			if (antes.legado === undefined) delete process.env.HTC_PAYLOAD_LEGADO;
			else process.env.HTC_PAYLOAD_LEGADO = antes.legado;
			if (antes.payload === undefined) delete process.env.HTC_PAYLOAD;
			else process.env.HTC_PAYLOAD = antes.payload;
		}
	});
});

describe("eixo_de_correcao", () => {
	it("muda a cada correcao e cicla", () => {
		const um = eixo_de_correcao(1);
		const dois = eixo_de_correcao(2);
		expect(um).not.toBe(dois);
		expect(eixo_de_correcao(5)).toBe(um);
	});

	it("nivel da correcao sobe com o numero de correcoes", () => {
		expect(nivel_para_tentativa(1)).toBeGreaterThanOrEqual(nivel_para_tentativa(0));
	});
});
