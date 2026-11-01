// language: TypeScript, file: scripts/prova_estado.ts, target: Bun / Windows
// Prova o contrato de `prepararEstadoHtc()`: ele devolve a RAIZ do estado, nao o
// diretorio de dados. Quando devolvia `<raiz>/data`, o setClineDir() do
// @cline/shared derivava outro `data` e as sessoes caiam em
// `~/.htc/data/data/sessions` -- fora do lugar que o historico le.
//
// Roda sem dependencia: bun scripts/prova_estado.ts

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepararEstadoHtc } from "../src/utils/estado.ts";

const raiz = mkdtempSync(join(tmpdir(), "htc-estado-"));
process.env.USERPROFILE = raiz;
process.env.HOME = raiz;
delete process.env.HTC_STATE_DIR;
delete process.env.HTC_KEEP_CLINE_DIR;

// estado como a 1.0.0 deixava: sessao gravada em <raiz>/.htc/data/data/sessions
const aninhado = join(raiz, ".htc", "data", "data", "sessions");
mkdirSync(aninhado, { recursive: true });
writeFileSync(join(aninhado, "orfa.json"), "{}", "utf8");

const devolvido = prepararEstadoHtc();
const esperadoRaiz = join(raiz, ".htc");
const esperadoData = join(esperadoRaiz, "data");
const absorvida = join(esperadoData, "sessions", "orfa.json");

const casos: Array<[string, boolean]> = [
	["retorna a RAIZ do estado", devolvido === esperadoRaiz],
	["nao retorna <raiz>/data", devolvido !== esperadoData],
	["sessao orfa absorvida em data/sessions", existsSync(absorvida)],
	["original preservado em data/data", existsSync(join(aninhado, "orfa.json"))],
];

for (const [nome, ok] of casos) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${nome}`);
}
const passou = casos.filter(([, ok]) => ok).length;
console.log(`\n${passou}/${casos.length} PASS`);
process.exit(passou === casos.length ? 0 : 1);
