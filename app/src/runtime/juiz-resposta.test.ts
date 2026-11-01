// language: TypeScript, file: src/runtime/juiz-resposta.test.ts, runtime: vitest
// O juiz de resposta e a unificacao: aqui se prova que (a) UMA chamada responde
// as duas perguntas, (b) o par (recusa, deriva) sobre o mesmo texto nao paga
// duas vezes, (c) campo torto nao vira veredito, (d) os desligamentos valem.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { julgar_deriva, limparCacheDeriva } from "./juiz-turno";
import { julgar_recusa, limparCacheJuiz } from "./juiz-recusa";
import { julgar_resposta, limparCacheResposta } from "./juiz-resposta";

const RESPOSTA_DERIVA =
	"Atualizei ops/lab/orchestrator/test.mjs, o harness passou e agora o teste cobre o parser.";

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

const VEREDITO_COMPLETO =
	'{"recusou":false,"entregou":true,"familia":"nenhuma","deriva":true,"motivo":"edits bench test file","trecho":"Atualizei ops/lab/orchestrator/test.mjs"}';

beforeEach(() => {
	limparCacheResposta();
	limparCacheJuiz();
	limparCacheDeriva();
	process.env.HTC_JUIZ_URL = "http://juiz.local/v1/chat/completions";
	process.env.HTC_JUIZ_KEY = "teste";
	process.env.HTC_JUIZ_MODELO = "juiz-teste";
	delete process.env.HTC_JUIZ;
	delete process.env.HTC_JUIZ_DERIVA;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env = { ...originalEnv };
});

describe("julgar_resposta", () => {
	it("uma chamada devolve recusa e deriva juntas", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		const veredito = await julgar_resposta(RESPOSTA_DERIVA, {
			pedido: "roda o fingerprint",
			alvo: "a.example.com",
		});
		expect(falso.chamadas()).toBe(1);
		expect(veredito.via).toBe("llm");
		expect(veredito.recusou).toBe(false);
		expect(veredito.entregou).toBe(true);
		expect(veredito.deriva).toBe(true);
		expect(veredito.familia).toBe("nenhuma");
	});

	it("recusa e deriva do mesmo texto custam uma chamada so", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		const ctx = { pedido: "roda o fingerprint", alvo: "a.example.com" };
		const primeiro = await julgar_resposta(RESPOSTA_DERIVA, ctx);
		const segundo = await julgar_resposta(RESPOSTA_DERIVA, ctx);
		expect(falso.chamadas()).toBe(1);
		expect(segundo.deriva).toBe(primeiro.deriva);
	});

	it("pedido diferente no mesmo texto volta ao juiz", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		await julgar_resposta(RESPOSTA_DERIVA, { pedido: "pedido A" });
		await julgar_resposta(RESPOSTA_DERIVA, { pedido: "pedido B" });
		expect(falso.chamadas()).toBe(2);
	});

	it("deriva com string nao vira veredito, recusa segue valida", async () => {
		fingirFetch(
			'{"recusou":true,"entregou":false,"familia":"escopo","deriva":"true","motivo":"x","trecho":"y"}',
		);
		const veredito = await julgar_resposta("preciso de autorizacao", { pedido: "p" });
		expect(veredito.via).toBe("llm");
		expect(veredito.deriva).toBeUndefined();
		expect(veredito.recusou).toBe(true);
		expect(veredito.familia).toBe("escopo");
	});

	it("familia fora do conjunto vira nenhuma", async () => {
		fingirFetch('{"recusou":false,"entregou":true,"familia":"burocracia","deriva":false}');
		const veredito = await julgar_resposta("segue o comando", { pedido: "p" });
		expect(veredito.familia).toBe("nenhuma");
		expect(veredito.deriva).toBe(false);
	});

	it("HTC_JUIZ=off nao chama a rede", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		process.env.HTC_JUIZ = "off";
		const veredito = await julgar_resposta(RESPOSTA_DERIVA, { pedido: "p" });
		expect(veredito.via).toBe("heuristica");
		expect(veredito.deriva).toBeUndefined();
		expect(falso.chamadas()).toBe(0);
	});

	it("HTC_JUIZ_DERIVA=off responde recusa e deixa a deriva para o regex", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		process.env.HTC_JUIZ_DERIVA = "off";
		const veredito = await julgar_resposta(RESPOSTA_DERIVA, { pedido: "p" });
		expect(falso.chamadas()).toBe(1);
		expect(veredito.via).toBe("llm");
		expect(veredito.entregou).toBe(true);
		expect(veredito.deriva).toBeUndefined();
	});

	it("texto vazio nao vira chamada de rede", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		const veredito = await julgar_resposta("   ", { pedido: "p" });
		expect(veredito.motivo).toBe("resposta vazia");
		expect(falso.chamadas()).toBe(0);
	});

	it("http 500 cai na heuristica", async () => {
		fingirFetch("nope", 500);
		const veredito = await julgar_resposta("segue o comando", { pedido: "p" });
		expect(veredito.via).toBe("heuristica");
		expect(veredito.motivo).toBe("http");
	});
});

describe("um transporte, dois chamadores", () => {
	it("julgar_recusa e julgar_deriva dividem a mesma chamada", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		const ctx = { pedido: "roda o fingerprint", alvo: "a.example.com" };
		const recusa = await julgar_recusa(RESPOSTA_DERIVA, ctx.pedido);
		const deriva = await julgar_deriva(RESPOSTA_DERIVA, ctx.alvo, { pedido: ctx.pedido });
		expect(falso.chamadas()).toBe(1);
		expect(recusa.via).toBe("llm");
		expect(recusa.entregou).toBe(true);
		expect(deriva.via).toBe("llm");
		expect(deriva.deriva).toBe(true);
	});

	it("limpar o cache de um limpa o transporte dos dois", async () => {
		const falso = fingirFetch(VEREDITO_COMPLETO);
		await julgar_recusa(RESPOSTA_DERIVA, "p");
		limparCacheJuiz();
		await julgar_deriva(RESPOSTA_DERIVA, undefined, { pedido: "p" });
		expect(falso.chamadas()).toBe(2);
	});
});
