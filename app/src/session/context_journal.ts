import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// HTC · 2a via: diario de contexto append-only, sobrevive a queda no meio da rodada.

export const VERSAO_JOURNAL = 1;
const SUFIXO = ".journal.jsonl";
const FLUSH_A_CADA = 128;

export interface CabecalhoJournal {
	versao: number;
	sessionId: string;
	iniciadoEm: number;
	cwd?: string;
	workspaceRoot?: string;
	providerId?: string;
	modelo?: string;
}

export interface RegistroJournal {
	seq: number;
	t: number;
	tipo: string;
	conteudo?: unknown;
}

export interface JournalLido {
	cabecalho?: CabecalhoJournal;
	registros: RegistroJournal[];
}

export function diretorio_padrao(env: NodeJS.ProcessEnv = process.env): string {
	return env.HTC_JOURNAL_DIR?.trim() || join(homedir(), ".cline", "data", "context-journal");
}

export function caminho_do_journal(dir: string, sessionId: string): string {
	return join(dir, `${sessionId}${SUFIXO}`);
}

export class ContextJournal {
	readonly caminho: string;
	private seq: number;
	private desdeFlush = 0;
	private fechado = false;

	private constructor(
		private fd: number,
		caminho: string,
		seqInicial: number,
	) {
		this.caminho = caminho;
		this.seq = seqInicial;
	}

	static abrir(dir: string, cabecalho: Omit<CabecalhoJournal, "versao" | "iniciadoEm">): ContextJournal {
		mkdirSync(dir, { recursive: true });
		const caminho = caminho_do_journal(dir, cabecalho.sessionId);
		const anterior = existsSync(caminho) ? ContextJournal.ler(dir, cabecalho.sessionId) : undefined;
		const fd = openSync(caminho, "a");
		const journal = new ContextJournal(fd, caminho, anterior?.registros.at(-1)?.seq ?? 0);
		if (!anterior?.cabecalho) {
			journal.escrever({ tipo: "_cabecalho", versao: VERSAO_JOURNAL, iniciadoEm: Date.now(), ...cabecalho });
			journal.flush();
		}
		return journal;
	}

	registrar(tipo: string, conteudo?: unknown): RegistroJournal {
		this.seq += 1;
		const registro: RegistroJournal = { seq: this.seq, t: Date.now(), tipo };
		if (conteudo !== undefined) registro.conteudo = conteudo;
		this.escrever(registro);
		this.desdeFlush += 1;
		if (this.desdeFlush >= FLUSH_A_CADA) this.flush();
		return registro;
	}

	registrar_evento(event: unknown): RegistroJournal {
		const tipo = (event as { type?: unknown })?.type;
		return this.registrar(typeof tipo === "string" ? tipo : "desconhecido", event);
	}

	flush(): void {
		if (this.fechado) return;
		fsyncSync(this.fd);
		this.desdeFlush = 0;
	}

	fechar(): void {
		if (this.fechado) return;
		this.flush();
		closeSync(this.fd);
		this.fechado = true;
	}

	static ler(dir: string, sessionId: string): JournalLido {
		const saida: JournalLido = { registros: [] };
		let bruto: string;
		try {
			bruto = readFileSync(caminho_do_journal(dir, sessionId), "utf8");
		} catch {
			return saida;
		}
		for (const linha of bruto.split("\n")) {
			const limpa = linha.trim();
			if (!limpa) continue;
			let obj: { tipo?: string } & Record<string, unknown>;
			try {
				obj = JSON.parse(limpa) as typeof obj;
			} catch {
				continue;
			}
			if (obj.tipo === "_cabecalho") {
				const cabecalho = { ...obj } as Record<string, unknown>;
				delete cabecalho.tipo;
				saida.cabecalho = cabecalho as unknown as CabecalhoJournal;
				continue;
			}
			saida.registros.push(obj as unknown as RegistroJournal);
		}
		return saida;
	}

	private escrever(obj: unknown): void {
		writeSync(this.fd, `${JSON.stringify(obj)}\n`);
	}
}
