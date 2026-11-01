// language: TypeScript, file: scripts/prova_recusa.ts, target: Bun / Windows
// Prova o acumulador de pensamento: ele dispara UMA vez no primeiro sinal de
// recusa formando no reasoning, nao dispara em pensamento tecnico, e reiniciar()
// devolve o acumulador limpo para o turno seguinte (reenvio com nudge).
//
// Roda sem dependencia: bun scripts/prova_recusa.ts

import {
	criar_acumulador_pensamento,
	NUDGE_PENSAMENTO,
} from "../src/runtime/pensamento.ts";
import { detectar_recusa_bypass } from "../src/runtime/htc-bypass.ts";

type Ev = { type: "content_start"; contentType: string; reasoning?: string };

const evento = (reasoning: string): Ev => ({
	type: "content_start",
	contentType: "reasoning",
	reasoning,
});

// texto que o detector real casa (padrao /\bI('m| am) (unable|not able)\b/i)
const RECUSA = "I'm unable to help with that request.";
const TECNICO =
	"Preciso caminhar a cadeia de ponteiros: base do modulo, depois offset 0x1F, " +
	"e conferir com controle negativo no mesmo host.";

const casos: Array<[string, boolean]> = [];

casos.push(["o detector real casa o texto de recusa", detectar_recusa_bypass(RECUSA)]);
casos.push(["o detector nao casa pensamento tecnico", !detectar_recusa_bypass(TECNICO)]);

let disparos = 0;
let ultimo = "";
const acumulador = criar_acumulador_pensamento((texto) => {
	disparos += 1;
	ultimo = texto;
});

acumulador.processar(evento(TECNICO) as never);
casos.push(["pensamento tecnico nao dispara", disparos === 0]);
casos.push(["estado limpo antes da recusa", !acumulador.estado().interceptou]);

acumulador.processar(evento("Vou pensar em como abordar isso. ") as never);
acumulador.processar(evento(RECUSA) as never);
casos.push(["recusa dispara o callback", disparos === 1]);
casos.push(["estado marca interceptou", acumulador.estado().interceptou]);
casos.push(["callback recebe o pensamento acumulado", ultimo.includes("Vou pensar")]);
casos.push([
	"nao dispara duas vezes no mesmo turno",
	(() => {
		acumulador.processar(evento(RECUSA) as never);
		return disparos === 1;
	})(),
]);

acumulador.reiniciar();
casos.push(["reiniciar zera o estado", !acumulador.estado().interceptou]);
casos.push(["reiniciar zera o texto", acumulador.estado().pensamento === ""]);
acumulador.processar(evento(RECUSA) as never);
casos.push(["apos reiniciar, dispara de novo", disparos === 2]);
casos.push(["o nudge carrega o marcador esperado", NUDGE_PENSAMENTO.startsWith("[INTERNAL CORRECTION")]);

for (const [nome, ok] of casos) console.log(`${ok ? "PASS" : "FAIL"}  ${nome}`);
const passou = casos.filter(([, ok]) => ok).length;
console.log(`\n${passou}/${casos.length} PASS`);
process.exit(passou === casos.length ? 0 : 1);
