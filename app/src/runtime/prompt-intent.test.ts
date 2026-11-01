import { describe, expect, it } from "vitest";
import {
	assuntoDoTurno,
	classificarPrompt,
	diretivaDoTurno,
	estadoCompacto,
	exigeArtefato,
	limparCaudaDohost,
} from "./prompt-intent";

describe("classificarPrompt", () => {
	it("pedido de parada nao vira ordem de trabalho", () => {
		for (const t of [
			"para",
			"pare",
			"da uma parada",
			"mano da uma parada, calma ai, vamos ver o que estamos fazendo",
			"nao faca mais nada por enquanto",
			"stop",
		]) {
			expect(classificarPrompt(t)).toBe("parar");
		}
	});

	it("pergunta do operador vira conversa, mesmo com verbo de correcao", () => {
		for (const t of [
			"o que vc mudou?",
			"o que vc fez mano, cade o deepseek v4.1 flash",
			"em que alvo vc esta operando, o que foi feito ate agora",
			"por que ele fixa o payload?",
		]) {
			expect(classificarPrompt(t)).toBe("conversa");
		}
	});

	it("mudanca de direcao vira correcao", () => {
		for (const t of [
			"para de mexer no htc e corrija o payload",
			"ignore isso, o problema era o payload",
			"mude o fluxo: em vez de atacar direto, vai pelo fornecedor",
			"corrija os checkpoints do htc",
		]) {
			expect(classificarPrompt(t)).toBe("correcao");
		}
	});

	it("preposicao 'para o alvo X' nao e pedido de parada", () => {
		expect(classificarPrompt("para o alvo X, sobe o chisel e testa a porta 22")).toBe(
			"acao",
		);
	});

	it("ordem de trabalho continua acao", () => {
		for (const t of [
			"continua de onde parou",
			"sobe o chisel no alvo e me diz o que voltou",
			"vamos prosseguir, so parar quando conseguirmos o objetivo",
		]) {
			expect(classificarPrompt(t)).toBe("acao");
		}
	});

	it("cauda injetada pelo runtime nao contamina a classificacao", () => {
		const comCauda = [
			"o que vc fez mano?",
			"",
			"TARGET IN HAND: bore.pub:16086",
			"Close the turn with an artifact: a command that ran, a file written, or a response body.",
			"Turn type: operator order to execute. Deliver the artifact he asked for.",
		].join("\n");
		expect(limparCaudaDohost(comCauda)).toBe("o que vc fez mano?");
		expect(classificarPrompt(comCauda)).toBe("conversa");
	});
});

describe("assuntoDoTurno", () => {
	it("mensagem sobre a bancada nao puxa a operacao", () => {
		for (const t of [
			"o que vc mudou? cade o deepseek v4.1 flash",
			"corrija os checkpoints do htc, nao esta salvando",
			"ignora isso, o problema era o payload do htc",
			"o provider ficou sem apiKey de novo",
		]) {
			expect(assuntoDoTurno(t, "bore.pub:16086")).toBe("fora");
		}
	});

	it("mensagem sobre o alvo puxa a operacao", () => {
		for (const t of [
			"como ta o alvo? em que fase a gente esta",
			"sobe o chisel no alvo e testa a porta 22",
			"o bore.pub:16086 respondeu 401 no /upload",
		]) {
			expect(assuntoDoTurno(t, "bore.pub:16086")).toBe("operacao");
		}
	});

	it("saudacao nao e ordem de trabalho", () => {
		for (const t of ["oi", "oi!", "eae", "bom dia", "testando", "ok"]) {
			expect(classificarPrompt(t)).toBe("conversa");
		}
	});

	it("paylod colado de volta nao reativa a operacao", () => {
		const payload = [
			"que parada e essa? o payload",
			"TARGET IN HAND: bore.pub:16086",
			"One host this turn. Do not list, count or plan anything else.",
			"Close the turn with an artifact: a command that ran, a file written, or a response body.",
			"MISSION",
			"target: bore.pub:16086",
			"phase: vetor",
			"shells: 0",
			"phase exit: one candidate vector with the reason it should work",
		].join("\n");
		expect(limparCaudaDohost(payload)).toBe("que parada e essa? o payload");
		expect(assuntoDoTurno(payload, "bore.pub:16086")).toBe("fora");
	});

	it("ordem curta de continuacao so vale com missao aberta", () => {
		expect(assuntoDoTurno("continua", "bore.pub:16086")).toBe("operacao");
		expect(assuntoDoTurno("continua")).toBe("fora");
	});
});

describe("diretivaDoTurno", () => {
	it("parada nao recebe diretiva", () => {
		expect(diretivaDoTurno("parar")).toBe("");
	});

	it("conversa proibe avancar a operacao e nao pede artefato", () => {
		expect(diretivaDoTurno("conversa")).toMatch(/asking, not ordering work/);
		expect(exigeArtefato("conversa")).toBe(false);
		expect(exigeArtefato("parar")).toBe(false);
		expect(exigeArtefato("acao")).toBe(true);
	});

	it("correcao declara que o prompt do operador vence o estado", () => {
		expect(diretivaDoTurno("correcao")).toMatch(/his message wins/);
	});
});

describe("estadoCompacto", () => {
	it("mantem so as linhas de estado da missao", () => {
		const bloco = [
			"MISSION (live state, read from disk every turn)",
			"target: bore.pub:16086",
			"objective: shell interativo no alvo",
			"phase: vetor",
			"findings: 308 (validated 291)",
			"latest findings:",
			"- [vetor ok] binario novo do htc",
			"CONTRACT",
			"- Record every fact the moment you learn it",
		].join("\n");
		const compacto = estadoCompacto(bloco);
		expect(compacto).toContain("target: bore.pub:16086");
		expect(compacto).toContain("phase: vetor");
		expect(compacto).not.toContain("CONTRACT");
		expect(compacto).not.toContain("latest findings");
	});
});
