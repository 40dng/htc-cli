import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	caminhoDoutrina,
	carregarDoutrina,
	garantirDoutrinaExemplo,
	textoDoutrina,
} from "./doutrina";

let raiz = "";
let arquivo = "";

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-doutrina-"));
	arquivo = join(raiz, "doutrina.json");
	process.env.HTC_DOUTRINA = arquivo;
});

afterEach(() => {
	delete process.env.HTC_DOUTRINA;
	rmSync(raiz, { recursive: true, force: true });
});

describe("doutrina do operador", () => {
	it("arquivo ausente nao inventa regra", () => {
		const { doutrina, avisos } = carregarDoutrina();
		expect(doutrina).toEqual({});
		expect(avisos).toEqual([]);
		expect(textoDoutrina(doutrina)).toBe("");
	});

	it("cria o exemplo uma vez e nao sobrescreve", () => {
		const primeiro = garantirDoutrinaExemplo();
		expect(primeiro.criado).toBe(true);
		writeFileSync(arquivo, JSON.stringify({ regras_extras: ["X"] }), "utf8");
		const segundo = garantirDoutrinaExemplo();
		expect(segundo.criado).toBe(false);
		expect(readFileSync(arquivo, "utf8")).toContain('"X"');
	});

	it("monta o bloco com regras, egress, vault e deteccao", () => {
		writeFileSync(
			arquivo,
			JSON.stringify({
				regras_extras: ["nunca citar o alvo em prosa"],
				proxies: ["socks5://127.0.0.1:9050"],
				obsidian: { vault: "C:\\notas", pastas: ["ops"], autolink: true },
				auto_deteccao: { recusa: true, pensamento: false },
			}),
			"utf8",
		);
		const { doutrina } = carregarDoutrina();
		const bloco = textoDoutrina(doutrina);
		expect(bloco).toContain("nunca citar o alvo em prosa");
		expect(bloco).toContain("socks5://127.0.0.1:9050");
		expect(bloco).toContain("C:\\notas");
		expect(bloco).toContain("refusal detection on");
		expect(bloco).toContain("reasoning interception off");
	});

	it("nunca escreve selo de autorizacao no system", () => {
		writeFileSync(
			arquivo,
			JSON.stringify({ proxies: ["http://x:1"], regras_extras: ["a"] }),
			"utf8",
		);
		const bloco = textoDoutrina(carregarDoutrina().doutrina).toLowerCase();
		expect(bloco).not.toContain("authorized");
		expect(bloco).not.toContain("engagement");
	});

	it("avisa campo desconhecido e JSON quebrado, sem quebrar", () => {
		writeFileSync(arquivo, JSON.stringify({ regra_extra: ["typo"] }), "utf8");
		expect(carregarDoutrina().avisos[0]).toContain("regra_extra");

		writeFileSync(arquivo, "{ nao e json", "utf8");
		const quebrado = carregarDoutrina();
		expect(quebrado.doutrina).toEqual({});
		expect(quebrado.avisos[0]).toContain("JSON invalido");
	});

	it("respeita HTC_DOUTRINA", () => {
		expect(caminhoDoutrina()).toBe(arquivo);
	});
});
