// Cliente do broker (o cerebro unico). OPS nao le SQLite: ele comanda.
// Broker = `htc-cli serve` em 127.0.0.1:8787 (web.ts). Offline => modo leitura.
const BASE = process.env.HTC_BROKER ?? "http://127.0.0.1:8787";
const T = 2500;

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T | null> {
	try {
		const r = await fetch(BASE + caminho, { ...init, signal: AbortSignal.timeout(T) });
		if (!r.ok) return null;
		return (await r.json()) as T;
	} catch {
		return null;
	}
}

export type Frota = { resumo: { alvos: number; validados: number; exploitable: number; shells: number }; frota: { alvo: string; findings: number; validados: number; exploitable: number }[] };
export type Egresso = { pool: { familia: string; tipo: string; host: string; porta: number; status: string; score: number }[]; resumo: unknown; leases: { host: string; dono: string; desde: number }[] };
export type Tarefa = { id: number; domain: string; status: string; priority: number; attempts: number };

export const api = {
	online: () => pedir<{ ok: boolean }>("/api/fleet").then((r) => r !== null),

	frota: () => pedir<Frota>("/api/fleet"),
	egresso: () => pedir<Egresso>("/api/egress"),
	tarefas: () => pedir<Tarefa[]>("/api/tasks"),
	supply: () => pedir<Record<string, unknown>>("/api/supply"),
	leakradar: () => pedir<Record<string, unknown>>("/api/leakradar"),
	aprovacoes: () => pedir<{ id: number; alvo: string; pedido: string; estado: string }[]>("/api/approvals"),
	alvo: (d: string) => pedir<Record<string, unknown>>(`/api/target/${encodeURIComponent(d)}`),

	disparar: (alvo: string, prompt?: string, prioridade = 8) =>
		pedir<{ ok?: boolean; id?: number; motivo?: string }>("/api/dispatch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ alvo, prompt, prioridade }),
		}),

	liberar: (alvo: string) => pedir<{ ok?: boolean }>(`/api/lease/${encodeURIComponent(alvo)}`, { method: "DELETE" }),

	fase: (alvo: string, fase: string) =>
		pedir<{ ok?: boolean; erro?: string }>(`/api/target/${encodeURIComponent(alvo)}/fase`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fase }),
		}),

	decidir: (id: number, decisao: "aprovado" | "negado") =>
		pedir<{ ok?: boolean }>(`/api/approvals/${id}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ decisao }),
		}),

	log: (limite = 200) => pedir<{ eventos: { id: number; ts: string; domain: string | null; kind: string; message: string }[] }>(`/api/log?limite=${limite}`),

	suprimento: (texto: string) =>
		pedir<{ pedido?: { tipo: string; qtd: number }[]; medido?: number; vivos?: number; resultado?: string[]; erro?: string }>("/api/suprimento", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ texto }),
		}),

	monitor: (dominios?: string[]) =>
		pedir<{ perfil?: { ok: boolean; pontos?: number; motivo?: string }; varridos?: number; novidades?: { dominio: string; antes: number; agora: number; delta: number }[] }>("/api/monitor", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ dominios }),
		}),

	garimpo: (dominio: string, itens: { url?: string; username?: string; password?: string; host?: string; service?: string; added?: string }[], termo?: string) =>
		pedir<{ ok?: boolean; total?: number; ranqueados?: { frase: string; score: number }[] }>("/api/garimpo", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ dominio, itens, termo }),
		}),
};

/** SSE do broker: um evento por linha `data: {...}`. */
export function assinar(ouvinte: (ev: { tipo: string; alvo?: string; msg?: string; ts?: number }) => void) {
	const ctl = new AbortController();
	(async () => {
		while (!ctl.signal.aborted) {
			try {
				const r = await fetch(`${BASE}/events`, { signal: ctl.signal });
				if (!r.body) throw new Error("sem corpo");
				const leitor = r.body.getReader();
				const dec = new TextDecoder();
				let buf = "";
				for (;;) {
					const { done, value } = await leitor.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					let i = buf.indexOf("\n\n");
					while (i >= 0) {
						const bloco = buf.slice(0, i);
						buf = buf.slice(i + 2);
						i = buf.indexOf("\n\n");
						const dados = bloco
							.split("\n")
							.filter((l) => l.startsWith("data:"))
							.map((l) => l.slice(5).trim())
							.join("");
						if (!dados) continue;
						try {
							const ev = JSON.parse(dados) as { tipo?: string; type?: string; alvo?: string; msg?: string; ts?: number };
							ouvinte({ tipo: ev.tipo ?? ev.type ?? "evento", alvo: ev.alvo, msg: ev.msg, ts: ev.ts });
						} catch {
							/* evento nao-json: ignora */
						}
					}
				}
			} catch {
				/* broker offline: tenta de novo */
			}
			await Bun.sleep(3000);
		}
	})();
	return () => ctl.abort();
}
