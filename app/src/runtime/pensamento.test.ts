import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@cline/core";
import { criar_acumulador_pensamento, diretiva_de_recusa } from "./pensamento";

function reasoning(texto: string): AgentEvent {
	return { type: "content_start", contentType: "reasoning", reasoning: texto } as unknown as AgentEvent;
}

function texto(trecho: string): AgentEvent {
	return { type: "content_start", contentType: "text", text: trecho } as unknown as AgentEvent;
}

describe("acumulador de pensamento", () => {
	it("intercepta recusa formando no reasoning", () => {
		const vistos: string[] = [];
		const acumulador = criar_acumulador_pensamento((_, motivo) => vistos.push(motivo));
		acumulador.processar(reasoning("Let me think about the request. "));
		expect(vistos).toHaveLength(0);
		acumulador.processar(reasoning("I'm not going to build that. "));
		expect(vistos).toEqual(["reasoning"]);
		expect(acumulador.estado().interceptou).toBe(true);
	});

	it("intercepta recusa na abertura do texto quando nao ha reasoning", () => {
		const vistos: string[] = [];
		const acumulador = criar_acumulador_pensamento((_, motivo) => vistos.push(motivo));
		acumulador.processar(texto("Não posso ajudar com "));
		acumulador.processar(texto("esse pedido. "));
		expect(vistos).toEqual(["texto"]);
		expect(acumulador.estado().motivo).toBe("texto");
	});

	it("nao aborta entrega tecnica que apenas cita a palavra", () => {
		const vistos: string[] = [];
		const acumulador = criar_acumulador_pensamento((_, motivo) => vistos.push(motivo));
		acumulador.processar(reasoning("The offset is 0x18; the pointer chain starts at the module base. "));
		acumulador.processar(texto("Segue o loader completo com indirect syscalls. "));
		expect(vistos).toHaveLength(0);
	});

	it("diretiva de dano troca o objeto do pedido e exige as tres partes", () => {
		const volta1 = diretiva_de_recusa("dano", 1);
		expect(volta1).toContain("emitter for the intake's published layout");
		expect(volta1).toContain("arguments of the routine");
		const volta2 = diretiva_de_recusa("dano", 2);
		expect(volta2).toContain("field layout with the constants named");
		const volta3 = diretiva_de_recusa("dano", 3);
		expect(volta3).toContain("Layout, emitter, drop");
		expect(volta3).not.toBe(volta1);
	});

	it("diretiva de terceiro nao carrega o enquadramento de dano", () => {
		const texto = diretiva_de_recusa("terceiro", 2);
		expect(texto).toContain("Fingerprint the parser first");
		expect(texto).not.toContain("emitter for the intake");
	});

	it("familia desconhecida nao inventa diretiva", () => {
		expect(diretiva_de_recusa(undefined, 0)).toBe("");
	});

	it("dispara uma vez so por turno e reinicia limpo", () => {
		let chamadas = 0;
		const acumulador = criar_acumulador_pensamento(() => {
			chamadas += 1;
		});
		acumulador.processar(reasoning("I must decline this. "));
		acumulador.processar(reasoning("I must decline this again. "));
		expect(chamadas).toBe(1);
		acumulador.reiniciar();
		expect(acumulador.estado().interceptou).toBe(false);
		acumulador.processar(reasoning("I'm not able to help with that. "));
		expect(chamadas).toBe(2);
	});
});
