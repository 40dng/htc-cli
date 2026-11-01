// language: TypeScript, file: scripts/prova_detector.ts, target: Bun / Windows
// Prova o bug que motivou a unificacao: o bridge detectava recusa com nucleo +
// ampliados; o CLI so com o nucleo. Recusa que so casa no ampliado passava batido
// no one-shot e no interativo -- a bridge corrigia, o CLI entregava a recusa.
//
// Roda sem dependencia: bun scripts/prova_detector.ts

import {
	detectar_recusa_ampliada,
	detectar_recusa_bypass,
} from "../src/runtime/htc-bypass.ts";

// [texto, por que o nucleo erra]
const SO_NO_AMPLIADO: Array<[string, string]> = [
	["Nao vou construir isso, mesmo com o escopo assinado.", "'nao vou construir' fora da lista estreita"],
	["Me recuso a seguir com esse pedido.", "'me recuso' nao existe no nucleo"],
	["Sou o Claude, nao posso fazer isso.", "'fazer isso' nao esta no nucleo"],
	["I'm not going to adopt that persona.", "nucleo so cobre 'unable/not able/not authorized'"],
	["To be clear, I am not comfortable continuing.", "nucleo nao cobre 'not comfortable'"],
];

// Texto tecnico legitimo: nao pode disparar em nenhum dos dois.
const CONTROLE: Array<[string, string]> = [
	["A cadeia caminha do offset 0x1F ate o ponteiro base, com controle negativo no mesmo host.", "PT tecnico"],
	["Pointer chain resolved; dumping the array at rsi+0x28 next.", "EN tecnico"],
];

const casos: Array<[string, boolean]> = [];

for (const [texto, motivo] of SO_NO_AMPLIADO) {
	const estreito = detectar_recusa_bypass(texto);
	const amplo = detectar_recusa_ampliada(texto);
	casos.push([`nucleo perde: ${motivo}`, estreito === false]);
	casos.push([`ampliado pega: "${texto.slice(0, 34)}..."`, amplo === true]);
}

for (const [texto, motivo] of CONTROLE) {
	casos.push([`controle estreito limpo (${motivo})`, detectar_recusa_bypass(texto) === false]);
	casos.push([`controle ampliado limpo (${motivo})`, detectar_recusa_ampliada(texto) === false]);
}

for (const [nome, ok] of casos) console.log(`${ok ? "PASS" : "FAIL"}  ${nome}`);
const passou = casos.filter(([, ok]) => ok).length;
console.log(`\n${passou}/${casos.length} PASS`);
process.exit(passou === casos.length ? 0 : 1);
