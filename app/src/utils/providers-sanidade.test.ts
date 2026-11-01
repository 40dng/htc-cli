import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	caminhoProviders,
	preservarSegredos,
	repararProvidersDoDisco,
	salvarProviderPreservando,
} from "./providers-sanidade";

let raiz = "";
let anterior: string | undefined;

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-sanidade-"));
	mkdirSync(join(raiz, "data", "settings"), { recursive: true });
	anterior = process.env.CLINE_DIR;
	process.env.CLINE_DIR = raiz;
});

afterEach(() => {
	if (anterior === undefined) delete process.env.CLINE_DIR;
	else process.env.CLINE_DIR = anterior;
	rmSync(raiz, { recursive: true, force: true });
});

function gravar(estado: unknown): string {
	const caminho = caminhoProviders();
	writeFileSync(caminho, `${JSON.stringify(estado, null, 2)}\n`, "utf8");
	return caminho;
}

describe("preservarSegredos", () => {
	it("nao perde apiKey/baseUrl quando o objeto novo so traz modelo", () => {
		const final = preservarSegredos(
			{
				provider: "opencode-go",
				apiKey: "oc_sk_x",
				baseUrl: "https://opencode.ai/zen/go/v1",
				protocol: "openai-chat",
				client: "openai-compatible",
				model: "deepseek-v4.1-flash",
			} as never,
			{ provider: "opencode-go", model: "deepseek-v4-pro", reasoning: { enabled: false } } as never,
		);
		expect(final).toMatchObject({
			apiKey: "oc_sk_x",
			baseUrl: "https://opencode.ai/zen/go/v1",
			protocol: "openai-chat",
			client: "openai-compatible",
			model: "deepseek-v4-pro",
		});
	});

	it("chave nova do operador vence a antiga", () => {
		const final = preservarSegredos(
			{ provider: "opencode-go", apiKey: "velha" } as never,
			{ provider: "opencode-go", apiKey: "nova" } as never,
		);
		expect(final).toMatchObject({ apiKey: "nova" });
	});
});

describe("salvarProviderPreservando", () => {
	it("completa o objeto com o que ja estava no disco antes de gravar", () => {
		const salvo: unknown[] = [];
		salvarProviderPreservando(
			{
				getProviderSettings: () =>
					({
						provider: "opencode-go",
						apiKey: "oc_sk_x",
						baseUrl: "https://opencode.ai/zen/go/v1",
						model: "deepseek-v4.1-flash",
					}) as never,
				saveProviderSettings: (settings: unknown) => {
					salvo.push(settings);
					return { version: 1, providers: {}, modes: {} } as never;
				},
			},
			{
				provider: "opencode-go",
				model: "deepseek-v4-pro",
				reasoning: { enabled: false },
			} as never,
		);
		expect(salvo[0]).toMatchObject({
			apiKey: "oc_sk_x",
			baseUrl: "https://opencode.ai/zen/go/v1",
			model: "deepseek-v4-pro",
		});
	});
});

describe("repararProvidersDoDisco", () => {
	it("restaura credencial do backup e troca um lastUsedProvider sem chave", () => {
		writeFileSync(
			join(raiz, "data", "settings", "providers.json.bak-limpeza"),
			JSON.stringify({
				version: 1,
				lastUsedProvider: "opencode-go",
				modes: {},
				providers: {
					"opencode-go": {
						settings: {
							provider: "opencode-go",
							apiKey: "oc_sk_x",
							baseUrl: "https://opencode.ai/zen/go/v1",
							model: "deepseek-v4.1-flash",
						},
					},
				},
			}),
			"utf8",
		);
		gravar({
			version: 1,
			lastUsedProvider: "opencode",
			modes: {},
			providers: {
				"opencode-go": {
					settings: { provider: "opencode-go", model: "deepseek-v4-pro" },
				},
				opencode: {
					settings: { provider: "opencode", model: "opencode/claude-fable-5-1" },
				},
			},
		});

		const correcoes = repararProvidersDoDisco();

		expect(correcoes.length).toBeGreaterThan(0);
		const reparado = JSON.parse(readFileSync(caminhoProviders(), "utf8"));
		expect(reparado.providers["opencode-go"].settings.apiKey).toBe("oc_sk_x");
		expect(reparado.lastUsedProvider).toBe("opencode-go");
	});

	it("nao escreve nada quando a credencial esta intacta", () => {
		gravar({
			version: 1,
			lastUsedProvider: "opencode-go",
			modes: {},
			providers: {
				"opencode-go": {
					settings: {
						provider: "opencode-go",
						apiKey: "oc_sk_x",
						baseUrl: "https://opencode.ai/zen/go/v1",
						protocol: "openai-chat",
						client: "openai-compatible",
					},
				},
			},
		});
		expect(repararProvidersDoDisco()).toEqual([]);
	});
});
