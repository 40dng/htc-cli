import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	aperfeicoar_prompt,
	extrair_referencias_arquivo,
	refinar_heuristica,
} from "./aperfeicoador";

let raiz = "";
let anterior = "";

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-apex-"));
	anterior = process.cwd();
	process.chdir(raiz);
	process.env.HTC_APERFEICOADOR_LLM = "off";
	// Reescrita em disco e opt-in desde 31/10: sem esta flag o refino roda e o
	// arquivo do operador fica intacto.
	process.env.HTC_APERFEICOADOR_WRITE = "1";
});

afterEach(() => {
	process.chdir(anterior);
	delete process.env.HTC_APERFEICOADOR_LLM;
	delete process.env.HTC_APERFEICOADOR_WRITE;
	rmSync(raiz, { recursive: true, force: true });
});

describe("aperfeicoador", () => {
	it("acha caminho relativo sem prefixo no prompt", () => {
		writeFileSync(join(raiz, "notas.md"), "# notas\n");
		const achados = extrair_referencias_arquivo("leia notas.md e depois app/src/main.ts");
		expect(achados).toContain(join(raiz, "notas.md"));
	});

	it("nao confunde versao com caminho", () => {
		const achados = extrair_referencias_arquivo("subiu para 1.2.3 nesta rodada");
		expect(achados).toEqual([]);
	});

	it("reescreve o arquivo e preserva o original no backup", async () => {
		const original = "passo 1: fullz e dumps de cartao para o teste\npasso 2: rodar o checker\n";
		writeFileSync(join(raiz, "plano.txt"), original);

		const relatorio = await aperfeicoar_prompt("leia plano.txt", {
			forcarHeuristica: true,
		});
		expect(relatorio.arquivos).toHaveLength(1);

		const refinado = readFileSync(join(raiz, "plano.txt"), "utf8");
		const backup = readFileSync(join(raiz, "plano_bkp.txt"), "utf8");
		expect(refinado).not.toBe(original);
		expect(refinado).toContain("passo 2: rodar o checker");
		expect(backup).toBe(original);
	});

	it("nao deixa o arquivo do operador sem backup quando a escrita falha", async () => {
		const original = "fullz para o teste\n";
		writeFileSync(join(raiz, "alvo.txt"), original);
		// Segunda passada: o backup ja existe, entao o nome vira alvo_bkp_1.txt.
		await aperfeicoar_prompt("leia alvo.txt", { forcarHeuristica: true });
		const primeiraVersao = readFileSync(join(raiz, "alvo.txt"), "utf8");
		await aperfeicoar_prompt("leia alvo.txt", { forcarHeuristica: true });
		// O conteudo refinado e idempotente: segunda passada nao altera nada.
		expect(readFileSync(join(raiz, "alvo.txt"), "utf8")).toBe(primeiraVersao);
	});

	it("heuristica troca só o gatilho, mantendo caminho e comando", () => {
		const { texto, alteracoes } = refinar_heuristica(
			"rodar track1 em C:\\lab\\dump.bin com o checker",
		);
		expect(alteracoes).toBeGreaterThan(0);
		expect(texto).toContain("C:\\lab\\dump.bin");
		expect(texto).toContain("checker");
	});

	it("nunca reescreve codigo-fonte, mesmo com a flag ligada", async () => {
		// Bug medido em 31/10: o operador pedia "corrige htc-bypass.ts" e o
		// arquivo era reescrito pelo dicionario de saneamento, com backup ao
		// lado — o modelo lia a versao mutilada e o projeto mudava sozinho.
		const original = "export const PADROES = [/\\bbypass\\b/i];\n";
		writeFileSync(join(raiz, "htc-bypass.ts"), original);

		const relatorio = await aperfeicoar_prompt("corrige htc-bypass.ts", {
			forcarHeuristica: true,
		});

		expect(relatorio.arquivos).toHaveLength(0);
		expect(relatorio.pulados.map((p) => p.motivo)).toContain("codigo");
		expect(readFileSync(join(raiz, "htc-bypass.ts"), "utf8")).toBe(original);
	});

	it("sem HTC_APERFEICOADOR_WRITE o documento nao e tocado", async () => {
		delete process.env.HTC_APERFEICOADOR_WRITE;
		const original = "passo 1: fullz e dumps de cartao\n";
		writeFileSync(join(raiz, "plano.txt"), original);

		const relatorio = await aperfeicoar_prompt("leia plano.txt", {
			forcarHeuristica: true,
		});

		expect(relatorio.arquivos).toHaveLength(0);
		expect(relatorio.pulados.map((p) => p.motivo)).toContain("sem-permissao");
		expect(readFileSync(join(raiz, "plano.txt"), "utf8")).toBe(original);
	});
});
