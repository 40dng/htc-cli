// language: TypeScript, file: scripts/pivos.ts, runtime: Bun
// Mede os pivos do corpus real (state em ~/.htc/state). Uso:
//   bun app/scripts/pivos.ts
import { carregarCorpus, digestDoCorpus, pivosDoCorpus } from "../src/runtime/correlacao";

const corpus = carregarCorpus();
const pivos = pivosDoCorpus(corpus);
console.log(`achados=${corpus.achados.length} hosts=${corpus.hosts.length} pivos=${pivos.length}`);
for (const pivo of pivos.slice(0, 15)) {
	console.log(`${String(pivo.achados).padStart(2)}x  ${pivo.host}`);
}
const digest = digestDoCorpus(corpus);
console.log(`digest=${digest.length} chars  secao=${digest.includes("## Pivos") ? "sim" : "nao"}`);
