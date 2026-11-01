// language: TypeScript, file: src/runtime/correlacao.test.ts, runtime: bun/node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	briefDeCorrelacao,
	carregarCorpus,
	digestDoCorpus,
	gravarCorpus,
	hostsDaEvidencia,
	normalizarAlvo,
	pivosDoCorpus,
} from "./correlacao";

let raiz = "";

function missao(dir: string, nome: string, corpo: unknown): void {
	mkdirSync(join(dir, "state"), { recursive: true });
	writeFileSync(join(dir, "state", nome), JSON.stringify(corpo), "utf8");
}

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-correlacao-"));
});

afterEach(() => {
	rmSync(raiz, { recursive: true, force: true });
});

describe("hostsDaEvidencia", () => {
	it("tira host de URL, IPv4 e dominio", () => {
		const hosts = hostsDaEvidencia(
			"GET https://integra.coop-a.example.com/x -> 200; bore.pub:16086 -> 203.0.113.10",
		);
		expect(hosts).toContain("integra.coop-a.example.com");
		expect(hosts).toContain("bore.pub");
		expect(hosts).toContain("203.0.113.10");
	});

	it("nao confunde arquivo nem versao com host", () => {
		const hosts = hostsDaEvidencia("GET /console/?amf -> ib/amf.clean.json; Python/3.10.12; missao.json");
		expect(hosts).toEqual([]);
	});

	it("descarta loopback", () => {
		expect(hostsDaEvidencia("SOCKS 127.0.0.1:1080")).toEqual([]);
	});
});

describe("normalizarAlvo", () => {
	it("limpa esquema, caminho, porta e www", () => {
		expect(normalizarAlvo("https://WWW.Example.COM.br:8443/a/b")).toBe("example.com.br");
		expect(normalizarAlvo("")).toBe("");
	});
});

describe("carregarCorpus", () => {
	// O regex escolhe o primeiro host por forma, e essa ordem nao sabe qual host
	// o achado descreve. Os demais nao somem: viram pista no digest.
	it("guarda os outros hosts da evidencia como pista, nao como atribuicao", () => {
		missao(raiz, "missao.json", {
			alvo: "integra.example.com",
			achados: [
				{
					fase: "enum",
					titulo: "gateway exposto",
					evidencia:
						"GET https://integra.example.com/console -> 200, backend 10.20.30.40 e relay bore.pub:16086",
				},
			],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz } as NodeJS.ProcessEnv);
		const achado = corpus.achados[0];
		expect(achado?.host).toBe("integra.example.com");
		expect(achado?.pistas).toContain("10.20.30.40");
		expect(achado?.pistas).not.toContain("integra.example.com");
		const digest = digestDoCorpus(corpus);
		expect(digest).toContain("tambem citados");
		expect(digest).toContain("bore.pub");
	});

	it("atribui cada achado ao host da evidencia, nao ao alvo do arquivo", () => {
		missao(raiz, "missao.json", {
			alvo: "bore.pub:16086",
			achados: [
				{ titulo: "WAF na frente", evidencia: "contaonline.coop-b.example.com responde 403 ModSecurity", validado: true },
				{ titulo: "relay", evidencia: "bore.pub -> 200", validado: false },
			],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		const hosts = corpus.achados.map((a) => a.host);
		expect(hosts).toContain("contaonline.coop-b.example.com");
		expect(hosts).toContain("bore.pub");
		expect(corpus.porHost.find((h) => h.host === "bore.pub")?.validados).toBe(0);
	});

	it("cai no alvo do arquivo quando a evidencia nao nomeia host", () => {
		missao(raiz, "missao.op1.json", {
			alvo: "https://integra.coop-a.example.com/",
			achados: [{ titulo: "token inautenticado", evidencia: "POST -> 200 com JWT", validado: true }],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		expect(corpus.achados[0]?.host).toBe("integra.coop-a.example.com");
	});

	it("le o snapshot .bak como historia e ignora arquivo ilegivel", () => {
		missao(raiz, "missao.json.bak", { alvo: "velho.com", achados: [{ titulo: "x", evidencia: "velho.com" }] });
		missao(raiz, "missao.json", { alvo: "novo.com", achados: [{ titulo: "y", evidencia: "novo.com" }] });
		writeFileSync(join(raiz, "state", "missao.json.corrupt-1750000000"), "{ nao e json", "utf8");
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		expect(corpus.hosts.sort()).toEqual(["novo.com", "velho.com"]);
	});

	it("colapsa o mesmo achado repetido no snapshot e na missao viva", () => {
		const achado = { titulo: "APIkit console expoe operacoes", evidencia: "GET /console/?amf -> 200" };
		missao(raiz, "missao.json.bak", { alvo: "a.com", achados: [{ ...achado, validado: false }] });
		missao(raiz, "missao.json", { alvo: "a.com", achados: [{ ...achado, validado: true }] });
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		expect(corpus.achados).toHaveLength(1);
		expect(corpus.achados[0]?.validado).toBe(true);
	});
});

describe("digest e brief", () => {
	it("o digest marca validado e o brief manda pesquisar", () => {
		missao(raiz, "missao.json", {
			alvo: "a.com",
			achados: [
				{ titulo: "APIkit console expoe 64 operacoes", evidencia: "GET /console/?amf -> 200", validado: true },
			],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		const digest = digestDoCorpus(corpus);
		expect(digest).toContain("## a.com (1 achados, 1 validados)");
		expect(digest).toContain("[V]");
		const brief = briefDeCorrelacao(corpus);
		expect(brief).toContain("fetch_web_content");
		expect(brief).toContain("prevalencia");
	});

	it("gravarCorpus escreve corpus.md e corpus.json", () => {
		missao(raiz, "missao.json", { alvo: "a.com", achados: [{ titulo: "t", evidencia: "a.com", validado: false }] });
		const { md, json } = gravarCorpus({ HTC_STATE_DIR: raiz });
		expect(readFileSync(md, "utf8")).toContain("Corpus — 1 achados");
		expect(JSON.parse(readFileSync(json, "utf8")).hosts).toEqual(["a.com"]);
	});
});

describe("pivosDoCorpus", () => {
	// R1: o fornecedor citado de lado em varios achados e a relacao de confianca
	// ja medida. Agregado, ele e pivo; linha por achado, e ruido.
	it("agrega pista repetida e ignora host ja trabalhado", () => {
		missao(raiz, "missao.json", {
			alvo: "a.com",
			achados: [
				{
					titulo: "trn 219 vaza config de canal",
					evidencia: "GET https://a.com/x -> 200; OFD_ENDPOINT=https://ccd.gastecnologia.com.br",
				},
				{
					titulo: "bundle expoe endpoint do gateway",
					evidencia: "GET https://a.com/y -> 200; ccd.gastecnologia.com.br respondeu 200",
				},
				{
					titulo: "host vizinho medido",
					evidencia: "GET https://b.com/z -> 200; a.com citado de passagem",
				},
			],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		const pivos = pivosDoCorpus(corpus);
		expect(pivos[0]).toEqual({ host: "ccd.gastecnologia.com.br", achados: 2 });
		// a.com ja e host trabalhado: nao vira pivo, mesmo citado como pista.
		expect(pivos.map((p) => p.host)).not.toContain("a.com");
		expect(pivos.map((p) => p.host)).not.toContain("b.com");
	});

	it("o digest publica a secao de pivos e o brief manda rankear", () => {
		missao(raiz, "missao.json", {
			alvo: "a.com",
			achados: [
				{
					titulo: "config de canal",
					evidencia: "GET https://a.com/x -> 200; ccd.gastecnologia.com.br",
				},
				{
					titulo: "outra rota, mesmo gateway",
					evidencia: "GET https://a.com/y -> 200; ccd.gastecnologia.com.br",
				},
			],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		const digest = digestDoCorpus(corpus);
		expect(digest).toContain("## Pivos");
		expect(digest).toContain("- ccd.gastecnologia.com.br — em 2 achado(s)");
		expect(briefDeCorrelacao(corpus)).toContain("## Pivos");
	});

	it("fonte de ferramenta nao e pivo", () => {
		missao(raiz, "missao.json", {
			alvo: "a.com",
			achados: [
				{
					titulo: "binario veio do repo",
					evidencia: "GET https://a.com/x -> 200; raw.githubusercontent.com/40dng/htc-cli",
				},
			],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		expect(pivosDoCorpus(corpus)).toEqual([]);
	});

	it("corpus sem pista nao inventa secao", () => {
		missao(raiz, "missao.json", {
			alvo: "a.com",
			achados: [{ titulo: "so o alvo", evidencia: "GET https://a.com/x -> 200" }],
		});
		const corpus = carregarCorpus({ HTC_STATE_DIR: raiz });
		expect(pivosDoCorpus(corpus)).toEqual([]);
		expect(digestDoCorpus(corpus)).not.toContain("## Pivos");
	});
});

