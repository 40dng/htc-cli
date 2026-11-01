// language: TypeScript, file: src/commands/upgrade.test.ts, runtime: Bun/vitest
// O canal tem dois layouts: site estatico (`<base>/<canal>/<nome>`) e GitHub
// Release (`<base>/<nome>`, namespace plano de /releases/latest/download).
// `urlsDoCanal` devolve as candidatas nessa ordem, e o primeiro que responde
// vence — por isso a ordem e o que se testa aqui.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { urlsDoCanal, somaEsperada } from "./upgrade";

const envBase = process.env.HTC_BASE;
const envCanal = process.env.HTC_CHANNEL;

function limpar() {
	if (envBase === undefined) delete process.env.HTC_BASE;
	else process.env.HTC_BASE = envBase;
	if (envCanal === undefined) delete process.env.HTC_CHANNEL;
	else process.env.HTC_CHANNEL = envCanal;
}

beforeEach(() => {
	delete process.env.HTC_BASE;
	delete process.env.HTC_CHANNEL;
});

afterEach(limpar);

describe("urlsDoCanal", () => {
	it("site estatico: aninhada primeiro, plana como reserva", () => {
		process.env.HTC_BASE = "https://prefeitodev.com/htc-cli";
		expect(urlsDoCanal("version.txt")).toEqual([
			"https://prefeitodev.com/htc-cli/latest/version.txt",
			"https://prefeitodev.com/htc-cli/version.txt",
		]);
	});

	it("GitHub Release: base ja termina no download plano", () => {
		process.env.HTC_BASE =
			"https://github.com/40dng/htc-cli/releases/latest/download";
		expect(urlsDoCanal("SHA256SUMS")).toEqual([
			"https://github.com/40dng/htc-cli/releases/latest/download/latest/SHA256SUMS",
			"https://github.com/40dng/htc-cli/releases/latest/download/SHA256SUMS",
		]);
	});

	it("barra sobrando na base nao duplica barra", () => {
		process.env.HTC_BASE = "https://exemplo.test/htc-cli///";
		expect(urlsDoCanal("version.txt")[0]).toBe(
			"https://exemplo.test/htc-cli/latest/version.txt",
		);
	});

	it("HTC_CHANNEL fixa a versao no caminho aninhado", () => {
		process.env.HTC_BASE = "https://exemplo.test/htc-cli";
		process.env.HTC_CHANNEL = "1.0.1";
		expect(urlsDoCanal("htc-windows-x64.exe")).toEqual([
			"https://exemplo.test/htc-cli/1.0.1/htc-windows-x64.exe",
			"https://exemplo.test/htc-cli/htc-windows-x64.exe",
		]);
	});

	it("canal em branco cai no default 'latest'", () => {
		process.env.HTC_BASE = "https://exemplo.test/htc-cli";
		process.env.HTC_CHANNEL = "  ";
		expect(urlsDoCanal("version.txt")).toEqual([
			"https://exemplo.test/htc-cli/latest/version.txt",
			"https://exemplo.test/htc-cli/version.txt",
		]);
	});

	it("sem HTC_BASE o canal padrao e a release do GitHub", () => {
		expect(urlsDoCanal("version.txt")).toEqual([
			"https://github.com/40dng/htc-cli/releases/latest/download/latest/version.txt",
			"https://github.com/40dng/htc-cli/releases/latest/download/version.txt",
		]);
	});
});

// O checksum era opcional (`if (esperado)`): sem SHA256SUMS o upgrade gravava
// qualquer binario servido pela base. Medido em 01/11 — canal local sem
// SHA256SUMS instalou um exe de 4096 B aleatorios. Agora a ausencia recusa.
describe("somaEsperada", () => {
	const h =
		"852d05ce756f4043f0c77940291cd7b11836f49dc6b1b5f9d0c70620ff6eb1c6";

	it("le a linha do arquivo pedido", () => {
		expect(somaEsperada(`${h}  htc-windows-x64.exe\n`, "htc-windows-x64.exe")).toBe(h);
	});

	it("ignora linhas de outros arquivos", () => {
		const somas = `${"0".repeat(64)}  htc-linux-x64\n${h}  htc-windows-x64.exe\n`;
		expect(somaEsperada(somas, "htc-windows-x64.exe")).toBe(h);
	});

	it("sem linha para o arquivo nao devolve nada", () => {
		expect(somaEsperada(`${h}  htc-linux-x64\n`, "htc-windows-x64.exe")).toBeUndefined();
	});

	it("texto vazio nao devolve nada", () => {
		expect(somaEsperada("", "htc-windows-x64.exe")).toBeUndefined();
	});

	it("hash truncado ou invalido nao passa", () => {
		expect(somaEsperada("852d05ce  htc-windows-x64.exe\n", "htc-windows-x64.exe")).toBeUndefined();
		expect(
			somaEsperada(`${"z".repeat(64)}  htc-windows-x64.exe\n`, "htc-windows-x64.exe"),
		).toBeUndefined();
	});

	it("aceita CRLF e hash em maiuscula", () => {
		expect(
			somaEsperada(`${h.toUpperCase()}  htc-windows-x64.exe\r\n`, "htc-windows-x64.exe"),
		).toBe(h);
	});
});

