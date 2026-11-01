// language: TypeScript, file: src/commands/correlacao.test.ts, runtime: bun/node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recortarPorHost, runCorrelacao } from "./correlacao";
import { carregarCorpus } from "../runtime/correlacao";

let raiz = "";
let log: ReturnType<typeof vi.spyOn>;

function missao(dir: string, nome: string, corpo: unknown): void {
	mkdirSync(join(dir, "state"), { recursive: true });
	writeFileSync(join(dir, "state", nome), JSON.stringify(corpo), "utf8");
}

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-cmd-correlacao-"));
	process.env.HTC_STATE_DIR = raiz;
	missao(raiz, "missao.json", {
		alvo: "bore.pub:16086",
		achados: [
			{
				titulo: "relay catch-all",
				evidencia: "bore.pub:16086 -> 200 RELAYAWS-CATCHER-OK",
				validado: true,
			},
			{
				titulo: "gateway sem auth",
				evidencia: "integra.coop-a.example.com/console responde 200",
				validado: false,
			},
		],
	});
	log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	log.mockRestore();
	delete process.env.HTC_STATE_DIR;
	rmSync(raiz, { recursive: true, force: true });
});

describe("runCorrelacao", () => {
	it("grava corpus.md e corpus.json no state dir", async () => {
		const rc = await runCorrelacao({});
		expect(rc).toBe(0);
		const md = join(raiz, "ops", "corpus.md");
		const json = join(raiz, "ops", "corpus.json");
		expect(existsSync(md)).toBe(true);
		expect(existsSync(json)).toBe(true);
		const texto = readFileSync(md, "utf8");
		expect(texto).toContain("## bore.pub (1 achados, 1 validados)");
		expect(texto).toContain("## integra.coop-a.example.com (1 achados, 0 validados)");
		expect(texto).toContain("fetch_web_content");
	});

	it("--sem-gravar le sem escrever", async () => {
		await runCorrelacao({ semGravar: true });
		expect(existsSync(join(raiz, "ops", "corpus.md"))).toBe(false);
	});

	it("--json devolve o corpus cru", async () => {
		await runCorrelacao({ json: true, semGravar: true });
		const bruto = String(log.mock.calls[0]?.[0] ?? "");
		const corpus = JSON.parse(bruto) as { achados: unknown[]; hosts: string[] };
		expect(corpus.achados.length).toBe(2);
		expect(corpus.hosts).toContain("bore.pub");
	});

	it("--digest imprime host por host", async () => {
		await runCorrelacao({ digest: true, semGravar: true });
		const bruto = String(log.mock.calls[0]?.[0] ?? "");
		expect(bruto).toContain("## bore.pub");
		expect(bruto).toContain("## integra.coop-a.example.com");
	});

	it("--brief nao cita CVE e manda pesquisar a versao medida", async () => {
		await runCorrelacao({ brief: true, semGravar: true });
		const bruto = String(log.mock.calls[0]?.[0] ?? "");
		expect(bruto).toContain("fetch_web_content");
		expect(bruto).toContain("CVE de memoria nao entra");
		expect(bruto).not.toMatch(/CVE-\d{4}-\d+/);
	});

	it("--host recorta para um host e aceita URL", async () => {
		await runCorrelacao({ host: "https://WWW.integra.coop-a.example.com/x", digest: true, semGravar: true });
		const bruto = String(log.mock.calls[0]?.[0] ?? "");
		expect(bruto).toContain("## integra.coop-a.example.com");
		expect(bruto).not.toContain("## bore.pub");
	});
});

describe("recortarPorHost", () => {
	it("mantem o corpus inteiro quando o host e vazio", () => {
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		expect(recortarPorHost(corpus, "  ")).toBe(corpus);
	});

	it("zera achados de host inexistente", () => {
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		const recorte = recortarPorHost(corpus, "nada.local");
		expect(recorte.achados).toEqual([]);
		expect(recorte.hosts).toEqual([]);
	});
});
