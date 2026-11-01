// runner: consome tasks 'dedicado' e executa UM agente por alvo.
// O comando do agente e plugavel: HTC_WORKER_CMD (default: bun run src/index.ts).
import { Database } from "bun:sqlite";
import { caminhoDb } from "./fleet";

type Tarefa = {
	id: number;
	domain: string;
	title: string;
	payload_json: string | null;
	priority: number;
	attempts: number;
};

function escrita() {
	const db = new Database(caminhoDb());
	db.exec("pragma busy_timeout=10000");
	return db;
}

/** Claim atomico: so um worker pega a mesma task. */
export function claim(worker: string): Tarefa | null {
	const db = escrita();
	const agora = new Date().toISOString();
	const alvo = db
		.query(
			`select id, domain, title, payload_json, priority, attempts
			 from tasks
			 where phase = 'dedicado' and status = 'pending'
			 order by priority desc, id
			 limit 1`,
		)
		.get() as Tarefa | null;
	if (!alvo) {
		db.close();
		return null;
	}
	const r = db.run(
		`update tasks set status = 'running', claimed_by = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
		 where id = ? and status = 'pending'`,
		[worker, new Date(Date.now() + 40 * 60_000).toISOString(), agora, alvo.id],
	);
	db.close();
	return r.changes === 1 ? alvo : null;
}

export function concluir(id: number, ok: boolean, resultado: unknown) {
	const db = escrita();
	db.run("update tasks set status = ?, result_json = ?, updated_at = ? where id = ?", [
		ok ? "done" : "failed",
		JSON.stringify(resultado).slice(0, 120_000),
		new Date().toISOString(),
		id,
	]);
	db.close();
}

export type Execucao = { ok: boolean; saida: string; codigo: number | null; ms: number };

/** Executa o agente do alvo. Comando plugavel por env; sem ele, nao inventa. */
export async function executar(tarefa: Tarefa, proxy: string | null, timeoutMs = 20 * 60_000): Promise<Execucao> {
	const cmd = process.env.HTC_WORKER_CMD ?? "bun run src/index.ts";
	const prompt = (() => {
		try {
			return (JSON.parse(tarefa.payload_json ?? "{}") as { prompt?: string }).prompt ?? tarefa.title;
		} catch {
			return tarefa.title;
		}
	})();

	const t0 = Date.now();
	const partes = cmd.trim().split(/\s+/);
	const proc = Bun.spawn([...partes, prompt], {
		cwd: process.env.HTC_WORKER_CWD ?? process.cwd(),
		env: {
			...process.env,
			HTC_ALVO: tarefa.domain,
			HTC_PROMPT: prompt,
			HTC_PROXY: proxy ?? "",
			HTC_TASK: String(tarefa.id),
			// modelo dos dedicados: um so, barato e rapido (deepseek flash)
			HTC_MODEL: process.env.HTC_MODEL ?? "deepseek-v4.1-flash",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	const timer = setTimeout(() => proc.kill(), timeoutMs);
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	clearTimeout(timer);
	const codigo = await proc.exited;

	return {
		ok: codigo === 0,
		saida: (out + err).slice(-20_000),
		codigo,
		ms: Date.now() - t0,
	};
}

/** Um ciclo: pega uma task, pede a lease ao OPS, executa, grava o resultado. */
export async function ciclo(worker = `runner-${process.pid}`) {
	const tarefa = claim(worker);
	if (!tarefa) return { ok: true, vazio: true };

	// comunicacao obrigatoria com o plano de controle: sem OPS nao roda
	const { pedirAoOps, avisarOps } = await import("../ops/bus");
	const permissao = await pedirAoOps(tarefa.domain);
	if (!permissao.livre) {
		concluir(tarefa.id, false, { erro: `ops recusou: ${permissao.motivo}` });
		return { ok: false, vazio: false, tarefa: tarefa.id, alvo: tarefa.domain, motivo: permissao.motivo };
	}

	const { pedirLease } = await import("./fleet");
	const lease = pedirLease(tarefa.domain, worker);
	avisarOps({ t: "event", alvo: tarefa.domain, kind: "start", msg: `task #${tarefa.id} ${worker}` });

	const exec = await executar(tarefa, lease.proxy ?? null);
	avisarOps({ t: "done", alvo: tarefa.domain, ok: exec.ok, resumo: { ms: exec.ms, codigo: exec.codigo } });
	concluir(tarefa.id, exec.ok, { ...exec, proxy: lease.proxy, worker });
	return { ok: exec.ok, vazio: false, tarefa: tarefa.id, alvo: tarefa.domain, ms: exec.ms };
}

if (import.meta.main) {
	const modo = Bun.argv[2] ?? "1";
	if (modo === "loop") {
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const r = await ciclo();
			console.log(JSON.stringify(r));
			await Bun.sleep(r.vazio ? 5000 : 500);
		}
	}
	console.log(JSON.stringify(await ciclo()));
}
