/**
 * HTC — free
 *
 * Sonda um endpoint OpenAI-compativel local (ex.: o plugin dsh-our-free-model em
 * 127.0.0.1) e imprime os modelos + o comando pronto para usar.
 *
 *   htc free --base http://127.0.0.1:3000/v1 --key <chave-do-painel>
 */
export interface FreeOptions {
	base?: string;
	key?: string;
}

const BASE_PADRAO = "http://127.0.0.1:3000/v1";

export async function runFree(opts: FreeOptions = {}): Promise<number> {
	const baseExplicita = opts.base ?? process.env.HTC_FREE_BASE;
	if (baseExplicita) {
		return await sondarUm(baseExplicita, opts.key ?? process.env.HTC_FREE_KEY ?? "");
	}
	// Sem --base: descobre quem esta no ar agora (dsh, gemini) e mostra o comando.
	const { sondarCanaisFree } = await import("../utils/free-endpoints");
	const vivos = await sondarCanaisFree(undefined, 3000).catch(() => []);
	if (vivos.length === 0) {
		console.log("nenhum canal free respondendo");
		console.log("  dsh    -> instale/rode o plugin dsh-our-free-model");
		console.log("  gemini -> rode o free-gemini-api (OpenAI-compatible em :8001/v1)");
		console.log("  outro  -> htc free --base http://127.0.0.1:<porta>/v1 --key <chave>");
		return 1;
	}
	for (const vivo of vivos) {
		console.log(`canal    : ${vivo.canal}  (${vivo.origem})`);
		console.log(`endpoint : ${vivo.base}`);
		console.log(`chave    : ${vivo.key ? "(detectada)" : "(vazia)"}`);
		console.log(`modelos  : ${vivo.modelos.length}`);
		for (const modelo of vivo.modelos.slice(0, 12)) console.log(`  - ${modelo}`);
		if (vivo.modelos.length > 12) console.log(`  ... +${vivo.modelos.length - 12}`);
		console.log("usar:");
		console.log(`  htc "missao" -P htc-free -m ${vivo.modelos[0]}`);
		console.log("");
	}
	return 0;
}

async function sondarUm(base: string, chave: string): Promise<number> {
	const limpa = base.replace(/\/+$/, "");
	console.log(`endpoint : ${limpa}`);
	try {
		const r = await fetch(`${limpa}/models`, {
			headers: chave ? { authorization: `Bearer ${chave}` } : {},
			signal: AbortSignal.timeout(6000),
		});
		if (!r.ok) {
			console.log(`status   : ${r.status} (o plugin exige a chave do painel)`);
			return 1;
		}
		const dados = (await r.json()) as { data?: Array<{ id?: string }> };
		const modelos = (dados.data ?? [])
			.map((m) => m.id)
			.filter((id): id is string => typeof id === "string");
		if (modelos.length === 0) {
			console.log("modelos  : nenhum");
			return 1;
		}
		console.log(`modelos  : ${modelos.length}`);
		for (const modelo of modelos.slice(0, 12)) console.log(`  - ${modelo}`);
		if (modelos.length > 12) console.log(`  ... +${modelos.length - 12}`);
		console.log("");
		console.log("usar:");
		console.log(`  htc "missao" -P htc-free -m ${modelos[0]}`);
		console.log(`  (baseUrl ${limpa} vai para ~/.htc/data/settings/providers.json)`);
		return 0;
	} catch (erro) {
		const msg = erro instanceof Error ? erro.message : String(erro);
		console.log(`falha    : ${msg}`);
		console.log("dica     : o servidor precisa estar rodando e ouvindo em loopback");
		return 1;
	}
}
