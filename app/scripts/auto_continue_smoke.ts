/**
 * Smoke do auto-continue (o vitest nao esta instalado neste ambiente).
 * Roda com: bun run scripts/auto_continue_smoke.ts
 */
import {
	decidirContinuacao,
	descreverContinuacao,
	MAX_AUTO_CONTINUES_PADRAO,
	pedeDecisaoHumana,
	PROMPT_CONTINUACAO,
	temMarcadorTerminal,
} from "../src/runtime/auto-continue";
import {
	instrucao_galhos,
	MAX_LINHAS_RELATORIO_PADRAO,
	resolver_politica_agentes,
	tarefa_do_galho,
} from "../src/runtime/subagent-policy";

let falhas = 0;
function check(nome: string, esperado: unknown, obtido: unknown) {
	const ok = JSON.stringify(esperado) === JSON.stringify(obtido);
	if (!ok) {
		falhas += 1;
	}
	console.log(`${ok ? "ok  " : "FALHA"} ${nome} -> ${JSON.stringify(obtido)}`);
}

const board = "Board: 12 verificados. Resta IONOS e 55 dominios. Prossigo.";

check("board continua", { continuar: true }, decidirContinuacao(board, 0));
check("marcador [FIM] para", { continuar: false, motivo: "terminal" }, decidirContinuacao("acabou [FIM]", 0));
check("pergunta para", { continuar: false, motivo: "pergunta" }, decidirContinuacao("Sigo ou paro?", 0));
check("teto para", { continuar: false, motivo: "teto" }, decidirContinuacao(board, MAX_AUTO_CONTINUES_PADRAO));
check("desligado para", { continuar: false, motivo: "desligado" }, decidirContinuacao(board, 0, { enabled: false }));
check("vazio para", { continuar: false, motivo: "vazio" }, decidirContinuacao("", 0));
check("marker custom", true, temMarcadorTerminal("acabou [[STOP]]", ["[[STOP]]"]));
check("[FIM] lowercase", true, temMarcadorTerminal("acabou [fim]"));
check("board sem ask", false, pedeDecisaoHumana("Sigo no proximo lote agora."));
check("pergunta longa nao conta", false, pedeDecisaoHumana(`Fiz tudo. ${"d x ".repeat(120)}?`));
check("texto do loop", "[auto-continue] turno 3/25 — retomando a fila", descreverContinuacao(3, 25));
check("prompt tem marcador terminal", true, PROMPT_CONTINUACAO.includes("[FIM]"));

// --- politica de galhos ---
const yolo = resolver_politica_agentes("yolo");
check("agentes ligados no yolo", true, yolo.enabled);
check("agentes desligaveis", false, resolver_politica_agentes("yolo", false).enabled);
check("agentes ligaveis no act", true, resolver_politica_agentes("act", true).enabled);
check("teto de relatorio", MAX_LINHAS_RELATORIO_PADRAO, yolo.maxReportLines);

const instr = instrucao_galhos(yolo);
check("instrucao menciona GALHOS", true, instr.includes("GALHOS"));
check("instrucao tem o gate", true, instr.includes("GATE DE REGISTRO"));
check("instrucao proibe arvore nova", true, instr.includes("in-process"));
check("instrucao tem 7 regras", true, instr.split("\n").filter((l) => /^\d\./.test(l)).length === 7);
check("instrucao cita teto de linhas", true, instr.includes(String(MAX_LINHAS_RELATORIO_PADRAO)));
check("gate desligado muda a regra 3", true, instrucao_galhos({ ...yolo, gateObrigatorio: false }).includes("REGISTRO recomendado"));

const t = tarefa_do_galho("o alvo responde sem auth?", "200 com JSON", "subir finding");
check("tarefa traz pergunta", true, t.includes("PERGUNTA"));
check("tarefa traz gate", true, t.includes("grave todo achado"));
check("tarefa traz proximo elo", true, t.includes("PROXIMO ELO"));

console.log(falhas === 0 ? "\nSMOKE OK" : `\nSMOKE COM ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
