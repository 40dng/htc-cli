// Monitor LeakRadar: o acervo cresce sozinho. Contagem e gratis; unlock custa ponto.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { registrarEvento } from "./fleet";
import { caminho_config, caminho_estado } from "./ops-paths";

const BASE = "https://api.leakradar.io";
const ESTADO = caminho_estado("monitor.json");

type Fonte = { contagens: Record<string, { employees: number; customers: number; third_parties: number; total: number }>; em: number };

function chave(): string | null {
	const env = (process.env.LEAKRADAR_API_KEY ?? "").trim();
	if (env) return env;
	// sem caminho fixo: env, config local do HTC e o padrao do usuario
	const candidatos = [
		(process.env.LEAKRADAR_CONFIG ?? "").trim(),
		caminho_config("leakradar.json"),
		join(homedir(), ".config", "leakradar.json"),
	].filter((c) => c.length > 0);
	for (const cfg of candidatos) {
		try {
			if (!existsSync(cfg)) continue;
			const j = JSON.parse(readFileSync(cfg, "utf8")) as { api_key?: string };
			const k = (j.api_key ?? "").trim();
			if (k) return k;
		} catch {
			/* arquivo ilegivel: tenta o proximo */
		}
	}
	return null;
}

async function pedir<T>(caminho: string): Promise<T | null> {
	const k = chave();
	if (!k) return null;
	try {
		const r = await fetch(BASE + caminho, {
			headers: { authorization: `Bearer ${k}`, accept: "application/json" },
			signal: AbortSignal.timeout(15000),
		});
		if (!r.ok) return null;
		return (await r.json()) as T;
	} catch {
		return null;
	}
}

export async function perfil() {
	const k = chave();
	if (!k) return { ok: false, motivo: "sem chave LeakRadar (env LEAKRADAR_API_KEY)" };
	const p = await pedir<{ subscription_points?: number; extra_points?: number }>("/profile");
	if (!p) return { ok: false, motivo: "perfil recusado (chave invalida?)" };
	return { ok: true, pontos: (p.subscription_points ?? 0) + (p.extra_points ?? 0) };
}

type Contagem = { employees: number; customers: number; third_parties: number; total: number };

/** Contagem por dominio e gratuita: e o termometro do acervo. */
export async function contar(dominio: string): Promise<Contagem | null> {
	const r = await pedir<Record<string, unknown>>(`/search/domain/${encodeURIComponent(dominio)}`);
	if (!r) return null;
	const num = (v: unknown) => (typeof v === "number" ? v : 0);
	const employees = num(r.employees);
	const customers = num(r.customers);
	const third = num(r.third_parties);
	return { employees, customers, third_parties: third, total: num(r.total) || employees + customers + third };
}

function ler(): Fonte {
	try {
		if (existsSync(ESTADO)) return JSON.parse(readFileSync(ESTADO, "utf8")) as Fonte;
	} catch {
		/* estado corrompido: recomeca */
	}
	return { contagens: {}, em: 0 };
}

function salvar(f: Fonte) {
	mkdirSync(dirname(ESTADO), { recursive: true });
	writeFileSync(ESTADO, JSON.stringify(f, null, 1));
}

export type Novidade = { dominio: string; antes: number; agora: number; delta: number };

/** Varre os dominios e devolve o que CRESCEU desde a ultima passada. */
export async function monitorar(dominios: string[]) {
	if (!chave()) return { ok: false, motivo: "sem chave LeakRadar", novidades: [] as Novidade[] };
	const estado = ler();
	const novidades: Novidade[] = [];
	const falhas: string[] = [];
	for (const d of dominios.slice(0, 60)) {
		const c = await contar(d);
		if (!c) {
			falhas.push(d);
			continue;
		}
		const antes = estado.contagens[d]?.total ?? 0;
		const delta = c.total - antes;
		estado.contagens[d] = c;
		if (delta > 0 && antes > 0) {
			novidades.push({ dominio: d, antes, agora: c.total, delta });
			registrarEvento(d, "monitor", `+${delta} itens (${antes} -> ${c.total})`);
		}
		await Bun.sleep(120);
	}
	estado.em = Date.now();
	salvar(estado);
	return { ok: true, varridos: Object.keys(estado.contagens).length, novidades, falhas };
}

/** Dominios do acervo que ainda nao estao no monitor: primeiro termometro. */
export function dominiosDoAcervo(limite = 60): string[] {
	try {
		const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
		const { caminhoDb } = require("./fleet") as typeof import("./fleet");
		const d = new Database(caminhoDb());
		const linhas = d.query("select distinct host from egress where tipo in ('proxy','vps') and host like '%.%' limit ?").all(limite) as { host: string }[];
		d.close();
		return linhas.map((l) => l.host);
	} catch {
		return [];
	}
}

if (import.meta.main) {
	const perfilOk = await perfil();
	console.log("perfil:", JSON.stringify(perfilOk));
	const alvos = process.argv.slice(2);
	const r = await monitorar(alvos.length ? alvos : dominiosDoAcervo(20));
	console.log(JSON.stringify(r, null, 1));
}
