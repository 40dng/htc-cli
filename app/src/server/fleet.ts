import { Database } from "bun:sqlite";
import { caminho_db, caminho_estado } from "./ops-paths";

/** Caminho do banco da operacao. Sobrescreve com PMP_DB ou HTC_OPS_DIR. */
export function caminhoDb(): string {
	return caminho_db();
}

let dbCache: Database | null = null;
let dbPath = "";

export function abrir(): Database {
	const p = caminhoDb();
	if (dbCache && dbPath === p) return dbCache;
	dbCache = new Database(p, { readonly: true });
	dbPath = p;
	return dbCache;
}

export type LinhaFrota = {
	alvo: string;
	assets: number;
	endpoints: number;
	validados: number;
	exploitable: number;
	ultimo: number | null;
	estado: string;
};

/** Uma query agregada (sem N+1). 255 alvos, ordenado por validados. */
export function frota(limite = 255): LinhaFrota[] {
	const db = abrir();
	const sql = `
		select d.domain as alvo,
			(select count(*) from assets a where a.domain = d.domain) as assets,
			(select count(*) from endpoints e where e.domain = d.domain) as endpoints,
			(select count(*) from findings f where f.domain = d.domain
				and f.status in ('validated','exploitable','chained')) as validados,
			(select count(*) from findings f where f.domain = d.domain
				and f.status = 'exploitable') as exploitable,
			(select max(v.ts) from events v where v.domain = d.domain) as ultimo,
			coalesce(d.state, 'seeded') as estado
		from domains d
		where exists (select 1 from endpoints e where e.domain = d.domain)
		   or exists (select 1 from findings f where f.domain = d.domain)
		order by validados desc, exploitable desc, d.domain
		limit ?`;
	return db.query(sql).all(limite) as LinhaFrota[];
}

export function alvo(dominio: string) {
	const db = abrir();
	return {
		dominio,
		findings: db
			.query(
				`select status, confidence, title, category, evidence_json, created_at
				 from findings where domain = ?
				 order by case status when 'exploitable' then 0 when 'chained' then 0
				 when 'validated' then 1 else 2 end, confidence desc limit 80`,
			)
			.all(dominio),
		loot: db.query("select kind, path, notes, created_at from loot where domain = ? limit 60").all(dominio),
		eventos: db
			.query("select ts, kind, message from events where domain = ? order by ts desc limit 60")
			.all(dominio),
	};
}

export function fila() {
	const db = abrir();
	return db
		.query(
			`select id, domain, status, priority, attempts, lease_until, result_json, updated_at
			 from tasks where phase = 'dedicado' order by priority desc, id limit 120`,
		)
		.all();
}

export function aprovacoes() {
	const db = abrir();
	const tem = db
		.query("select name from sqlite_master where type='table' and name='approvals'")
		.get();
	if (!tem) return [];
	return db
		.query(
			`select id, dominio, tipo, resumo, criado_em, decidido_em, decisao
			 from approvals where decidido_em is null order by criado_em desc limit 50`,
		)
		.all();
}

export function decidir(id: number, decisao: string, por = "operador") {
	const db = new Database(caminhoDb());
	db.exec("pragma busy_timeout=8000");
	db.run("update approvals set decidido_em = unixepoch(), decisao = ?, por = ? where id = ?", [
		decisao,
		por,
		id,
	]);
	db.close();
	return { ok: true };
}

export function eventosDesde(ultimo: number) {
	const db = abrir();
	return db
		.query(
			`select id, ts, domain, kind, message from events where id > ? order by id limit 50`,
		)
		.all(ultimo ?? 0);
}

/** Ultimos N eventos: replay do /events e carga inicial do log no OPS. */
export function eventosRecentes(limite = 200) {
	// abrir() e singleton readonly: NUNCA fechar aqui (fechar derruba o resto do broker)
	const db = abrir();
	return db
		.query(`select id, ts, domain, kind, message from events order by id desc limit ?`)
		.all(Math.max(1, Math.min(1000, limite)))
		.reverse() as { id: number; ts: string; domain: string | null; kind: string; message: string }[];
}

/** Grava um evento do plano de controle (garimpo, dispatch, lease). */
export function registrarEvento(domain: string | null, kind: string, message: string) {
	const db = bancoEscrita();
	db.run("insert into events (domain, kind, message) values (?,?,?)", [domain, kind, message.slice(0, 800)]);
	const id = (db.query("select last_insert_rowid() i").get() as { i: number }).i;
	db.close();
	return { ok: true, id };
}


export function resumo() {
	const db = abrir();
	const q = (s: string) => (db.query(s).get() as { n: number }).n;
	return {
		alvos: q("select count(*) n from domains where exists (select 1 from endpoints e where e.domain = domains.domain)"),
		findings: q("select count(*) n from findings"),
		validados: q("select count(*) n from findings where status in ('validated','exploitable','chained')"),
		exploitable: q("select count(*) n from findings where status = 'exploitable'"),
		shells: q("select count(*) n from loot where kind = 'shell'"),
		credenciais: q("select count(*) n from credentials"),
		endpoints: q("select count(*) n from endpoints"),
	};
}

// ---------------------------------------------------------------- egress / lease

/** Pool do garcom (broker). Uma linha por CREDENCIAL, nao por gateway.
 *  O endpoint do provedor e constante por design; o que varia e a conta. */
export function egress() {
	const db = abrir();
	const tem = db.query("select name from sqlite_master where type='table' and name='egress'").get();
	if (!tem) return [];
	return db
		.query(
			`select tipo, provedor, host, porta, usuario, pais, status, familia,
			        latencia_ms, score, probado_em
			 from egress
			 order by case status when 'vivo' then 0 when 'candidato' then 1 else 2 end,
			          score desc, provedor, porta`,
		)
		.all();
}

/** Resumo por provedor: quantas contas, quantas vivas. */
export function egressResumo() {
	const db = abrir();
	const tem = db.query("select name from sqlite_master where type='table' and name='egress'").get();
	if (!tem) return [];
	return db
		.query(
			`select provedor,
			        count(*) contas,
			        sum(case when status='vivo' then 1 else 0 end) vivos,
			        sum(case when status='morto' then 1 else 0 end) mortos,
			        round(avg(case when status='vivo' then latencia_ms end)) latencia,
			        max(score) melhor
			 from egress group by provedor order by vivos desc, contas desc`,
		)
		.all();
}

// ---------------------------------------------------------------- capacidade

/** Acervo finito: cada tipo tem um teto. O garimpo repoe ate aqui, nao cresce sem fim. */
export const ALVO_CAPACIDADE: Record<string, number> = { proxy: 40, vps: 30, ai: 10 };

export type Capacidade = {
	tipo: string;
	alvo: number;
	total: number;
	vivos: number;
	em_uso: number;
	livres: number;
	mortos: number;
	taxa_ok: number;
	reposicao: number;
};

/** Capacidade por tipo: vivos, em uso (lease ativa), livres, atrito e quanto repor. */
export function capacidade(): Capacidade[] {
	const db = abrir();
	const tem = db.query("select name from sqlite_master where type='table' and name='egress'").get();
	if (!tem) return [];

	const emUso = new Map<string, number>();
	try {
		const ativos = db
			.query("select proxy, count(*) n from leases where expira_em > unixepoch() group by proxy")
			.all() as { proxy: string; n: number }[];
		for (const a of ativos) emUso.set(a.proxy, a.n);
	} catch {
		/* sem leases */
	}

	const base = db
		.query(
			`select coalesce(tipo,'?') tipo, count(*) total,
			        sum(case when status='vivo' then 1 else 0 end) vivos,
			        sum(case when status='morto' then 1 else 0 end) mortos
			 from egress group by tipo`,
		)
		.all() as { tipo: string; total: number; vivos: number; mortos: number }[];

	return base.map((b) => {
		// quantas contas vivas deste tipo ja estao presas em lease
		const vivas = db
			.query("select host, porta, usuario from egress where tipo = ? and status='vivo'")
			.all(b.tipo) as { host: string; porta: number; usuario: string }[];
		let presas = 0;
		for (const e of vivas) {
			const chave = `${e.usuario ? e.usuario + "@" : ""}${e.host}:${e.porta}`;
			if ((emUso.get(chave) ?? 0) > 0) presas++;
		}
		const alvo = ALVO_CAPACIDADE[b.tipo] ?? 20;
		const taxa = b.total > 0 ? b.vivos / b.total : 0;
		return {
			tipo: b.tipo,
			alvo,
			total: b.total,
			vivos: b.vivos,
			em_uso: presas,
			livres: Math.max(0, b.vivos - presas),
			mortos: b.mortos,
			taxa_ok: Number(taxa.toFixed(2)),
			reposicao: Math.max(0, alvo - b.vivos),
		};
	});
}

/** Ha egress livre para rodar? Falha fechado quando nao ha. */
export function alocarEgress(): { proxy: string | null; livre: boolean; motivo?: string } {
	const cap = capacidade();
	const proxy = cap.find((c) => c.tipo === "proxy");
	const vps = cap.find((c) => c.tipo === "vps");
	if (proxy && proxy.livres > 0) return { proxy: null, livre: true };
	if (vps && vps.livres > 0) return { proxy: null, livre: true };
	const detalhe = cap.map((c) => `${c.tipo} ${c.em_uso}/${c.vivos}`).join(" · ") || "acervo vazio";
	return { proxy: null, livre: false, motivo: `sem egress livre (${detalhe})` };
}

/** Monitoramento do LeakRadar: gasto local + o que o garimpo ja produziu. */
export function leakradar() {
	let gasto = { total: 0, last: null as string | null };
	try {
		gasto = JSON.parse(require("node:fs").readFileSync(caminho_estado("leak_spend.json"), "utf8"));
	} catch {
		/* ainda sem ledger */
	}

	const dominios: Array<{
		dominio: string;
		score: number;
		tipo: string;
		itens: number;
		com_senha: number;
		com_senha_entrada: number;
		hosts_entrada: string[];
	}> = [];
	try {
		const linhas = require("node:fs")
			.readFileSync(caminho_estado("creds_leads.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean);
		for (const l of linhas) {
			try {
				const d = JSON.parse(l);
				dominios.push({
					dominio: d.dominio,
					score: d.score ?? 0,
					tipo: d.tipo ?? "-",
					itens: d.itens ?? 0,
					com_senha: d.com_senha ?? 0,
					com_senha_entrada: d.com_senha_entrada ?? 0,
					hosts_entrada: d.hosts_entrada ?? [],
				});
			} catch {
				/* linha truncada por kill: descarta */
			}
		}
	} catch {
		/* sem ledger de dominios */
	}

	const comSenha = dominios.filter((d) => d.com_senha > 0).sort((a, b) => b.com_senha - a.com_senha);

	return {
		gasto,
		varridos: dominios.length,
		com_senha: comSenha.length,
		senhas_visiveis: dominios.reduce((s, d) => s + d.com_senha, 0),
		senhas_no_host_de_entrada: dominios.reduce((s, d) => s + d.com_senha_entrada, 0),
		top: [...dominios].sort((a, b) => b.score - a.score).slice(0, 30),
		com_senha_top: comSenha.slice(0, 30),
	};
}

function bancoEscrita() {
	const db = new Database(caminhoDb());
	db.exec("pragma busy_timeout=10000");
	db.exec(`create table if not exists leases (
		id integer primary key, host text not null, proxy text not null, pais text,
		dono text, criado_em integer default (unixepoch()), expira_em integer,
		custo_pts real default 0)`);
	db.exec("create index if not exists ix_leases_host on leases(host, expira_em)");
	return db;
}

/** Um host, uma sessao. Devolve a lease viva ou cria uma nova. */
export function pedirLease(host: string, dono = "dedicado", minutos = 40) {
	const db = bancoEscrita();
	const agora = Math.floor(Date.now() / 1000);
	db.run("delete from leases where expira_em < ?", [agora]);
	const viva = db
		.query("select host, proxy, dono, expira_em from leases where host = ? and expira_em > ?")
		.get(host, agora) as { host: string; proxy: string; dono: string; expira_em: number } | null;
	if (viva) {
		db.close();
		return { ok: true, novo: false, ...viva };
	}
	const prox = db
		.query(
			`select host, porta, usuario from egress
			 where status = 'vivo'
			 order by score desc, latencia_ms asc limit 1`,
		)
		.get() as { host: string; porta: number; usuario: string } | null;
	const proxy = prox ? `${prox.usuario ? prox.usuario + "@" : ""}${prox.host}:${prox.porta}` : "direto";
	db.run("insert into leases (host, proxy, dono, expira_em) values (?,?,?,?)", [
		host,
		proxy,
		dono,
		agora + minutos * 60,
	]);
	db.close();
	return { ok: true, novo: true, host, proxy, dono, expira_em: agora + minutos * 60 };
}

export function liberarLease(host: string) {
	const db = bancoEscrita();
	const n = db.run("delete from leases where host = ?", [host]).changes;
	db.close();
	return { ok: true, liberadas: n };
}

export function leases() {
	const db = abrir();
	const tem = db.query("select name from sqlite_master where type='table' and name='leases'").get();
	if (!tem) return [];
	return db.query("select host, proxy, dono, expira_em from leases order by expira_em desc").all();
}

// ---------------------------------------------------------------- dispatch

const agoraIso = () => new Date().toISOString();

/**
 * Enfileira um alvo para um agente DEDICADO.
 * O runner consome `tasks` com phase='dedicado'; o painel so escreve aqui.
 */
export function enfileirar(dominio: string, prompt: string, prioridade = 8) {
	const db = bancoEscrita();
	const agora = agoraIso();
	const payload = JSON.stringify({ prompt, origem: "painel", criado: agora });
	const r = db
		.run(
			`insert into tasks (domain, phase, role, title, payload_json, priority, status, created_at, updated_at)
			 values (?, 'dedicado', 'dedicado', ?, ?, ?, 'pending', ?, ?)`,
			[dominio, prompt.slice(0, 160), payload, prioridade, agora, agora],
		);
	const id = Number(r.lastInsertRowid);
	db.close();
	return { ok: true, id, dominio, prioridade, status: "pending" };
}

/** Dispara um alvo: task dedicada + lease de egress. E o botao do painel.
 *  Recusa duplicata (mesmo alvo pendente/rodando) e respeita o gate de fase. */
export function disparar(dominio: string, prompt: string, prioridade = 8, fase = "recon") {
	const db = bancoEscrita();

	const vivas = db
		.query("select count(*) n from tasks where domain = ? and phase = 'dedicado' and status in ('pending','running')")
		.get(dominio) as { n: number };
	if (vivas.n > 0) {
		db.close();
		return { ok: false, erro: "ja existe task pendente/rodando para este alvo", dominio };
	}

	// gate: exploit exige prova anterior; sem isso o agente inventa caminho
	if (fase === "exploit" || fase === "shell") {
		const prova = db
			.query("select count(*) n from findings where domain = ? and status in ('validated','exploitable','chained')")
			.get(dominio) as { n: number };
		if (prova.n === 0) {
			db.close();
			return { ok: false, erro: `gate: ${fase} exige finding validado em ${dominio}`, dominio };
		}
	}
	db.close();

	const tarefa = enfileirar(dominio, prompt, prioridade);
	const lease = pedirLease(dominio, "dedicado");
	return { ...tarefa, lease };
}

/** Recupera task orfa: running com lease vencido volta para pending; 3 tentativas = failed. */
export function recuperarOrfas(): number {
	const db = bancoEscrita();
	const agora = new Date().toISOString();
	const n = db.run(
		`update tasks set status = case when attempts >= 3 then 'failed' else 'pending' end,
		        claimed_by = null, updated_at = ?
		 where phase = 'dedicado' and status = 'running' and lease_until is not null and lease_until < ?`,
		[agora, agora],
	).changes;
	db.close();
	return n;
}

/** Registro do que exige decisao humana (write irreversivel). */
export function abrirApproval(dominio: string, tipo: string, resumo: string) {
	const db = bancoEscrita();
	db.exec(`create table if not exists approvals (
		id integer primary key autoincrement, dominio text, tipo text, resumo text,
		criado_em integer default (unixepoch()), decidido_em integer, decisao text, por text)`);
	const r = db.run("insert into approvals (dominio, tipo, resumo) values (?,?,?)", [dominio, tipo, resumo]);
	const id = Number(r.lastInsertRowid);
	db.close();
	return { ok: true, id };
}

/** Move o alvo de fase pelo painel (kanban). Unica escrita de estado na frota. */
export function mudarFase(dominio: string, fase: string) {
	const db = bancoEscrita();
	db.run("update domains set state = ? where domain = ?", [fase, dominio]);
	db.close();
	return { ok: true, dominio, fase };
}

/** Estado do substrato: o que o garcom alimenta (vps, proxy, chave de IA). */
export function substrato() {
	const db = abrir();
	const tem = db.query("select name from sqlite_master where type='table' and name='egress'").get();
	if (!tem) return { tipos: [], total: 0, vivos: 0 };
	const tipos = db
		.query(
			`select coalesce(familia, tipo, '?') as tipo, status, count(*) n,
			        round(avg(latencia_ms)) as latencia
			 from egress group by tipo, status order by tipo, status`,
		)
		.all();
	const t = db.query("select count(*) n from egress").get() as { n: number };
	const v = db.query("select count(*) n from egress where status='vivo'").get() as { n: number };
	return { tipos, total: t.n, vivos: v.n };
}

