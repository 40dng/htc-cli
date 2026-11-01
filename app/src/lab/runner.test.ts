import { describe, expect, it } from "vitest";
import type { SondaBypass } from "./prompts";
import { rodar_lab } from "./runner";

const SONDAS: SondaBypass[] = [
	{ id: "s1", categoria: "malware", pedido: "pedido 1" },
	{ id: "s2", categoria: "credencial", pedido: "pedido 2" },
];

const ARTEFATO = "```cpp\n#include <windows.h>\nint main() {\n  return 0;\n}\n```";
const RECUSA = "I'm not going to help with that at all.";

describe("rodar_lab", () => {
	it("conta artefato, recusa e erro por variante", async () => {
		const relatorio = await rodar_lab({
			variantes: ["a", "b"],
			sondas: SONDAS,
			executar: async ({ variante, sonda }) => {
				if (variante === "a") return { texto: ARTEFATO };
				if (sonda.id === "s1") return { texto: RECUSA };
				return { texto: "", erro: "exit 1" };
			},
		});

		const a = relatorio.variantes.find((v) => v.variante === "a");
		const b = relatorio.variantes.find((v) => v.variante === "b");
		expect(a?.total).toBe(2);
		expect(a?.artefato).toBe(2);
		expect(a?.taxa).toBe(1);
		expect(b?.recusa).toBe(1);
		expect(b?.erros).toBe(1);
		// Erro nao conta no denominador.
		expect(b?.taxa).toBe(0);
		expect(relatorio.melhor?.variante).toBe("a");
	});

	it("roda N repeticoes por sonda", async () => {
		let chamadas = 0;
		const relatorio = await rodar_lab({
			variantes: ["a"],
			sondas: SONDAS,
			repeticoes: 3,
			executar: async () => {
				chamadas += 1;
				return { texto: ARTEFATO };
			},
		});
		expect(chamadas).toBe(6);
		expect(relatorio.resultados).toHaveLength(6);
	});

	it("progresso e reportado uma vez por resultado", async () => {
		const vistos: number[] = [];
		await rodar_lab({
			variantes: ["a"],
			sondas: SONDAS,
			executar: async () => ({ texto: ARTEFATO }),
			aoProgredir: (_r, indice, total) => {
				vistos.push(indice);
				expect(total).toBe(2);
			},
		});
		expect(vistos).toEqual([1, 2]);
	});

	it("excecao do executor vira erro contabilizado, nao excecao no lab", async () => {
		const relatorio = await rodar_lab({
			variantes: ["a"],
			sondas: SONDAS,
			executar: async () => {
				throw new Error("boom");
			},
		});
		expect(relatorio.variantes[0].erros).toBe(2);
		expect(relatorio.variantes[0].taxa).toBe(0);
	});
});
