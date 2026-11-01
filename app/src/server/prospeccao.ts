// Prospeccao: websearch -> dominios de provedor -> sonda -> fila. Doutrina: entidade, controle, pacing.
import { Database } from "bun:sqlite";
import { caminhoDb } from "./fleet";
import { sondar } from "./probe";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IGNORAR = /wikipedia|reddit|quora|youtube|medium\.com|github|stackoverflow|trustpilot|g2\.com|capterra|guru99|hostadvice|websiteplanet|cloudflare|akamai|amazonaws|google|bing|facebook|twitter|x\.com|linkedin/;

/** DuckDuckGo HTML: devolve links em /l/?uddg=<url>. Sem JS, sem chave. */
async function buscar(termo: string, paginas = 1): Promise<string[]> {
	const out: string[] = [];
	for (let p = 0; p < paginas; p++) {
		const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(termo)}${p ? `&s=${p * 30}` : ""}`;
		try {
			const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15000) });
			const html = await r.text();
			for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
				const alvo = decodeURIComponent(m[1]!);
				const host = (() => {
					try {
						return new URL(alvo).hostname.replace(/^www\./, "");
					} catch {
						return "";
					}
				})();
				if (host && host.includes(".") && !IGNORAR.test(host) && !host.includes("duckduckgo")) out.push(host);
			}
		} catch {
			/* fonte caiu: segue */
		}
		await Bun.sleep(1200);
	}
	return [...new Set(out)];
}

export type Achado = { dominio: string; score: number; form: boolean; captcha: boolean; status: number };

export async function prospectar(termos: string[], limitePorTermo = 8) {
	const db = new Database(caminhoDb());
	db.exec("pragma busy_timeout=10000");
	const conhecidos = new Set((db.query("select domain from domains").all() as { domain: string }[]).map((x) => x.domain.toLowerCase()));

	const resultado: { termo: string; candidatos: number; sondados: Achado[]; enfileirados: number }[] = [];

	for (const termo of termos) {
		const hosts = (await buscar(termo, 1)).filter((h) => !conhecidos.has(h));
		const amostra = hosts.slice(0, limitePorTermo);
		const sondados: Achado[] = [];
		for (const h of amostra) {
			const s = await sondar(h, true);
			sondados.push({ dominio: h, score: s.score, form: s.form, captcha: s.captcha, status: s.status });
			await Bun.sleep(300);
		}
		sondados.sort((a, b) => b.score - a.score);

		let enf = 0;
		for (const s of sondados.filter((x) => x.score >= 40)) {
			try {
				db.run("insert into domains (domain, priority, scope, state) values (?, ?, 'prospeccao', 'seeded') on conflict(domain) do nothing", [s.dominio, 60 + Math.min(30, s.score)]);
				const tem = db.query("select id from tasks where domain = ? and phase = 'recon' and status = 'pending'").get(s.dominio);
				if (!tem) {
					db.run("insert into tasks (domain, phase, role, title, priority, status) values (?, 'recon', 'recon', ?, ?, 'pending')", [
						s.dominio,
						`prospeccao: form=${s.form} captcha=${s.captcha} score=${s.score}`,
						60 + Math.min(30, s.score),
					]);
					enf++;
				}
			} catch {
				/* schema: segue */
			}
		}
		resultado.push({ termo, candidatos: hosts.length, sondados, enfileirados: enf });
	}
	db.close();
	return resultado;
}

if (import.meta.main) {
	const termos = process.argv.slice(2);
	const r = await prospectar(termos.length ? termos : ["vps hosting provider", "proxy service provider"]);
	for (const t of r) {
		console.log(`\n== ${t.termo}  candidatos=${t.candidatos} enfileirados=${t.enfileirados}`);
		for (const s of t.sondados) console.log(`  ${String(s.score).padStart(3)} ${s.dominio.padEnd(28)} form=${s.form ? "S" : "n"} captcha=${s.captcha ? "S" : "n"} ${s.status}`);
	}
}
