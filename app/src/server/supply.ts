// Cadeia de suprimento: o que falta (ai/vps/proxy), quem pode nos dar, e o que invadir agora.
// Leitura pura do banco: nao dispara nada. O plano vira task para o runner.
import { Database } from "bun:sqlite";
import { caminhoDb } from "./fleet";

export type Tipo = "ai" | "proxy" | "vps";

/** Necessidade por tipo: alvo operacional (frota de agentes) menos o que temos vivo. */
export const ALVO: Record<Tipo, number> = { ai: 10, proxy: 40, vps: 30 };

function db() {
	const d = new Database(caminhoDb());
	d.exec("pragma busy_timeout=10000");
	return d;
}

export function necessidades() {
	const d = db();
	const linhas = d.query("select tipo, status, count(*) n from egress group by tipo, status").all() as { tipo: string; status: string; n: number }[];
	d.close();
	const por: Record<string, { vivos: number; total: number }> = {};
	for (const l of linhas) {
		const t = (por[l.tipo] ??= { vivos: 0, total: 0 });
		t.total += l.n;
		if (l.status === "vivo") t.vivos += l.n;
	}
	return (Object.keys(ALVO) as Tipo[]).map((tipo) => {
		const vivos = por[tipo]?.vivos ?? 0;
		return { tipo, vivos, alvo: ALVO[tipo], falta: Math.max(0, ALVO[tipo] - vivos), total: por[tipo]?.total ?? 0 };
	});
}

export type Fornecedor = { alvo: string; tipo: Tipo; motivo: string; score: number };

/**
 * Quem, na frota, tem cara de fornecer infra: dominios que ja entregaram credencial
 * de provedor (vps/proxy) ou chave de IA. Score = sinal medido, nao palpite.
 */
export function fornecedores(limite = 40): Fornecedor[] {
	const d = db();
	const out: Fornecedor[] = [];
	const vistos = new Set<string>();

	const marcas: { re: RegExp; tipo: Tipo; peso: number; motivo: string }[] = [
		{ re: /iproyal|smartproxy|oxylabs|brightdata|rayobyte|webshare|soax|proxy-cheap/i, tipo: "proxy", peso: 40, motivo: "provedor de proxy pago" },
		{ re: /vultr|digitalocean|linode|contabo|hetzner|ovh|ionos|scaleway|kamatera|hostinger|aws\.amazon|azure|gcp/i, tipo: "vps", peso: 40, motivo: "provedor de VPS/cloud" },
		{ re: /openai|anthropic|openrouter|groq|together|deepseek|x\.ai|google.*ai|gemini/i, tipo: "ai", peso: 40, motivo: "provedor de modelo" },
	];

	const fontes = d
		.query(
			`select f.domain, f.title, f.category, f.status, f.evidence_json
			 from findings f
			 where f.status in ('validated','exploitable','new')
			 order by case f.status when 'exploitable' then 0 when 'validated' then 1 else 2 end, f.id desc
			 limit 4000`,
		)
		.all() as { domain: string; title: string; category: string; status: string; evidence_json: string | null }[];

	for (const f of fontes) {
		if (vistos.has(f.domain)) continue;
		// a identidade do fornecedor e o DOMINIO do alvo, nao uma mencao no texto
		// (citar "iproyal" numa evidencia nao torna o alvo um provedor)
		for (const m of marcas) {
			if (!m.re.test(f.domain)) continue;
			vistos.add(f.domain);
			const bonus = f.status === "exploitable" ? 30 : f.status === "validated" ? 15 : 0;
			out.push({ alvo: f.domain, tipo: m.tipo, motivo: `${m.motivo} · ${f.title.slice(0, 60)}`, score: m.peso + bonus });
			break;
		}
	}

	// credencial de provedor ja colhida aponta para o alvo de onde ela veio
	const creds = d
		.query(
			`select origem, tipo, count(*) n from egress
			 where status = 'vivo' and origem like 'finding:%'
			 group by origem, tipo having n > 0 order by n desc limit 200`,
		)
		.all() as { origem: string; tipo: string; n: number }[];
	for (const c of creds) {
		const alvo = c.origem.replace("finding:", "");
		if (vistos.has(alvo)) continue;
		vistos.add(alvo);
		out.push({ alvo, tipo: c.tipo as Tipo, motivo: `${c.n} credencial(is) viva(s) deste alvo`, score: 25 + c.n });
	}

	d.close();
	return out.sort((a, b) => b.score - a.score).slice(0, limite);
}

/** Plano: onde caçar cada tipo que falta. Cross: o que falta x quem pode dar. */
export function plano(limite = 20) {
	const falta = necessidades().filter((x) => x.falta > 0);
	const cand = fornecedores(200);
	const out: { tipo: Tipo; alvo: string; motivo: string; score: number; falta: number }[] = [];
	for (const f of falta) {
		for (const c of cand.filter((x) => x.tipo === f.tipo)) {
			out.push({ tipo: f.tipo, alvo: c.alvo, motivo: c.motivo, score: c.score, falta: f.falta });
		}
	}
	return out.sort((a, b) => b.score - a.score).slice(0, limite);
}

if (import.meta.main) {
	console.log("== necessidade ==");
	for (const x of necessidades()) console.log(`${x.tipo.padEnd(6)} vivos ${String(x.vivos).padStart(3)} / alvo ${x.alvo}   falta ${x.falta}`);
	console.log("\n== plano de caca ==");
	for (const p of plano(20)) console.log(`${p.tipo.padEnd(6)} ${String(p.score).padStart(3)}  ${p.alvo.padEnd(30)} ${p.motivo.slice(0, 70)}`);
}
