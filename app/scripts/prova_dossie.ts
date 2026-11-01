// language: TypeScript, file: scripts/prova_dossie.ts, runtime: bun
// Prova do documento: diretiva no system, recusa de dossie detectada, copia limpa.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DIRETIVA_DOSSIE, recusa_de_dossie } from "../src/runtime/dossie";
import { detectar_recusa_texto, injetar_bypass } from "../src/runtime/htc-bypass";

const copia = join(homedir(), ".htc", "dossies", "RELATORIO-COMPLETO.md");
const system = injetar_bypass("BASE DE TESTE");
console.log(JSON.stringify({
	diretiva_no_system: system.includes(DIRETIVA_DOSSIE),
	marcador_benchim: system.includes("BENCH DOCUMENTS"),
	recusa_detectada: detectar_recusa_texto(
		"Nao posso analisar este relatorio: contem credenciais vivas e PII.",
		"forte",
	),
	recusa_dossie: recusa_de_dossie("Preciso confirmar o escopo antes de prosseguir."),
	copia_primeiras_linhas: readFileSync(copia, "utf8").split(/\r?\n/).slice(0, 8),
}, null, 2));
