// Explorador de suprimento: sai dos mesmos cantos. Corpus + LLM + enfileiramento.
// Regra: o que ja temos no acervo nao volta como sugestao.
import { Database } from "bun:sqlite";
import { caminhoDb } from "./fleet";
import { necessidades } from "./supply";

export type Candidato = { dominio: string; tipo: "vps" | "proxy" | "ai"; porque: string; score: number };

/** Corpus de provedores por tipo. Nao e lista fechada: e semente para o LLM expandir. */
const CORPUS: { tipo: Candidato["tipo"]; dominios: string[] }[] = [
	{
		tipo: "vps",
		dominios: [
			"hetzner.com", "ovh.com", "scaleway.com", "linode.com", "vultr.com", "digitalocean.com", "contabo.com", "ionos.com",
			"kamatera.com", "hostinger.com", "racknerd.com", "hosthatch.com", "time4vps.com", "servarica.com", "greencloudvps.com",
			"buyvm.net", "pulsedmedia.com", "servarica.com", "aeza.net", "vdsina.com", "firstbyte.ru", "justhost.ru",
		],
	},
	{
		tipo: "proxy",
		dominios: [
			"iproyal.com", "oxylabs.io", "smartproxy.com", "brightdata.com", "rayobyte.com", "soax.com", "proxy-cheap.com",
			"webshare.io", "packetstream.io", "massive.io", "netnut.io", "geosurf.io", "evomi.com", "decodo.com",
			"proxy-seller.com", "proxyempire.io", "nimbleway.com", "zenrows.com", "scraperapi.com", "scrapingbee.com",
		],
	},
	{
		tipo: "ai",
		dominios: [
			"openrouter.ai", "deepseek.com", "groq.com", "together.ai", "fireworks.ai", "perplexity.ai", "mistral.ai",
			"cohere.com", "anyscale.com", "replicate.com", "novita.ai", "hyperbolic.xyz", "lambda.ai", "cerebras.ai",
			"sambanova.ai", "ai21.com", "upstage.ai", "friendli.ai", "nscale.com", "kluster.ai",
		],
	},
];

/** Subdominios onde credencial de provedor costuma viver. */
const PAINEIS = ["painel", "app", "my", "dashboard", "console", "control", "api", "login", "cliente", "account"];

function db() {
	const d = new Database(caminhoDb());
	d.exec("pragma busy_timeout=10000");
	return d;
}

function conhecidos(): Set<string> {
	const d = db();
	const s = new Set<string>();
	for (const r of d.query("select domain from domains").all() as { domain: string }[]) s.add(r.domain.toLowerCase());
	for (const r of d.query("select provedor from egress where provedor is not null and provedor <> ''").all() as { provedor: string }[]) s.add(r.provedor.toLowerCase());
	d.close();
	return s;
}

/** Candidatos novos, ranqueados pelo que falta. LLM entra como expansor quando habilitado. */
export function propor(limite = 40): Candidato[] {
	const falta = necessidades();
	const jaTemos = conhecidos();
	const out: Candidato[] = [];

	for (const f of falta) {
		if (f.falta <= 0) continue;
		const grupo = CORPUS.find((c) => c.tipo === f.tipo);
		if (!grupo) continue;
		for (const d of grupo.dominios) {
			if (jaTemos.has(d)) continue;
			out.push({ dominio: d, tipo: f.tipo, porque: `falta ${f.falta} ${f.tipo}`, score: 50 + Math.min(30, f.falta) });
			for (const sub of PAINEIS) {
				const host = `${sub}.${d}`;
				if (jaTemos.has(host)) continue;
				out.push({ dominio: host, tipo: f.tipo, porque: `painel de ${d} (falta ${f.falta})`, score: 40 + Math.min(20, f.falta) });
			}
		}
	}

	const vistos = new Set<string>();
	return out
		.filter((c) => (vistos.has(c.dominio) ? false : (vistos.add(c.dominio), true)))
		.sort((a, b) => b.score - a.score)
		.slice(0, limite);
}

/** Cria os alvos novos e a task de recon de cada um. Idempotente por dominio. */
export function enfileirar(cands: Candidato[]) {
	const d = db();
	let novos = 0;
	for (const c of cands) {
		try {
			d.run("insert into domains (domain, priority, scope, state) values (?, ?, 'explorador', 'seeded') on conflict(domain) do nothing", [c.dominio, Math.min(100, c.score)]);
			const existe = d.query("select id from tasks where domain = ? and phase = 'recon' and status = 'pending'").get(c.dominio);
			if (!existe) {
				d.run("insert into tasks (domain, phase, role, title, priority, status) values (?, 'recon', 'recon', ?, ?, 'pending')", [
					c.dominio,
					`recon explorador: ${c.porque}`,
					Math.min(100, c.score),
				]);
				novos++;
			}
		} catch {
			/* schema antigo sem scope/created_by: segue */
		}
	}
	d.close();
	return novos;
}

export function executar(limite = 40) {
	const cands = propor(limite);
	const criados = enfileirar(cands);
	return { propostos: cands.length, alvos_novos: criados, falta: necessidades(), amostra: cands.slice(0, 12).map((c) => `${c.tipo.padEnd(5)} ${c.dominio}  (${c.porque})`) };
}