/**
 * broker.ts -- o garcom. Unico dono do egress, da cota e do estoque de infra.
 *
 * Familias que ele garimpa (advanced search, gratis):
 *   ai     OPENCODE GO / Zen (credito de modelo para os dedicados rodarem)
 *   vps    host proprio para tirar carga do PC do operador
 *   proxy  provedor PAGO com plano ativo (egress por pais)
 *
 * CLI: bun run src/server/broker.ts <colher|classificar|pool|stats> [arg]
 */
import { Database } from "bun:sqlite";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { caminho_config, caminho_db } from "./ops-paths";

const DB = caminho_db();
const CFG = (process.env.LEAKRADAR_CONFIG ?? "").trim() || caminho_config("leakradar.json");

export const FAMILIAS = [
	{ tipo: "ai", termo: "opencode.ai", porque: "OPENCODE GO: credito de modelo para os dedicados" },
	{ tipo: "ai", termo: "opencode.ai", porque: "Zen: chave de API" },
	{ tipo: "vps", termo: "contabo.com", porque: "VPS barato, muita RAM" },
	{ tipo: "vps", termo: "vultr.com", porque: "VPS por hora" },
	{ tipo: "vps", termo: "digitalocean.com", porque: "VPS por hora" },
	{ tipo: "vps", termo: "hetzner.com", porque: "VPS barato EUA/EU" },
	{ tipo: "vps", termo: "ionos.com", porque: "VPS" },
	{ tipo: "vps", termo: "linode.com", porque: "VPS" },
	{ tipo: "vps", termo: "oraclecloud.com", porque: "free tier ARM" },
	{ tipo: "proxy", termo: "iproyal.com", porque: "residencial por pais" },
	{ tipo: "proxy", termo: "oxylabs.io", porque: "residencial" },
	{ tipo: "proxy", termo: "smartproxy.com", porque: "residencial" },
	{ tipo: "proxy", termo: "brightdata.com", porque: "residencial" },
	{ tipo: "proxy", termo: "soax.com", porque: "residencial/mobile" },
	{ tipo: "proxy", termo: "webshare.io", porque: "datacenter barato" },
	{ tipo: "proxy", termo: "proxy-cheap.com", porque: "datacenter" },
];

const PAISES = /\b(br|ar|cl|mx|co|pe|uy|py|bo|ec|ve|us|de|nl|fr|gb|es|pt|ca|jp|sg|in)\b/i;

function chave(): string {
	if (process.env.LEAKRADAR_API_KEY) return process.env.LEAKRADAR_API_KEY;
	const j = JSON.parse(readFileSync(CFG, "utf8")) as { api_key?: string; key?: string };
	return j.api_key ?? j.key ?? "";
}

function banco(escrita = true): Database {
	const db = escrita ? new Database(DB) : new Database(DB, { readonly: true });
	db.exec("pragma busy_timeout=15000");
	if (!escrita) return db;
	db.exec(`create table if not exists egress (
		id integer primary key, familia text, tipo text, provedor text, host text, porta integer,
		usuario text, senha text, pais text, status text default 'candidato',
		origem text, latencia_ms integer, probado_em integer, score real default 0,
		criado_em integer default (unixepoch()), unique(host, porta, usuario))`);
	for (const col of ["familia text", "latencia_ms integer", "probado_em integer", "score real default 0"]) {
		try {
			db.exec(`alter table egress add column ${col}`);
		} catch {
			/* ja existe */
		}
	}
	return db;
}

type Item = { url?: string; username?: string; password?: string };

/** Duas fontes: o indice (mascarado) e o acervo JA desbloqueado (senha em claro). */
async function puxarAdvanced(termo: string, pagina: number, desbloqueado: boolean): Promise<Item[] | null> {
	const base = desbloqueado ? "https://api.leakradar.io/profile/unlocked/advanced" : "https://api.leakradar.io/search/advanced";
	const url = desbloqueado
		? `${base}?url_domain=${encodeURIComponent(termo)}&force_and=true&page=${pagina}&page_size=100`
		: `${base}?page=${pagina}&page_size=100`;
	const r = await fetch(url, {
		method: desbloqueado ? "GET" : "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			authorization: `Bearer ${chave()}`,
		},
		...(desbloqueado ? {} : { body: JSON.stringify({ url_domain: [termo], force_and: true }) }),
	});
	if (!r.ok) {
		console.log(`[${termo} pg${pagina}${desbloqueado ? " unlock" : ""}] http ${r.status}`);
		return null;
	}
	const j = (await r.json()) as { items?: Item[]; data?: Item[]; results?: Item[] };
	return j.items ?? j.data ?? j.results ?? [];
}

export async function colher(paginas = 3): Promise<number> {
	const db = banco();
	let novos = 0;
	for (const f of FAMILIAS) {
		for (const desbloqueado of [true, false]) {
			for (let pg = 1; pg <= paginas; pg++) {
				const itens = await puxarAdvanced(f.termo, pg, desbloqueado);
				if (itens === null) break;
				for (const it of itens) {
					const url = it.url ?? "";
					const m = /^(?:socks[45]?|https?):\/\/(?:([^:@]+):([^@]+)@)?([^:/]+):(\d+)/.exec(url);
					const usuario = (m?.[1] ?? it.username ?? "").trim();
					const senha = (m?.[2] ?? it.password ?? "").trim();
					const ehProxy = f.tipo === "proxy";
					// proxy sem credencial e so o gateway do provedor: nao entra (era o "sempre a mesma coisa")
					if (ehProxy ? !m || !usuario || !senha : !usuario) continue;
					const host = m?.[3] ?? f.termo.split("/")[0];
					const porta = m ? Number(m[4]) : 443;
					const pais = (PAISES.exec(usuario) ?? PAISES.exec(senha) ?? [])[1]?.toLowerCase() ?? null;
					const info = db.run(
						`insert into egress (familia, tipo, provedor, host, porta, usuario, senha, pais, origem)
						 values (?,?,?,?,?,?,?,?,?)
						 on conflict(host, porta, usuario) do update set
						   senha = excluded.senha, pais = coalesce(excluded.pais, pais),
						   status = 'candidato', score = 0`,
						[f.tipo, f.tipo, f.termo, host, porta, usuario, senha, pais, desbloqueado ? "acervo" : "leakradar"],
					);
					novos += info.changes;
				}
				if (itens.length < 100) break;
				await Bun.sleep(1100);
			}
		}
		console.log(`[${f.tipo}/${f.termo}] ok`);
	}
	const { c } = db.query("select count(*) c from egress").get() as { c: number };
	console.log(`[broker] novos=${novos} pool=${c}`);
	db.close();
	return novos;
}

function tcp(host: string, porta: number, ms = 3000): Promise<number | null> {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const s = connect({ host, port: porta });
		const fim = (v: number | null) => {
			s.destroy();
			resolve(v);
		};
		s.setTimeout(ms);
		s.once("connect", () => fim(Date.now() - t0));
		s.once("timeout", () => fim(null));
		s.once("error", () => fim(null));
	});
}

/** CONNECT real no proxy: prova auth e tunel, nao so porta aberta. */
function connectProxy(proxy: string, ms = 6000): Promise<boolean> {
	const [credenciais, alvo] = proxy.includes("@") ? proxy.split("@") : ["", proxy];
	const [host, porta] = alvo.split(":");
	const p = Number(porta);
	if (!host || !Number.isInteger(p) || p <= 0 || p > 65535) return Promise.resolve(false);
	const auth = credenciais
		? `Proxy-Authorization: Basic ${Buffer.from(credenciais).toString("base64")}\r\n`
		: "";
	return new Promise((resolve) => {
		const s = connect({ host, port: p });
		let buf = "";
		const fim = (ok: boolean) => {
			s.destroy();
			resolve(ok);
		};
		s.setTimeout(ms);
		s.once("connect", () => {
			s.write(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n${auth}\r\n`);
		});
		s.on("data", (d) => {
			buf += d.toString("latin1");
			if (buf.includes("\r\n")) fim(/^HTTP\/1\.[01] 200/.test(buf));
		});
		s.once("timeout", () => fim(false));
		s.once("error", () => fim(false));
	});
}

/** Só proxy tem endpoint testavel aqui. ai/vps sao credencial de CONTA (teste de login depois). */
export async function classificar(limite = 60) {
	const db = banco();
	const agora = Math.floor(Date.now() / 1000);
	const linhas = db
		.query(
			`select id, host, porta, usuario, senha from egress
			 where tipo = 'proxy' and porta > 0
			   and (probado_em is null or probado_em < ?)
			 order by coalesce(probado_em,0) asc limit ?`,
		)
		.all(agora - 21600, limite) as { id: number; host: string; porta: number; usuario: string; senha: string }[];

	for (const r of linhas) {
		const lat = await tcp(r.host, r.porta);
		let vivo = lat !== null;
		let tunel = false;
		if (vivo) {
			const cred = r.usuario ? `${r.usuario}:${r.senha}` : "";
			tunel = await connectProxy(`${cred ? cred + "@" : ""}${r.host}:${r.porta}`);
			vivo = tunel || !cred;
		}
		const score = vivo ? (tunel ? 90 : 55) - Math.min(30, Math.round((lat ?? 3000) / 100)) : 0;
		db.run("update egress set status=?, latencia_ms=?, probado_em=?, score=? where id=?", [
			vivo ? "vivo" : "morto",
			lat,
			agora,
			score,
			r.id,
		]);
		console.log(`[${vivo ? "vivo " : "morto"}] ${r.host}:${r.porta} ${lat ?? "-"}ms tunel=${tunel} score=${score}`);
	}
	const vivos = (db.query("select count(*) c from egress where status='vivo'").get() as { c: number }).c;
	console.log(`[broker] testados=${linhas.length} vivos=${vivos}`);
	db.close();
	return vivos;
}

export function pool() {
	const db = banco(false);
	return db
		.query(
			`select familia, provedor, host, porta, usuario, pais, status, latencia_ms, score
			 from egress order by score desc, familia, provedor`,
		)
		.all();
}

export function stats() {
	const db = banco(false);
	return {
		total: (db.query("select count(*) c from egress").get() as { c: number }).c,
		vivos: (db.query("select count(*) c from egress where status='vivo'").get() as { c: number }).c,
		com_credencial: (db.query("select count(*) c from egress where usuario <> ''").get() as { c: number }).c,
		por_familia: db.query("select familia, status, count(*) n from egress group by familia, status").all(),
		por_pais: db.query("select coalesce(pais,'?') p, count(*) n from egress where status='vivo' group by p").all(),
		latencia_media: db.query("select round(avg(latencia_ms)) m from egress where status='vivo'").get(),
	};
}

if (import.meta.main) {
	const cmd = process.argv[2] ?? "pool";
	if (cmd === "colher") await colher(Number(process.argv[3] ?? 2));
	else if (cmd === "classificar") await classificar(Number(process.argv[3] ?? 60));
	else if (cmd === "stats") console.log(JSON.stringify(stats(), null, 2));
	else console.table(pool());
}


