// Sessoes do HTC CLI lidas do mesmo banco que ele escreve — o OPS recolhe igual ao irmao.
import { Database } from "bun:sqlite";

export type SessaoCli = {
	id: string;
	curto: string;
	pid: number;
	status: string;
	agente: string;
	modelo: string;
	workspace: string;
	prompt: string;
	inicio: string;
	subagente: boolean;
};

const caminho = () => `${process.env.USERPROFILE}\\.cline\\data\\db\\sessions.db`;

export function sessoesCli(limite = 40): SessaoCli[] {
	try {
		const db = new Database(caminho(), { readonly: true });
		const linhas = db
			.query(
				`select session_id, pid, status, agent_id, model, workspace_root, prompt, started_at, ended_at, is_subagent
				 from sessions
				 order by started_at desc
				 limit ?`,
			)
			.all(limite) as {
			session_id: string;
			pid: number;
			status: string;
			agent_id: string | null;
			model: string;
			workspace_root: string;
			prompt: string | null;
			started_at: string;
			ended_at: string | null;
			is_subagent: number;
		}[];
		db.close();
		return linhas.map((l) => ({
			id: l.session_id,
			curto: l.session_id.split("_")[0] ?? l.session_id,
			pid: l.pid,
			status: l.ended_at ? l.status : "ativa",
			agente: l.agent_id ?? (l.is_subagent ? "sub" : "lead"),
			modelo: l.model,
			workspace: l.workspace_root.split("\\").pop() ?? l.workspace_root,
			prompt: (l.prompt ?? "").replace(/\s+/g, " ").slice(0, 90),
			inicio: l.started_at,
			subagente: l.is_subagent === 1,
		}));
	} catch {
		return [];
	}
}

/** Sessoes vivas: status 'ativa' (sem ended_at). O pid pode ser do pai, entao nao decide. */
export function sessoesVivas(): SessaoCli[] {
	return sessoesCli(60).filter((s) => s.status === "ativa");
}
