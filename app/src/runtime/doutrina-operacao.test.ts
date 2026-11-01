import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	carregarOperacao,
	diretorioDossies,
	extrairBloco,
	textoOperacao,
} from "./doutrina-operacao";

const raiz = mkdtempSync(join(tmpdir(), "htc-dossies-"));
const env = { HTC_DOSSIES: raiz } as NodeJS.ProcessEnv;

afterEach(() => {
	rmSync(join(raiz, "OPERACAO.md"), { force: true });
	rmSync(join(raiz, "ARQUIVOS.md"), { force: true });
});

describe("extrairBloco", () => {
	it("devolve so o que esta entre os marcadores", () => {
		const texto = "antes\n<!-- x:inicio -->\nconteudo\n<!-- x:fim -->\ndepois";
		expect(extrairBloco(texto, "<!-- x:inicio -->", "<!-- x:fim -->")).toBe(
			"conteudo",
		);
	});

	it("devolve vazio quando falta um dos marcadores", () => {
		expect(extrairBloco("sem marcador", "<!-- x:inicio -->", "<!-- x:fim -->")).toBe("");
	});
});

describe("carregarOperacao", () => {
	it("le o contrato do manual e o mapa do ARQUIVOS", () => {
		writeFileSync(
			join(raiz, "OPERACAO.md"),
			"# manual\n<!-- htc:contrato:inicio -->\nCONTRATO REAL\n<!-- htc:contrato:fim -->\n",
		);
		writeFileSync(
			join(raiz, "ARQUIVOS.md"),
			"# mapa\n<!-- htc:mapa:inicio -->\nMAPA REAL\n<!-- htc:mapa:fim -->\n",
		);
		const carregado = carregarOperacao(env);
		expect(carregado.contrato).toBe("CONTRATO REAL");
		expect(carregado.mapa).toBe("MAPA REAL");
		expect(carregado.avisos).toEqual([]);
	});

	it("cai no contrato embutido quando o manual nao existe", () => {
		const carregado = carregarOperacao(env);
		expect(carregado.contrato).toContain("CONTRATO DE OPERACAO (embutido");
		expect(carregado.avisos.join(" ")).toContain("ausente");
	});

	it("nao engole manual sem marcador", () => {
		writeFileSync(join(raiz, "OPERACAO.md"), "# manual sem marcador\n");
		const carregado = carregarOperacao(env);
		expect(carregado.contrato).toContain("embutido");
		expect(carregado.avisos.join(" ")).toContain("sem bloco");
	});

	it("monta o bloco que entra no system prompt", () => {
		writeFileSync(
			join(raiz, "OPERACAO.md"),
			"<!-- htc:contrato:inicio -->\nCONTRATO REAL\n<!-- htc:contrato:fim -->",
		);
		writeFileSync(
			join(raiz, "ARQUIVOS.md"),
			"<!-- htc:mapa:inicio -->\nMAPA REAL\n<!-- htc:mapa:fim -->",
		);
		const texto = textoOperacao(env);
		expect(texto).toContain("BENCH CONTRACT (from OPERACAO.md");
		expect(texto).toContain("CONTRATO REAL");
		expect(texto).toContain("BENCH MAP (from ARQUIVOS.md");
		expect(texto).toContain("MAPA REAL");
	});
});

describe("diretorioDossies", () => {
	it("respeita HTC_DOSSIES e cai em ~/.htc/dossies", () => {
		expect(diretorioDossies({ HTC_DOSSIES: "C:\\x" } as NodeJS.ProcessEnv)).toBe(
			"C:\\x",
		);
		expect(diretorioDossies({} as NodeJS.ProcessEnv)).toContain("dossies");
	});
});
