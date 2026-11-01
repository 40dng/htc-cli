import { describe, expect, test } from "bun:test";
import {
	cabecalhos_do_opencode,
	garantir_fingerprint_do_opencode,
	type GerenciadorDeSettings,
	precisa_de_fingerprint,
	SESSAO_OPENCODE,
	VERSAO_OPENCODE_PADRAO,
} from "./opencode_fingerprint";

function gerenciadorFalso(inicial: Record<string, unknown> | undefined): {
	gerenciador: GerenciadorDeSettings;
	gravacoes: Record<string, unknown>[];
	atual: () => Record<string, unknown> | undefined;
} {
	let estado = inicial;
	const gravacoes: Record<string, unknown>[] = [];
	return {
		gravacoes,
		atual: () => estado,
		gerenciador: {
			getProviderSettings: () => estado,
			saveProviderSettings: (settings) => {
				gravacoes.push(settings as Record<string, unknown>);
				estado = settings as Record<string, unknown>;
				return settings;
			},
		},
	};
}

describe("precisa_de_fingerprint", () => {
	test("pega os providers servidos por HTTP direto", () => {
		expect(precisa_de_fingerprint("opencode-go")).toBe(true);
		expect(precisa_de_fingerprint(" OpenCode-Go ")).toBe(true);
		expect(precisa_de_fingerprint("opencode-zen")).toBe(true);
	});

	test("nao pega o `opencode` (SDK local) nem outros providers", () => {
		expect(precisa_de_fingerprint("opencode")).toBe(false);
		expect(precisa_de_fingerprint("deepseek")).toBe(false);
		expect(precisa_de_fingerprint("cline")).toBe(false);
		expect(precisa_de_fingerprint(undefined)).toBe(false);
	});
});

describe("cabecalhos_do_opencode", () => {
	test("traz o fingerprint exigido pelo endpoint", () => {
		const h = cabecalhos_do_opencode({});
		expect(h["x-opencode-session"]).toBe(SESSAO_OPENCODE);
		expect(h["x-opencode-client"]).toBe("cli");
		expect(h["user-agent"]).toBe(`opencode/${VERSAO_OPENCODE_PADRAO}`);
		expect(h["x-opencode-request"]).toMatch(/^req_[0-9A-Za-z]{20}$/);
		expect(h["x-opencode-project"]).toMatch(/^prj_[0-9A-Za-z]{20}$/);
	});

	test("session id no formato canonico", () => {
		expect(SESSAO_OPENCODE).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
	});

	test("versao do User-Agent vem de HTC_OPENCODE_VERSION", () => {
		expect(cabecalhos_do_opencode({ HTC_OPENCODE_VERSION: "9.9.9" })["user-agent"]).toBe(
			"opencode/9.9.9",
		);
	});
});

describe("garantir_fingerprint_do_opencode", () => {
	test("grava o fingerprint quando o provider nao tem headers", () => {
		const fabrica = gerenciadorFalso({ provider: "opencode-go", apiKey: "oc_sk_x" });
		const mudou = garantir_fingerprint_do_opencode(fabrica.gerenciador, "opencode-go");
		expect(mudou).toBe(true);
		expect(fabrica.gravacoes).toHaveLength(1);
		const headers = (fabrica.atual()?.headers ?? {}) as Record<string, string>;
		expect(headers["x-opencode-session"]).toBe(SESSAO_OPENCODE);
		expect(fabrica.atual()?.apiKey).toBe("oc_sk_x");
	});

	test("e idempotente (nao regrava o que ja esta igual)", () => {
		const fabrica = gerenciadorFalso({ provider: "opencode-go" });
		expect(garantir_fingerprint_do_opencode(fabrica.gerenciador, "opencode-go")).toBe(true);
		expect(garantir_fingerprint_do_opencode(fabrica.gerenciador, "opencode-go")).toBe(false);
		expect(fabrica.gravacoes).toHaveLength(1);
	});

	test("preserva header explicito do operador", () => {
		const fabrica = gerenciadorFalso({
			provider: "opencode-go",
			headers: { "x-opencode-session": "ses_minha" },
		});
		expect(garantir_fingerprint_do_opencode(fabrica.gerenciador, "opencode-go")).toBe(true);
		const headers = (fabrica.atual()?.headers ?? {}) as Record<string, string>;
		expect(headers["x-opencode-session"]).toBe("ses_minha");
		expect(headers["x-opencode-client"]).toBe("cli");
	});

	test("nao toca provider fora do opencode nem settings ausente", () => {
		const outro = gerenciadorFalso({ provider: "deepseek" });
		expect(garantir_fingerprint_do_opencode(outro.gerenciador, "deepseek")).toBe(false);
		expect(outro.gravacoes).toHaveLength(0);
		const vazio = gerenciadorFalso(undefined);
		expect(garantir_fingerprint_do_opencode(vazio.gerenciador, "opencode-go")).toBe(false);
		expect(vazio.gravacoes).toHaveLength(0);
	});
});
