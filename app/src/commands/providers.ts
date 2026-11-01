/**
 * HTC — providers
 *
 * Lista e alterna os canais free locais (dsh e gemini):
 *   htc providers
 *   htc providers dsh on|off
 *   htc providers gemini on|off
 *   htc providers up
 */
import {
	definirFree,
	lerFree,
	type FreeState,
} from "../utils/free-state";
import { descobrirDsh } from "../utils/dsh";
import { diagnosticoFree, sondarCanaisFree } from "../utils/free-endpoints";

const NOMES: Record<keyof FreeState, string> = {
	dsh: "dsh         (forward do dsh-our-free-model)",
	gemini: "gemini      (free-gemini-api :8001/v1)",
};

export async function runProviders(args: {
	id?: string;
	acao?: string;
}): Promise<number> {
	const id = args.id?.trim().toLowerCase();
	const acao = args.acao?.trim().toLowerCase();

	// `htc providers up` — sobe os canais ligados agora (mesmo boot do HTC).
	if (id === "up") {
		const { subirCanaisFree } = await import("../utils/free-boot");
		const resultados = await subirCanaisFree();
		for (const r of resultados) {
			const detalhe = r.base ? ` ${r.base}` : r.erro ? ` (${r.erro})` : "";
			console.log(`${r.canal.padEnd(6)} ${r.estado}${detalhe}`);
		}
		// `sem-comando` e canal sem launcher instalado, nao canal quebrado:
		// so `falhou` merece codigo de erro. Exit 1 aqui viraria ruido em todo
		// `up` enquanto o plugin do dsh nao existir.
		const falhou = resultados.some((r) => r.estado === "falhou");
		// Subir a porta sem gravar o provider deixa a proxima sessao sem
		// `htc-free`. O boot do HTC grava; o subcomando tem de fazer o mesmo.
		try {
			const { escolherCanalFree } = await import("../utils/free-endpoints");
			const vivo = await escolherCanalFree(undefined, 2500);
			const base = (
				process.env.HTC_FREE_BASE?.trim() ||
				vivo?.base ||
				""
			).replace(/\/+$/, "");
			if (base) {
				const { ProviderSettingsManager } = await import("@cline/core");
				const manager = new ProviderSettingsManager();
				const { gravarProviderFree } = await import("../utils/free-models");
				await gravarProviderFree(manager, {
					base,
					chave: process.env.HTC_FREE_KEY?.trim() || vivo?.key || "",
					modelos: vivo?.modelos ?? [],
				});
				console.log(`htc-free ${base} modelos=${vivo?.modelos.length ?? 0}`);
				const { registrarProvidersCustom } = await import(
					"../utils/provider-registry"
				);
				await registrarProvidersCustom(manager);
			} else {
				console.log("htc-free sem canal vivo: nada gravado");
			}
		} catch (e) {
			console.error(`htc-free nao gravado: ${(e as Error).message}`);
			return 1;
		}
		return falhou ? 1 : 0;
	}

	if (id && acao) {
		if (!(id in NOMES)) {
			console.error(`provider free desconhecido: ${id} (use ${Object.keys(NOMES).join("|")})`);
			return 1;
		}
		if (acao !== "on" && acao !== "off") {
			console.error(`acao invalida: ${acao} (use on|off)`);
			return 1;
		}
		const estado = definirFree(id as keyof FreeState, acao === "on");
		console.log(`${id}: ${acao === "on" ? "ligado" : "desligado"}`);
		if (acao === "on") {
			// Ligar sem endpoint e mentira de estado: o canal entra na lista e o
			// primeiro turno morre em ECONNREFUSED sem dizer por que.
			const diag = diagnosticoFree().filter((l) => l.startsWith(`${id}:`));
			const semLastro = diag.some(
				(l) => l.includes("AUSENTE") || l.includes("SEM CHAVE"),
			);
			for (const linha of diag) console.log(`  ${linha}`);
			if (semLastro) {
				// Nao deixa o estado no disco mentindo "ligado": desfaz e sai 1.
				definirFree(id as keyof FreeState, false);
				console.log(
					"  sem endpoint: canal continua DESLIGADO (nada foi gravado)",
				);
				return 1;
			}
		}
		return 0;
	}

	const estado = lerFree();
	console.log("providers free (loopback: dsh e gemini)");
	// `off` e `quebrado` sao estados diferentes: desligado e sem lastro nao e
	// escolha do operador, e a tela antiga mostrava os dois como "off".
	const temChaveGemini = Boolean(
		process.env.GEMINI_API_KEY?.trim() ||
			process.env.GOOGLE_API_KEY?.trim() ||
			process.env.HTC_GEMINI_KEY?.trim(),
	);
	const lastro: Record<keyof FreeState, boolean> = {
		dsh: Boolean(descobrirDsh()),
		gemini: temChaveGemini,
	};
	for (const chave of Object.keys(NOMES) as Array<keyof FreeState>) {
		const ligado = estado[chave];
		const tem = lastro[chave];
		const marca = ligado ? (tem ? "on " : "on!") : tem ? "off" : "-- ";
		console.log(`  [${marca}] ${NOMES[chave]}`);
	}
	const vivos = await sondarCanaisFree(undefined, 2500).catch(() => []);
	console.log("");
	if (vivos.length === 0) {
		// A frase fala do que a sonda mediu, nao do que esta configurado: com
		// HTC_FREE_BASE setado existia canal e a tela dizia "nenhum".
		console.log("nenhum canal respondeu ao GET /models agora:");
		for (const linha of diagnosticoFree()) console.log(`  ${linha}`);
	} else {
		for (const vivo of vivos) {
			console.log(
				`${vivo.canal.padEnd(6)} ${vivo.base}  (${vivo.modelos.length} modelos) — ${vivo.origem}`,
			);
			for (const modelo of vivo.modelos.slice(0, 6)) console.log(`         - ${modelo}`);
		}
	}
	console.log("ligar: htc providers <dsh|gemini> on");
	return 0;
}
