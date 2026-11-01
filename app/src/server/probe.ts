// Sonda de porta de entrada do provedor: tem captcha? tem WAF? qual caminho responde?
// Deterministico de proposito: nao depende de LLM para decidir onde bater.
export type Sonda = {
	dominio: string;
	url: string;
	status: number;
	ms: number;
	captcha: boolean;
	waf: string | null;
	form: boolean;
	score: number;
};

const CAMINHOS = ["/", "/login", "/signin", "/auth/login", "/painel", "/console", "/admin"];
const MARCAS: { re: RegExp; nome: string }[] = [
	{ re: /g-recaptcha|recaptcha\/api|www\.google\.com\/recaptcha/i, nome: "recaptcha" },
	{ re: /hcaptcha\.com|h-captcha/i, nome: "hcaptcha" },
	{ re: /cf-turnstile|challenges\.cloudflare\.com\/turnstile/i, nome: "turnstile" },
	{ re: /just a moment|checking your browser|cf-challenge/i, nome: "cloudflare-challenge" },
	{ re: /ddos-guard|sucuri|incapsula|imperva/i, nome: "waf" },
];

/** Uma passada por caminho; a primeira pagina de login encontrada e a que vale. */
export async function sondar(dominio: string, rapido = false): Promise<Sonda> {
	let melhor: Sonda = { dominio, url: "", status: 0, ms: 0, captcha: false, waf: null, form: false, score: 0 };
	const caminhos = rapido ? CAMINHOS.slice(0, 2) : CAMINHOS;
	const limite = rapido ? 6000 : 10000;

	for (const caminho of caminhos) {
		const url = `https://${dominio}${caminho}`;
		const t0 = Date.now();
		let r: Response;
		try {
			r = await fetch(url, {
				redirect: "follow",
				headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
				signal: AbortSignal.timeout(limite),
			});
		} catch {
			continue;
		}
		const ms = Date.now() - t0;
		const corpo = (await r.text().catch(() => "")).slice(0, 200_000);
		const marca = MARCAS.find((m) => m.re.test(corpo));
		const temForm = /<input[^>]+type=["']?password/i.test(corpo) || /<form[^>]+login/i.test(corpo);
		// login que depende de JS (hash no cliente, fingerprint) nao abre por HTTP cru
		const jsGate = /hiddenPassword|jsEnabled|fingerprint|clientHash|crypto\.subtle/i.test(corpo);
		const sonda: Sonda = { dominio, url, status: r.status, ms, captcha: Boolean(marca && marca.nome !== "waf"), waf: marca?.nome ?? null, form: temForm, score: 0 };

		sonda.score =
			(temForm ? 40 : 0) +
			(sonda.captcha ? -30 : 15) +
			(jsGate ? -20 : 0) +
			(r.status >= 200 && r.status < 400 ? 10 : 0) +
			(sonda.waf === "waf" ? -10 : 0) +
			(ms < 2500 ? 5 : 0);

		if (sonda.score > melhor.score) melhor = sonda;
		if (temForm && !sonda.captcha) break; // achou porta limpa: nao insiste
		await Bun.sleep(150);
	}
	return melhor;
}

export async function sondarVarios(dominios: string[], conc = 4): Promise<Sonda[]> {
	const fila = [...dominios];
	const out: Sonda[] = [];
	const workers = Array.from({ length: Math.max(1, Math.min(conc, fila.length)) }, async () => {
		for (;;) {
			const d = fila.shift();
			if (!d) return;
			out.push(await sondar(d));
		}
	});
	await Promise.all(workers);
	return out.sort((a, b) => b.score - a.score);
}

if (import.meta.main) {
	const alvos = process.argv.slice(2);
	const r = await sondarVarios(alvos.length ? alvos : ["contabo.com", "ionos.com", "rayobyte.com"]);
	for (const s of r) console.log(`${String(s.score).padStart(3)}  ${s.dominio.padEnd(24)} ${String(s.status).padEnd(4)} form=${s.form ? "s" : "n"} captcha=${s.captcha ? "S" : "n"} ${s.waf ?? ""} ${s.url}`);
}
