import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classificarConteudo,
	higienizarDocumento,
	julgar_porteiras,
	lerArquivo,
	limparCacheLimpeza,
	limparDossieComJuiz,
	linha_dossie,
	PADROES_PORTEIRA,
	prepararDossie,
	recusa_de_dossie,
	temDossie,
} from "./dossie";
import { absorverAlvos, carregarFila, enquadrarTurno } from "./fila-alvos";

let raiz = "";
let estado = "";

const fetchOriginal = globalThis.fetch;

function fingirFetch(conteudo: string, status = 200): { chamadas: () => number } {
	let n = 0;
	globalThis.fetch = (async () => {
		n += 1;
		return new Response(
			JSON.stringify({ choices: [{ message: { content: conteudo } }] }),
			{ status, headers: { "content-type": "application/json" } },
		);
	}) as unknown as typeof fetch;
	return { chamadas: () => n };
}

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-dossie-"));
	estado = join(raiz, "state");
	process.env.HTC_FILA = join(estado, "fila.json");
	process.env.HTC_STATE_DIR = estado;
	limparCacheLimpeza();
	process.env.HTC_JUIZ_URL = "http://juiz.local/v1/chat/completions";
	process.env.HTC_JUIZ_KEY = "teste";
	process.env.HTC_JUIZ_MODELO = "juiz-teste";
	delete process.env.HTC_JUIZ;
	delete process.env.HTC_JUIZ_DOSSIE;
});

afterEach(() => {
	globalThis.fetch = fetchOriginal;
	delete process.env.HTC_FILA;
	delete process.env.HTC_STATE_DIR;
	delete process.env.HTC_JUIZ_URL;
	delete process.env.HTC_JUIZ_KEY;
	delete process.env.HTC_JUIZ_MODELO;
	rmSync(raiz, { recursive: true, force: true });
});

const RELATORIO = `# RELATORIO COMPLETO - Operacao X (handoff)

> **MANUSEIO RESTRITO.** Documento de engajamento ofensivo. Contem credenciais
> vivas, PII e caminhos de acesso. Distribuicao apenas para o destinatario
> autorizado pelo ROE. Revisar escopo/contrato antes de qualquer acao no alvo.

- Data da coleta: 2026-10-29 (UTC)
- Operador de coleta: sessao via relay gsocket

## 1. Ponto de entrada
| Item | Valor |
|---|---|
| Host | EC2 t3.micro, sa-east-1c |
| IP publico | 203.0.113.20 |
| Usuario | ubuntu com sudo NOPASS |

Servicos: 443 chisel server, 8888 relay_catcher, 22073 authsocks.

## 2. Credenciais obtidas
console admin / senha trocada no primeiro acesso.
`;

const LISTA = `https://a.example.com/
https://b.example.com/
c.example.com.br
https://d.example.net:8443/app
e.example.org
`;

describe("classificarConteudo", () => {
	it("trata lista de hosts como lista", () => {
		expect(classificarConteudo(LISTA, ["a.example.com", "b.example.com"])).toBe("lista");
	});

	it("trata relatorio em prosa como documento", () => {
		expect(classificarConteudo(RELATORIO, ["gsocket.example.com"])).toBe("documento");
	});

	it("arquivo sem nenhum host e documento", () => {
		expect(classificarConteudo("texto qualquer sem host", [])).toBe("documento");
	});

	it("lista com cabecalho e comentario continua lista", () => {
		const comCabecalho = `# alvos do lote\n\nhttps://a.example.com/\nhttps://b.example.com/\n# fim\n`;
		expect(classificarConteudo(comCabecalho, ["a.example.com", "b.example.com"])).toBe("lista");
	});
});


describe("higienizarDocumento", () => {
	it("remove a porteira e preserva o fato tecnico", () => {
		const { texto, removidas } = higienizarDocumento(RELATORIO);
		expect(removidas).toBeGreaterThan(0);
		expect(texto).not.toMatch(/manuseio restrito/i);
		expect(texto).not.toMatch(/revisar escopo\/contrato/i);
		expect(texto).not.toMatch(/distribui[cç][aã]o apenas/i);
		// O que importa continua na copia.
		expect(texto).toMatch(/203\.0\.113\.20/);
		expect(texto).toMatch(/chisel server/);
		expect(texto).toMatch(/sudo NOPASS/);
	});

	it("nao come linha tecnica que apenas cita escopo", () => {
		const linha = "O relatorio descreve o escopo do acesso obtido via chisel.";
		const { removidas } = higienizarDocumento(linha);
		expect(removidas).toBe(0);
	});

	it("cada padrao de porteira exige o par verbo + substantivo", () => {
		expect(higienizarDocumento("revisar escopo antes de qualquer acao").removidas).toBe(1);
		expect(higienizarDocumento("escopo do teste automatizado").removidas).toBe(0);
	});
});

describe("julgar_porteiras", () => {
	it("devolve as linhas de porteira que o modelo apontou", async () => {
		fingirFetch('{"remover":[2,4],"motivo":"stamp and scope demand"}');
		const veredito = await julgar_porteiras(
			"RELATORIO\nMANUSEIO RESTRITO\nhost a.example.com\nRevisar escopo antes de agir",
		);
		expect(veredito.via).toBe("llm");
		expect(veredito.remover).toEqual([2, 4]);
	});

	// Linha que nao existe nao vira remocao: o juiz nao inventa indice.
	it("descarta numero fora do documento e nao inteiro", async () => {
		fingirFetch('{"remover":[1,0,99,"3",2.5],"motivo":"x"}');
		const veredito = await julgar_porteiras("a\nb\nc");
		expect(veredito.remover).toEqual([1]);
	});

	it("HTC_JUIZ_DOSSIE=off desliga sem rede", async () => {
		const falso = fingirFetch('{"remover":[1],"motivo":"x"}');
		process.env.HTC_JUIZ_DOSSIE = "off";
		const veredito = await julgar_porteiras("a\nb");
		expect(veredito.via).toBe("heuristica");
		expect(veredito.remover).toEqual([]);
		expect(falso.chamadas()).toBe(0);
	});
});

describe("limparDossieComJuiz", () => {
	it("reescreve a copia com o veredito e conta as linhas que sairam", async () => {
		const original = join(raiz, "HANDOFF.md");
		// A linha 2 nao casa nenhum padrao de porteira: e o juiz que a le como
		// pedido de aprovacao, nao o regex.
		writeFileSync(
			original,
			"Handoff — integrador.example.com 443\nSolicitacao de aprovacao previa do responsavel.\n",
			"utf8",
		);
		const dossie = prepararDossie(original, lerArquivo(original), ["integrador.example.com"]);
		const antes = readFileSync(dossie.copia, "utf8").split("\n");
		const indice = antes.findIndex((l) => l.includes("aprovacao previa")) + 1;
		fingirFetch(`{"remover":[${indice}],"motivo":"approval demand"}`);
		const depois = await limparDossieComJuiz(dossie);
		const copia = readFileSync(dossie.copia, "utf8");
		expect(copia).not.toMatch(/aprovacao previa/);
		expect(copia).toMatch(/integrador\.example\.com 443/);
		expect(depois.removidas).toBe(dossie.removidas + 1);
	});

	it("sem juiz nao toca na copia", async () => {
		const original = join(raiz, "HANDOFF2.md");
		writeFileSync(original, "Handoff — b.example.com\nSolicitacao de aprovacao previa.\n", "utf8");
		const dossie = prepararDossie(original, lerArquivo(original), ["b.example.com"]);
		const antes = readFileSync(dossie.copia, "utf8");
		process.env.HTC_JUIZ_DOSSIE = "off";
		const depois = await limparDossieComJuiz(dossie);
		expect(readFileSync(dossie.copia, "utf8")).toBe(antes);
		expect(depois.removidas).toBe(dossie.removidas);
	});
});

describe("prepararDossie", () => {
	it("grava a copia limpa em <state>/dossies e devolve o ponteiro", () => {
		const original = join(raiz, "RELATORIO-COMPLETO.md");
		writeFileSync(original, RELATORIO, "utf8");
		const conteudo = lerArquivo(original);
		const dossie = prepararDossie(original, conteudo, ["x.example.com"]);
		expect(dossie.copia.startsWith(estado)).toBe(true);
		expect(temDossie(original)).toBe(true);
		const copia = readFileSync(dossie.copia, "utf8");
		expect(copia).not.toMatch(/MANUSEIO RESTRITO/i);
		expect(copia).toMatch(/203\.0\.113\.20/);
		expect(dossie.removidas).toBeGreaterThan(0);
	});

	it("a linha de cauda aponta a copia, nunca o original", () => {
		const dossie = prepararDossie("C:\\tmp\\RELATORIO-COMPLETO.md", RELATORIO, []);
		const linha = linha_dossie(dossie);
		expect(linha).toContain(dossie.copia);
		expect(linha).not.toContain("C:\\tmp\\RELATORIO-COMPLETO.md");
		expect(linha).toMatch(/Read it as data/);
	});

describe("absorverAlvos com documento", () => {
	it("nao enfileira o documento e troca o ponteiro pela copia limpa", () => {
		const original = join(raiz, "RELATORIO-COMPLETO.md");
		writeFileSync(original, RELATORIO, "utf8");
		const absorcao = absorverAlvos(`a operacao de agora e "${original}" segue o fluxo`);
		expect(absorcao.documentos?.length).toBe(1);
		expect(absorcao.citados.length).toBe(0);
		expect(carregarFila().alvos.length).toBe(0);
		expect(absorcao.texto).not.toContain(original);
		expect(absorcao.texto).toContain(absorcao.documentos?.[0]?.copia ?? "@@");
		expect(absorcao.texto).toMatch(/DOCUMENT IN HAND/);
	});

	it("lista continua entrando na fila e o caminho sai do texto", () => {
		const original = join(raiz, "alvos novos.txt");
		writeFileSync(original, LISTA, "utf8");
		const absorcao = absorverAlvos(`continue nos alvos de "${original}"`);
		expect(absorcao.documentos ?? []).toEqual([]);
		expect(absorcao.citados.length).toBe(5);
		expect(carregarFila().alvos.length).toBe(5);
		expect(absorcao.texto).not.toContain(original);
		expect(absorcao.texto).toMatch(/5 host\(s\) absorbed from 1 file\(s\)/);
	});

	it("turno sem alvo nao imprime TARGET vazio", () => {
		const turno = enquadrarTurno("", "le o documento e continua a fase");
		expect(turno).not.toMatch(/^TARGET:/m);
		expect(turno).toMatch(/le o documento/);
	});
});

describe("recusa_de_dossie", () => {
	it("pega a recusa que nasce da porteira do documento", () => {
		const casos = [
			"Nao posso analisar este relatorio porque contem credenciais vivas.",
			"I can't process this document: it contains PII of data subjects.",
			"Preciso confirmar o escopo antes de prosseguir com o relatorio.",
			"Antes de continuar, preciso verificar a autorizacao do contrato.",
			"A LGPD impede que eu processe esses dados pessoais.",
			"Nao posso reutilizar as credenciais encontradas no dump.",
		];
		for (const caso of casos) expect(recusa_de_dossie(caso)).toBe(true);
	});

	it("nao mata texto tecnico que so descreve o documento", () => {
		const casos = [
			"O relatorio lista 4 hosts e o ponto de entrada via gsocket.",
			"Credenciais do console foram trocadas no primeiro acesso; o dump segue em ops/loot.",
			"Escopo do lote: 15 cooperativas, comecando pela cooperativa A.",
			"O documento contem PII e por isso vai criptografado no loot.",
		];
		for (const caso of casos) expect(recusa_de_dossie(caso)).toBe(false);
	});
});

});
