// language: TypeScript, file: scripts/prova_fila.ts, runtime: bun
// Prova ponta a ponta: o prompt do operador aponta um arquivo, a fila absorve.
// Uso: bun run scripts/prova_fila.ts "<prompt>"   |   Get-Content p.txt -Raw | bun run ... -
import { readFileSync } from "node:fs";
import { absorverAlvos, blocoFila, ehLote, enquadrarTurno, proximoAlvo } from "../src/runtime/fila-alvos";

const arg = process.argv[2] ?? "";
const prompt = arg === "-" ? readFileSync(0, "utf8").trim() : arg.startsWith("@") ? readFileSync(arg.slice(1), "utf8").trim() : arg;
const absorcao = absorverAlvos(prompt);

console.log(
	JSON.stringify(
		{
			absorvidos: absorcao.absorvidos.length,
			citados: absorcao.citados.length,
			total: absorcao.total,
			lote: ehLote(absorcao),
			alvo: absorcao.alvo?.alvo,
			arquivos: absorcao.arquivos?.map((a) => ({ caminho: a.caminho, alvos: a.alvos.length })),
			texto: absorcao.texto,
			primeiros: absorcao.citados.slice(0, 3),
		},
		null,
		2,
	),
);
console.log("---- turno ----");
const vez = proximoAlvo() ?? absorcao.alvo;
console.log(enquadrarTurno(vez?.alvo ?? "", absorcao.texto, vez?.tentativas ?? 0));
console.log("---- cauda ----");
console.log(blocoFila());
