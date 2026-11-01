// language: TypeScript, file: src/runtime/subagent-policy.test.ts, runtime: Bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gravar_bloco } from "./subagent-relatorio";
import {
	abrir_relatorio,
	instrucao_galhos,
	POLITICA_AGENTES_PADRAO,
	relatorio_no_contexto,
	tarefa_do_galho,
} from "./subagent-policy";

let base = "";
beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "htc-pol-"));
});
afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("canal de relatorio na politica de galho", () => {
	it("abrir_relatorio devolve caminho e offset inicial", () => {
		const { arquivo, offset } = abrir_relatorio(base, "s1", "galho-1");
		expect(arquivo).toContain("s1");
		expect(arquivo.endsWith(".relatorio")).toBe(true);
		expect(offset).toBe(0);
	});

	it("offset acompanha o que o filho ja escreveu", () => {
		const { arquivo } = abrir_relatorio(base, "s1", "g2");
		gravar_bloco(arquivo, "primeira linha");
		const depois = abrir_relatorio(base, "s1", "g2");
		expect(depois.offset).toBeGreaterThan(0);
	});

	it("relatorio_no_contexto devolve vazio quando nao ha arquivo", () => {
		expect(relatorio_no_contexto(join(base, "nada.relatorio"))).toBe("");
	});

	it("contexto leva a cauda, nao o arquivo inteiro", () => {
		const { arquivo } = abrir_relatorio(base, "s1", "g3");
		for (let i = 1; i <= 20; i++) gravar_bloco(arquivo, `achado ${i}`);
		const bloco = relatorio_no_contexto(arquivo, 3);
		const linhas = bloco.split("\n");
		expect(linhas[linhas.length - 1]).toBe("achado 20");
		expect(bloco.length).toBeLessThan(400);
	});

	it("tarefa_do_galho aponta o arquivo quando ele e informado", () => {
		const { arquivo } = abrir_relatorio(base, "s1", "g4");
		const sem = tarefa_do_galho("q", "e", "p");
		const com = tarefa_do_galho("q", "e", "p", arquivo);
		expect(sem).not.toContain("RELATORIO:");
		expect(com).toContain("RELATORIO:");
		expect(com).toContain(arquivo);
	});

	it("instrucao_galhos respeita o teto configurado", () => {
		const texto = instrucao_galhos({ ...POLITICA_AGENTES_PADRAO, maxReportLines: 5 });
		expect(texto).toContain("5 linhas");
	});
});
