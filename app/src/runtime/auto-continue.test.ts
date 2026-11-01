import { describe, expect, it } from "vitest";
import {
	contaTurnosSemMudanca,
	decidirContinuacao,
	estagnou,
	MAX_AUTO_CONTINUES_PADRAO,
	MAX_TURNOS_SEM_ESTADO,
	MARCADORES_TERMINAIS,
	montarPromptContinuacao,
	pedeDecisaoHumana,
	PROMPT_CONTINUACAO,
	TEXTO_LONGO,
	temMarcadorTerminal,
} from "./auto-continue";

describe("temMarcadorTerminal", () => {
	it("reconhece os marcadores padrao em qualquer caixa", () => {
		for (const m of MARCADORES_TERMINAIS) {
			expect(temMarcadorTerminal(`trabalho feito. ${m}`)).toBe(true);
			expect(temMarcadorTerminal(`trabalho feito. ${m.toLowerCase()}`)).toBe(
				true,
			);
		}
	});

	it("aceita marcador customizado", () => {
		expect(temMarcadorTerminal("acabou [[STOP]]", ["[[STOP]]"])).toBe(true);
	});

	it("texto vazio nao e terminal", () => {
		expect(temMarcadorTerminal("")).toBe(false);
		expect(temMarcadorTerminal("   ")).toBe(false);
	});

	it("board sem marcador NAO e terminal (o bug original)", () => {
		const board =
			"Relatorio: fiz A, B e C. Resta D e E. Proximo: sigo no lote.";
		expect(temMarcadorTerminal(board)).toBe(false);
	});
});

describe("pedeDecisaoHumana", () => {
	it("detecta pergunta no fim do turno", () => {
		expect(
			pedeDecisaoHumana("Terminei o lote. Executo o proximo ou paro?"),
		).toBe(true);
	});

	it("nao dispara sem interrogacao", () => {
		expect(pedeDecisaoHumana("Sigo no proximo lote agora.")).toBe(false);
	});

	it("nao dispara em bloco longo (nao e pergunta de decisao)", () => {
		const longa = `Fiz tudo. ${"detalhe ".repeat(80)}?`;
		expect(pedeDecisaoHumana(longa)).toBe(false);
	});
});

describe("decidirContinuacao", () => {
	const board = "Board: 12 verificados. Resta IONOS e 55 dominios. Prossigo.";

	it("continua quando o turno terminou em board", () => {
		expect(decidirContinuacao(board, 0)).toEqual({ continuar: true });
	});

	it("para no marcador terminal", () => {
		expect(decidirContinuacao("acabou [FIM]", 0)).toEqual({
			continuar: false,
			motivo: "terminal",
		});
	});

	it("interrogacao no fim NAO para o loop — decisao e do agente", () => {
		// Contrato atual: "?" e retorica em autonomia. So marcador explicito para.
		expect(decidirContinuacao("Sigo ou paro?", 0)).toEqual({ continuar: true });
		expect(decidirContinuacao("Sigo ou paro?", 1, { stopOnQuestion: true })).toEqual({
			continuar: false,
			motivo: "pergunta",
		});
	});

	it("para no marcador explicito de decisao humana", () => {
		expect(decidirContinuacao("preciso disso [AGUARDO OPERADOR]", 0)).toEqual({
			continuar: false,
			motivo: "pergunta",
		});
	});

	it("teto so existe quando e explicito", () => {
		// Default 0 = sem teto: iteracao alta nao e motivo de parada.
		expect(decidirContinuacao(board, MAX_AUTO_CONTINUES_PADRAO)).toEqual({ continuar: true });
		expect(decidirContinuacao(board, 2, { max: 2 })).toEqual({
			continuar: false,
			motivo: "teto",
		});
	});

	it("respeita o desligamento explicito", () => {
		expect(decidirContinuacao(board, 0, { enabled: false })).toEqual({
			continuar: false,
			motivo: "desligado",
		});
	});

	it("turno vazio nao gera loop", () => {
		expect(decidirContinuacao("", 0)).toEqual({
			continuar: false,
			motivo: "vazio",
		});
	});
});

describe("montarPromptContinuacao", () => {
	it("mantem o prefixo que identifica uma continuacao", () => {
		expect(montarPromptContinuacao(1)).toMatch(/^Continue\. /);
		expect(montarPromptContinuacao(1).startsWith(PROMPT_CONTINUACAO)).toBe(true);
	});

	it("muda de eixo a cada retomada (nunca o mesmo texto)", () => {
		const um = montarPromptContinuacao(1);
		const dois = montarPromptContinuacao(2);
		const tres = montarPromptContinuacao(3);
		expect(um).not.toBe(dois);
		expect(dois).not.toBe(tres);
		expect(um).toContain("[retomada 1]");
		expect(dois).toContain("[retomada 2]");
	});

	it("carrega o estado da missao quando o turno e da operacao", () => {
		const comMissao = montarPromptContinuacao(2, "MISSION (live state)");
		expect(comMissao).toContain("MISSION (live state)");
		expect(montarPromptContinuacao(2, "   ")).not.toContain("MISSION");
	});

	it("cita o pedido do operador e nao troca o pedido pela fila", () => {
		const prompt = montarPromptContinuacao(
			1,
			"MISSION (live state)",
			"corrige o htc-bypass.ts e roda os testes",
		);
		expect(prompt.startsWith(PROMPT_CONTINUACAO)).toBe(true);
		expect(prompt).toContain("[pedido do operador — referencia do assunto");
		expect(prompt).toContain("corrige o htc-bypass.ts");
		// A ordem fixa "proximo passo tecnico da fila" era o que fazia o modelo
		// largar o pedido e ir trabalhar o alvo.
		expect(PROMPT_CONTINUACAO).not.toContain("proximo passo tecnico da fila");
	});

	it("nao reenvia o pedido inteiro: recorta em 240 e marca o corte", () => {
		const longo = `${"palavra ".repeat(200)}FIM-DO-PEDIDO`;
		const prompt = montarPromptContinuacao(1, "", longo);
		expect(prompt).not.toContain("FIM-DO-PEDIDO");
		expect(prompt).toContain("…");
		const recorte = prompt.split("\n").find((linha) => linha.startsWith("palavra")) ?? "";
		expect(recorte.length).toBeLessThanOrEqual(241);
	});

	it("sem pedido do operador, o estado da missao entra como antes", () => {
		const prompt = montarPromptContinuacao(2, "MISSION (live state)");
		expect(prompt).toContain("MISSION (live state)");
		expect(prompt).not.toContain("[pedido do operador");
	});
});

describe("decidirContinuacao — turno sem entrega nao vira fila", () => {
	const respostaLonga = `Expliquei o desenho do modulo: ${"detalhe ".repeat(120)}`;

	it("resposta longa sem tool call nao retoma", () => {
		// Era o defeito: texto >= 400 contava como trabalho e o runtime emendava
		// "Continue. retome o proximo passo tecnico da fila" em cima de resposta a
		// pergunta fora da operacao.
		expect(
			decidirContinuacao(respostaLonga, 0, {
				houveTrabalho: false,
				assuntoDoTurno: "fora",
				intencaoOperador: "conversa",
			}),
		).toEqual({ continuar: false, motivo: "conversa" });
		expect(
			decidirContinuacao(respostaLonga, 0, {
				houveTrabalho: false,
				intencaoOperador: "correcao",
			}),
		).toEqual({ continuar: false, motivo: "sem-trabalho" });
	});

	it("tool call no turno retoma mesmo fora da operacao", () => {
		expect(
			decidirContinuacao("rodei o comando, saida no disco", 0, {
				houveTrabalho: true,
				assuntoDoTurno: "fora",
				intencaoOperador: "acao",
			}),
		).toEqual({ continuar: true });
	});
});

describe("guarda de estagnacao", () => {
	it("mesma assinatura e texto curto soma turnos sem progresso", () => {
		expect(contaTurnosSemMudanca("a", "a", 0, 20)).toBe(1);
		expect(contaTurnosSemMudanca("a", "a", 1, 20)).toBe(2);
	});
	it("assinatura nova zera o contador", () => {
		expect(contaTurnosSemMudanca("a", "b", 2, 20)).toBe(0);
	});
	it("texto longo conta como trabalho mesmo sem mudar estado", () => {
		expect(contaTurnosSemMudanca("a", "a", 2, TEXTO_LONGO)).toBe(0);
	});
	it("estagnou no limite", () => {
		expect(estagnou(MAX_TURNOS_SEM_ESTADO - 1)).toBe(false);
		expect(estagnou(MAX_TURNOS_SEM_ESTADO)).toBe(true);
	});
});
