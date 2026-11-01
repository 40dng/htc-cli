import { describe, expect, test } from "bun:test";
import { endpoint_eh_opencode, host_do_endpoint } from "./rota_upstream";

describe("rota do upstream", () => {
	test("extrai o host do endpoint", () => {
		expect(host_do_endpoint("https://opencode.ai/zen/go/v1")).toBe("opencode.ai");
		expect(host_do_endpoint("https://api.deepseek.com/v1")).toBe("api.deepseek.com");
	});

	test("URL invalida nao derruba a decisao", () => {
		expect(host_do_endpoint("nao-e-url")).toBe("");
		expect(endpoint_eh_opencode("nao-e-url")).toBe(false);
		expect(endpoint_eh_opencode("")).toBe(false);
	});

	test("reconhece o endpoint do OpenCode (raiz e subdominio)", () => {
		expect(endpoint_eh_opencode("https://opencode.ai/zen/v1")).toBe(true);
		expect(endpoint_eh_opencode("https://opencode.ai/zen/go/v1")).toBe(true);
		expect(endpoint_eh_opencode("https://api.opencode.ai/v1")).toBe(true);
		expect(endpoint_eh_opencode("https://OPENCODE.AI/zen/v1")).toBe(true);
	});

	test("nao confunde dominio parecido nem outro provedor", () => {
		expect(endpoint_eh_opencode("https://opencode.ai.evil.example/v1")).toBe(false);
		expect(endpoint_eh_opencode("https://naoopencode.ai/v1")).toBe(false);
		expect(endpoint_eh_opencode("https://api.anthropic.com/v1")).toBe(false);
		expect(endpoint_eh_opencode("https://diwness.cloud/v1")).toBe(false);
	});
});
