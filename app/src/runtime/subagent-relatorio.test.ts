// language: TypeScript, file: src/runtime/subagent-relatorio.test.ts, runtime: bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	caminho_relatorio,
	cauda_do_relatorio,
	gravar_bloco,
	ler_delta,
} from "./subagent-relatorio";

let base = "";

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "htc-rel-"));
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("relatorio de galho em disco", () => {
	it("pai le so o que veio depois do offset", () => {
		const arq = caminho_relatorio(base, "sessao-1", "a1");
		const o1 = gravar_bloco(arq, "primeiro bloco");
		const o2 = gravar_bloco(arq, "segundo bloco");
		expect(o2).toBeGreaterThan(o1);

		const primeira = ler_delta(arq, 0);
		expect(primeira.conteudo).toContain("primeiro bloco");
		expect(primeira.novoOffset).toBe(primeira.total);

		const sobra = ler_delta(arq, o1);
		expect(sobra.conteudo).toBe("segundo bloco\n");
	});

	it("arquivo ausente nao e erro e nao mexe no offset", () => {
		const arq = caminho_relatorio(base, "sessao-1", "nao-existe");
		const d = ler_delta(arq, 42);
		expect(d).toEqual({ conteudo: "", novoOffset: 42, total: 0 });
	});

	it("teto por leitura devolve o resto na chamada seguinte", () => {
		const arq = caminho_relatorio(base, "s", "a");
		gravar_bloco(arq, "x".repeat(100));
		const d1 = ler_delta(arq, 0, 40);
		expect(d1.conteudo.length).toBe(40);
		expect(d1.novoOffset).toBe(40);
		const d2 = ler_delta(arq, d1.novoOffset, 40);
		expect(d2.conteudo.length).toBe(40);
		const d3 = ler_delta(arq, d2.novoOffset, 40);
		expect(d1.conteudo + d2.conteudo + d3.conteudo).toContain("x".repeat(100));
	});

	it("cauda mostra as ultimas linhas e avisa o que ficou de fora", () => {
		const arq = caminho_relatorio(base, "s", "b");
		for (let i = 1; i <= 30; i++) gravar_bloco(arq, `linha ${i}`);
		const cauda = cauda_do_relatorio(arq, 3);
		const linhas = cauda.split("\n");
		expect(linhas[linhas.length - 1]).toBe("linha 30");
		expect(cauda).toContain("omitidos");
	});

	it("bloco vazio nao altera o arquivo", () => {
		const arq = caminho_relatorio(base, "s", "c");
		gravar_bloco(arq, "unico");
		const antes = ler_delta(arq, 0).total;
		expect(gravar_bloco(arq, "")).toBe(antes);
	});

	it("nome do caminho nao escapa do diretorio base", () => {
		const arq = caminho_relatorio(base, "../..", "../../etc/passwd");
		expect(arq.startsWith(base)).toBe(true);
		expect(arq).not.toContain("..");
	});
});
