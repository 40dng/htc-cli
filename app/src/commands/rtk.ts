// language: TypeScript, file: src/commands/rtk.ts, runtime: bun/node
/**
 * htc rtk — compressao de saida de comando (rtk-ai/rtk) integrada ao HTC.
 *
 *   htc rtk            status: binario, versao, shims ativos, ganhos
 *   htc rtk shims      (re)gera os shims e mostra o PATH efetivo
 *   htc rtk gain       dashboard de economia do rtk
 *
 * O boot do HTC ja chama `prepararPath()`: com o binario instalado, `ls`, `cat`,
 * `grep`, `git` e runners saem comprimidos sem o modelo saber. `HTC_RTK=off`
 * desliga; `HTC_RTK_BIN=<caminho>` aponta um binario fora do PATH.
 */
import {
	binarioRtk,
	ganhos,
	rtkLigado,
} from "../utils/rtk";

export interface RtkOptions {
	args?: string[];
}

export async function runRtk(opts: RtkOptions = {}): Promise<number> {
	const verbo = (opts.args ?? [])[0]?.trim().toLowerCase();
	const bin = binarioRtk();

	if (verbo === "gain") {
		if (!bin) {
			console.error("rtk nao instalado: winget install rtk-ai.rtk");
			return 1;
		}
		console.log(ganhos() ?? "(sem dados)");
		return 0;
	}

	const ligado = rtkLigado();
	console.log(`rtk: ${bin ? bin : "NAO INSTALADO"}`);
	console.log(`regra no prompt: ${ligado ? "ligada" : bin ? "desligada (HTC_RTK=off)" : "inativa"}`);
	const resumo = ganhos();
	if (resumo) console.log(`\n${resumo}`);
	if (!bin) {
		console.log("\ninstalar: winget install rtk-ai.rtk");
	} else {
		console.log("\nuso pelo agente: rtk ls <dir> | rtk read <arquivo> | rtk grep <padrao> <dir> | rtk git status");
		console.log("nunca em recon (nmap/nuclei/ffuf/httpx): a saida tem que ficar verbatim.");
	}
	return 0;
}
