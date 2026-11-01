import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	caminhoSidebarSessao,
	espelharSidebar,
	lerGalhos,
	lerResumoFila,
} from "./sidebar";

let raiz = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-sidebar-"));
	env = { HTC_STATE_DIR: join(raiz, ".htc"), HTC_SESSION_ID: "s1" };
	mkdirSync(join(env.HTC_STATE_DIR, "state"), { recursive: true });
	env.HTC_SIDEBAR_FILE = join(env.HTC_STATE_DIR, "state", "htc_sidebar.s1.json");
});

afterEach(() => {
	rmSync(raiz, { recursive: true, force: true });
});

describe("espelharSidebar", () => {
	it("mescla em vez de sobrescrever o campo do outro escritor", () => {
		// Bug de 31/10: missao e payload escreviam o mesmo arquivo e o ultimo
		// apagava o conjunto do outro — o painel do outro sumia.
		espelharSidebar({ alvo: "a.example.com", fase: "recon" }, env);
		espelharSidebar(
			{ payload: { rotulo: "ANON · capability", indice: 1, nivel: 2 } },
			env,
		);

		const lido = JSON.parse(
			readFileSync(env.HTC_SIDEBAR_FILE as string, "utf8"),
		) as Record<string, unknown>;
		expect(lido.alvo).toBe("a.example.com");
		expect(lido.fase).toBe("recon");
		expect((lido.payload as { nivel: number }).nivel).toBe(2);
	});

	it("sem HTC_SIDEBAR_FILE nao explode", () => {
		expect(() => espelharSidebar({ alvo: "x" }, {})).not.toThrow();
	});
});

describe("lerResumoFila", () => {
	it("conta os estados da fila da sessao", () => {
		writeFileSync(
			join(env.HTC_STATE_DIR as string, "state", "fila.s1.json"),
			JSON.stringify({
				alvos: [
					{ alvo: "a", estado: "feito" },
					{ alvo: "b", estado: "em_curso", tentativas: 2 },
					{ alvo: "c", estado: "novo" },
					{ alvo: "d", estado: "parado" },
				],
			}),
		);

		const resumo = lerResumoFila(env);
		expect(resumo).toMatchObject({
			total: 4,
			novo: 1,
			em_curso: 1,
			feito: 1,
			parado: 1,
			atual: "b",
			tentativas: 2,
		});
	});

	it("sem arquivo devolve undefined", () => {
		expect(lerResumoFila(env)).toBeUndefined();
	});
});

describe("lerGalhos", () => {
	it("conta os relatorios de galho da sessao", () => {
		const dir = join(env.HTC_STATE_DIR as string, "state", "galhos", "s1");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "g1.relatorio"), "bloco\n");
		writeFileSync(join(dir, "g2.relatorio"), "bloco\n");

		const galhos = lerGalhos(env);
		expect(galhos?.total).toBe(2);
		expect(galhos?.ultimo).toMatch(/^g[12]$/);
	});

	it("sem sessao nao tenta ler nada", () => {
		expect(lerGalhos({ HTC_STATE_DIR: env.HTC_STATE_DIR })).toBeUndefined();
	});
});

describe("caminhoSidebarSessao", () => {
	it("usa a chave explicita quando existe", () => {
		expect(
			caminhoSidebarSessao("C:/w", "abc").replace(/\\/g, "/"),
		).toBe("C:/w/ops/state/htc_sidebar.abc.json");
	});
});
