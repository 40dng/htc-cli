// language: TypeScript, file: src/commands/correlacao.ts, runtime: bun/node
/**
 * htc correlacao — corpus dos achados, agrupado por host, mais o brief do turno.
 *
 *   htc correlacao                 grava ops/corpus.md + corpus.json e resume
 *   htc correlacao --digest        imprime o digest inteiro (host por host)
 *   htc correlacao --brief         imprime so o brief do turno de correlacao
 *   htc correlacao --json          imprime o corpus cru
 *   htc correlacao --sem-gravar    nao escreve no disco (so leitura)
 *
 * Nao ha tabela de CVE neste caminho: o corpus entrega componente, versao medida
 * e prevalencia por host; a CVE vem da pesquisa do turno.
 */
import {
	briefDeCorrelacao,
	carregarCorpus,
	type Corpus,
	digestDoCorpus,
	gravarCorpus,
	normalizarAlvo,
} from "../runtime/correlacao";

export interface CorrelacaoOptions {
	digest?: boolean;
	brief?: boolean;
	json?: boolean;
	/** Nao escreve `ops/corpus.md` / `ops/corpus.json`. */
	semGravar?: boolean;
	/** Recorta o corpus a um host (aceita URL, dominio com www ou host:porta). */
	host?: string;
}

/** Recorta o corpus a um host, comparando pela forma normalizada. */
export function recortarPorHost(corpus: Corpus, host: string): Corpus {
	const alvo = normalizarAlvo(host);
	if (!alvo) return corpus;
	const achados = corpus.achados.filter((a) => normalizarAlvo(a.host) === alvo);
	const hosts = corpus.hosts.filter((h) => normalizarAlvo(h) === alvo);
	return {
		...corpus,
		achados,
		hosts,
		porHost: corpus.porHost.filter((h) => normalizarAlvo(h.host) === alvo),
	};
}

export async function runCorrelacao(opcoes: CorrelacaoOptions = {}): Promise<number> {
	const gravado = opcoes.semGravar ? undefined : gravarCorpus();
	const bruto = gravado?.corpus ?? carregarCorpus();
	const corpus = opcoes.host ? recortarPorHost(bruto, opcoes.host) : bruto;

	if (opcoes.json) {
		console.log(JSON.stringify(corpus, null, 2));
		return 0;
	}
	if (opcoes.brief) {
		console.log(briefDeCorrelacao(corpus));
		return 0;
	}
	if (opcoes.digest) {
		console.log(digestDoCorpus(corpus));
		return 0;
	}

	console.log(`corpus: ${corpus.achados.length} achados em ${corpus.hosts.length} hosts`);
	if (gravado) {
		console.log(`  md    ${gravado.md}`);
		console.log(`  json  ${gravado.json}`);
	}

	for (const { host, achados, validados } of corpus.porHost) {
		console.log(
			`  ${host.padEnd(44)} ${String(achados).padStart(3)} achados  ${validados} validados`,
		);
	}
	if (corpus.hosts.length === 0) {
		if (opcoes.host) {
			const total = bruto.hosts.length;
			console.log(
				`host ${opcoes.host} nao esta no corpus (${total} hosts: ${bruto.hosts.join(", ") || "nenhum"})`,
			);
		} else {
			console.log("nenhum achado no disco: `htc missao achado ...` antes de correlacionar");
		}
		return 0;
	}
	console.log("\n`htc correlacao --digest` imprime tudo · `--brief` imprime o pedido do turno");
	return 0;
}
