// language: TypeScript, file: src/utils/socks_bridge.test.ts, runtime: Bun, runner: bun:test
import { describe, expect, it } from "bun:test";
import { parsear_upstream_socks } from "./socks_bridge";

describe("parsear_upstream_socks", () => {
	it("le socks4 e socks5", () => {
		expect(parsear_upstream_socks("socks4://198.51.100.11:1080")).toEqual({
			versao: 4,
			host: "198.51.100.11",
			porta: 1080,
		});
		expect(parsear_upstream_socks("socks5://127.0.0.1:9050")).toEqual({
			versao: 5,
			host: "127.0.0.1",
			porta: 9050,
		});
	});

	it("ignora o sufixo |ms|pais das listas coladas", () => {
		const linha =
			"socks4://198.51.100.12:4153|1136|br|Brazil|residencial|ASE TELECOMUNICACOES LTDA ME";
		expect(parsear_upstream_socks(linha)).toEqual({
			versao: 4,
			host: "198.51.100.12",
			porta: 4153,
		});
	});

	it("assume socks4 quando falta o esquema", () => {
		expect(parsear_upstream_socks("198.51.100.13:1080")).toEqual({
			versao: 4,
			host: "198.51.100.13",
			porta: 1080,
		});
	});

	it("recusa http, porta ausente e lixo", () => {
		expect(parsear_upstream_socks("http://198.51.100.14:8080")).toBeNull();
		expect(parsear_upstream_socks("socks4://198.51.100.11")).toBeNull();
		expect(parsear_upstream_socks("   ")).toBeNull();
		expect(parsear_upstream_socks("nao-e-proxy")).toBeNull();
	});
});
