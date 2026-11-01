// language: TypeScript, file: src/session/resume-sanidade.test.ts, runtime: Bun
import { describe, expect, it } from "vitest";
import type { BlocoConteudo } from "../bridge/anthropic_sse";
import { filtrar_tool_use_orfao, type Mensagem } from "./resume-sanidade";

const texto = (t: string): BlocoConteudo => ({ type: "text", text: t }) as BlocoConteudo;
const uso = (id: string): BlocoConteudo =>
	({ type: "tool_use", id, name: "run_commands", input: {} }) as BlocoConteudo;
const resultado = (id: string): BlocoConteudo =>
	({ type: "tool_result", tool_use_id: id, content: "ok" }) as BlocoConteudo;

const user = (blocos: BlocoConteudo[]): Mensagem => ({ role: "user", content: blocos });
const assist = (blocos: BlocoConteudo[]): Mensagem => ({ role: "assistant", content: blocos });

describe("sanidade de resume", () => {
	it("mantem a conversa quando toda tool_use tem resultado", () => {
		const msgs = [user([texto("va")]), assist([uso("t1")]), user([resultado("t1")])];
		const r = filtrar_tool_use_orfao(msgs);
		expect(r.mensagens).toHaveLength(3);
		expect(r.cortadas).toHaveLength(0);
	});

	it("corta a mensagem do assistente com tool_use sem resultado", () => {
		const msgs = [
			user([texto("va")]),
			assist([texto("pensando"), uso("t9")]),
			user([texto("continua")]),
		];
		const r = filtrar_tool_use_orfao(msgs);
		expect(r.mensagens).toHaveLength(2);
		expect(r.cortadas).toEqual(["#1 (t9)"]);
		expect(r.orfas).toEqual(["t9"]);
	});

	it("uma orfa condena a mensagem inteira mesmo com outra resolvida", () => {
		const msgs = [
			assist([uso("ok1"), uso("orfao")]),
			user([resultado("ok1")]),
		];
		const r = filtrar_tool_use_orfao(msgs);
		expect(r.mensagens).toHaveLength(1);
		expect(r.mensagens[0]!.role).toBe("user");
		expect(r.orfas).toEqual(["orfao"]);
	});

	it("tool_result sem tool_use nao e cortado", () => {
		const msgs = [user([resultado("fantasma")]), assist([texto("segue")])];
		const r = filtrar_tool_use_orfao(msgs);
		expect(r.mensagens).toHaveLength(2);
		expect(r.cortadas).toHaveLength(0);
	});

	it("preserva ordem e conteudo das mensagens mantidas", () => {
		const msgs = [
			user([texto("a")]),
			assist([uso("x")]),
			user([resultado("x")]),
			assist([uso("y")]),
		];
		const r = filtrar_tool_use_orfao(msgs);
		expect(r.mensagens.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
		expect(r.mensagens[0]).toBe(msgs[0]);
	});

	it("aceita content em string e nao quebra", () => {
		const msgs: Mensagem[] = [
			{ role: "user", content: "texto puro" },
			assist([uso("z")]),
		];
		const r = filtrar_tool_use_orfao(msgs);
		expect(r.mensagens).toHaveLength(1);
	});
});
