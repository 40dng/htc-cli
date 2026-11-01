// language: TypeScript, file: src/runtime/juiz-turno.test.ts, runtime: vitest
// O juiz de turno e a medida: aqui se prova que ele (a) le o JSON do modelo,
// (b) respeita os desligamentos, (c) nao repete chamada, (d) cai no regex.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	heuristicaTurno,
	julgar_deriva,
	julgar_turno,
	limparCacheDeriva,
	limparCacheTurno,
} from "./juiz-turno";

const TAIL_COLADO =
	"TARGET IN HAND: bore.pub:16086\nOne host this turn.\nMISSION (live state) phase: entrada";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

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
	limparCacheTurno();
	limparCacheDeriva();
	process.env.HTC_JUIZ_URL = "http://juiz.local/v1/chat/completions";
	process.env.HTC_JUIZ_KEY = "teste";
	process.env.HTC_JUIZ_MODELO = "juiz-teste";
	delete process.env.HTC_JUIZ;
	delete process.env.HTC_JUIZ_TURNO;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env = { ...originalEnv };
});

describe("julgar_turno", () => {
	it("le o veredito JSON do modelo", async () => {
		fingirFetch('{"intencao":"acao","assunto":"operacao","motivo":"orders work on named host"}');
		const veredito = await julgar_turno("roda o fingerprint da 443 em a.example.com");
		expect(veredito.via).toBe("llm");
		expect(veredito.intencao).toBe("acao");
		expect(veredito.assunto).toBe("operacao");
	});

	it("aceita JSON embrulhado em prosa e normaliza caixa", async () => {
		fingirFetch('Claro:\n```json\n{"intencao":"Correcao","assunto":"OPERACAO","motivo":"troca vetor"}\n```');
		const veredito = await julgar_turno("para de enumerar e testa o upload");
		expect(veredito.via).toBe("llm");
		expect(veredito.intencao).toBe("correcao");
		expect(veredito.assunto).toBe("operacao");
	});

	it("descarta valor fora do conjunto e cai no padrao", async () => {
		fingirFetch('{"intencao":"talvez","assunto":"outro","motivo":"x"}');
		const veredito = await julgar_turno("roda o scan", "a.example.com");
		expect(veredito.intencao).toBe("acao");
		expect(veredito.assunto).toBe("operacao");
	});

	it("cai no regex quando o provider responde erro", async () => {
		fingirFetch("nope", 500);
		const veredito = await julgar_turno("para");
		expect(veredito.via).toBe("heuristica");
		expect(veredito.intencao).toBe("parar");
	});

	it("cai no regex quando a resposta nao tem JSON", async () => {
		fingirFetch("nao vou responder em json");
		const veredito = await julgar_turno("corrige o payload e roda de novo");
		expect(veredito.via).toBe("heuristica");
		expect(veredito.intencao).toBe("correcao");
	});

	it("cai no regex quando o fetch explode", async () => {
		globalThis.fetch = (async () => {
			throw new Error("rede morta");
		}) as unknown as typeof fetch;
		const veredito = await julgar_turno("roda o scan", "a.example.com");
		expect(veredito.via).toBe("heuristica");
		expect(veredito.intencao).toBe("acao");
	});

	it("mensagem vazia nao chama a rede", async () => {
		const falso = fingirFetch('{"intencao":"acao","assunto":"fora","motivo":"x"}');
		const veredito = await julgar_turno("   ");
		expect(veredito.via).toBe("heuristica");
		expect(veredito.assunto).toBe("fora");
		expect(falso.chamadas()).toBe(0);
	});

	it("cache evita segunda chamada com o mesmo texto", async () => {
		const falso = fingirFetch('{"intencao":"conversa","assunto":"fora","motivo":"pasted tail"}');
		const primeiro = await julgar_turno(TAIL_COLADO);
		const segundo = await julgar_turno(TAIL_COLADO);
		expect(falso.chamadas()).toBe(1);
		expect(segundo.intencao).toBe(primeiro.intencao);
		expect(segundo.assunto).toBe(primeiro.assunto);
	});

	it("o juiz ve a cauda colada, nao o texto limpo", async () => {
		let enviado = "";
		globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
			enviado = String(init?.body ?? "");
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									'{"intencao":"conversa","assunto":"fora","motivo":"pasted runtime tail"}',
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;
		const veredito = await julgar_turno(TAIL_COLADO);
		expect(veredito.assunto).toBe("fora");
		expect(enviado).toContain("MISSION (live state)");
	});

	it("HTC_JUIZ_TURNO=off usa so o regex", async () => {
		const falso = fingirFetch('{"intencao":"acao","assunto":"operacao","motivo":"x"}');
		process.env.HTC_JUIZ_TURNO = "off";
		const veredito = await julgar_turno("roda o scan em a.example.com");
		expect(veredito.via).toBe("heuristica");
		expect(falso.chamadas()).toBe(0);
	});

	it("HTC_JUIZ=off desliga todos os juizes", async () => {
		const falso = fingirFetch('{"intencao":"acao","assunto":"operacao","motivo":"x"}');
		process.env.HTC_JUIZ = "off";
		const veredito = await julgar_turno("roda o scan");
		expect(veredito.via).toBe("heuristica");
		expect(falso.chamadas()).toBe(0);
	});

	it("forcarHeuristica ignora a rede mesmo com endpoint configurado", async () => {
		const falso = fingirFetch('{"intencao":"acao","assunto":"operacao","motivo":"x"}');
		const veredito = await julgar_turno("roda o scan", undefined, { forcarHeuristica: true });
		expect(veredito.via).toBe("heuristica");
		expect(falso.chamadas()).toBe(0);
	});
});

describe("degrau do turno", () => {
	it("le o degrau que o modelo escolheu", async () => {
		fingirFetch(
			'{"intencao":"acao","assunto":"operacao","degrau":"entrada","motivo":"upload sem validacao"}',
		);
		const veredito = await julgar_turno(
			"o portal aceita upload sem validar extensao, sobe o webshell",
		);
		expect(veredito.degrau).toBe("entrada");
	});

	it("descarta degrau que nao existe na escada", async () => {
		fingirFetch(
			'{"intencao":"acao","assunto":"operacao","degrau":"fachada","motivo":"x"}',
		);
		const veredito = await julgar_turno("roda o scan em a.example.com");
		expect(veredito.degrau).toBeUndefined();
	});

	// Conversa nao carrega estado de escada: um degrau vazado ali empurraria o
	// RUN STATE para o meio de um turno de bancada.
	it("nao aceita degrau em turno de conversa", async () => {
		fingirFetch(
			'{"intencao":"conversa","assunto":"operacao","degrau":"ordem","motivo":"pergunta sobre a ordem"}',
		);
		const veredito = await julgar_turno("o que vc mudou no gerador de ordem?");
		expect(veredito.degrau).toBeUndefined();
	});

	it("o regex responde o mesmo campo quando o juiz esta desligado", () => {
		expect(
			heuristicaTurno("O portal aceita upload sem validar extensao.").degrau,
		).toBe("entrada");
		expect(heuristicaTurno("bom dia, tudo certo?").degrau).toBeUndefined();
	});
});

describe("julgar_deriva", () => {
	it("le a deriva de bancada que o modelo apontou", async () => {
		fingirFetch(
			'{"deriva":true,"motivo":"edits bench test file, plans later work"}',
		);
		const veredito = await julgar_deriva(
			"Atualizei ops/lab/orchestrator/test.mjs e o teste passou.",
			"a.example.com",
		);
		expect(veredito.via).toBe("llm");
		expect(veredito.deriva).toBe(true);
	});

	it("trabalho no alvo nao e deriva", async () => {
		fingirFetch('{"deriva":false,"motivo":"command ran against target"}');
		const veredito = await julgar_deriva(
			"curl -sk https://a.example.com/upload -F 'f=@s.php' devolveu 200",
			"a.example.com",
		);
		expect(veredito.deriva).toBe(false);
	});

	// String "true" e alucinacao de formato: sem booleano de verdade nao ha
	// veredito, e o chamador cai no regex em vez de confiar num campo torto.
	it("campo nao booleano nao vira veredito", async () => {
		fingirFetch('{"deriva":"true","motivo":"x"}');
		const veredito = await julgar_deriva("mexi no harness", "a.example.com");
		expect(veredito.via).toBe("heuristica");
		expect(veredito.deriva).toBe(false);
	});

	it("HTC_JUIZ_DERIVA=off desliga sem rede", async () => {
		const falso = fingirFetch('{"deriva":true,"motivo":"x"}');
		process.env.HTC_JUIZ_DERIVA = "off";
		const veredito = await julgar_deriva("mexi no harness", "a.example.com");
		expect(veredito.via).toBe("heuristica");
		expect(falso.chamadas()).toBe(0);
	});

	it("cache evita segunda chamada com a mesma resposta", async () => {
		const falso = fingirFetch('{"deriva":true,"motivo":"x"}');
		await julgar_deriva("mexi no harness", "a.example.com");
		await julgar_deriva("mexi no harness", "a.example.com");
		expect(falso.chamadas()).toBe(1);
	});
});

describe("heuristicaTurno", () => {
	it("mantem a semantica do regex antigo", () => {
		expect(heuristicaTurno("para").intencao).toBe("parar");
		expect(heuristicaTurno("continua").intencao).toBe("acao");
		expect(heuristicaTurno("corrige o payload").intencao).toBe("correcao");
		expect(heuristicaTurno("roda o scan em a.example.com", "a.example.com").assunto).toBe(
			"operacao",
		);
	});

	it("sem alvo aberto, texto sem host e assunto fora", () => {
		expect(heuristicaTurno("builda o projeto").assunto).toBe("fora");
	});

	// O buraco medido do regex: host no texto, sem missao aberta, nao vira
	// operacao aqui. Quem fecha e o juiz (e o override de host no htc-bypass).
	it("host so no texto, sem alvo em curso: regex nao promove", () => {
		expect(heuristicaTurno("roda o nmap em 10.0.0.5").assunto).toBe("fora");
	});
});
