// Embute uma arte .txt como modulo TS (o binario compilado nao le arquivo solto).
import { readFileSync, writeFileSync } from "node:fs";

const origem = process.argv[2];
if (!origem) {
	console.error("uso: bun scripts/peixe.mjs <arquivo.txt> [saida.ts]");
	process.exit(1);
}
const saida = process.argv[3] ?? "src/tui/assets/peixe.ts";

const linhas = readFileSync(origem, "utf8")
	.replace(/\r/g, "")
	.split("\n")
	.filter((l) => l.trim().length > 0)
	.map((l) => l.replace(/\s+$/, ""));

const corpo = linhas.map((l) => `\t${JSON.stringify(l)},`).join("\n");
writeFileSync(
	saida,
	`// Arte embutida (gerada por scripts/peixe.mjs).\nexport const PEIXE = [\n${corpo}\n];\n`,
	"utf8",
);
console.log(`${saida}: ${linhas.length} linhas`);
