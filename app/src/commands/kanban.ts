// language: TypeScript, file: src/commands/kanban.ts, runtime: bun/node
/**
 * `htc kanban` — abre o app de kanban do Cline (`kanban` no PATH), como antes.
 *
 * O painel proprio do HTC vive em `htc web` (src/commands/web.ts). Este comando
 * nao implementa kanban: acha o binario, repassa o terminal e devolve o codigo
 * de saida. Flags do operador passam direto (`--no-open`, `--port`).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { writeErr, writeln } from "../utils/output";

export interface LaunchKanbanOptions {
	/** Argumentos extras repassados ao kanban (ex.: ["--no-open", "--port", "3484"]). */
	args?: string[];
}

function binarioKanban(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const nomes =
		process.platform === "win32" ? ["kanban.cmd", "kanban.exe", "kanban.bat"] : ["kanban"];
	const caminhos = (env.PATH ?? "").split(delimiter).filter(Boolean);
	for (const nome of nomes) {
		for (const dir of caminhos) {
			const candidato = join(dir.replace(/^"|"$/g, ""), nome);
			try {
				accessSync(candidato, constants.X_OK);
				return candidato;
			} catch {
				// segue procurando
			}
		}
	}
	return undefined;
}

function encaminharSinal(child: ChildProcess, sinal: NodeJS.Signals): void {
	try {
		if (process.platform === "win32") child.kill();
		else child.kill(sinal);
	} catch {
		// processo ja saiu
	}
}

export async function launchKanban(options: LaunchKanbanOptions = {}): Promise<number> {
	const bin = binarioKanban();
	if (!bin) {
		writeErr("kanban nao encontrado no PATH. Instale: npm i -g kanban");
		return 1;
	}
	const args = options.args ?? [];
	writeln(`[htc kanban] ${bin}${args.length ? ` ${args.join(" ")}` : ""}`);
	return await new Promise<number>((resolve) => {
		// Windows: .cmd só roda via shell, e o caminho tem espaço — precisa de aspas.
		const comando = process.platform === "win32" ? `"${bin}"` : bin;
		const passa = args.map((a) => (/\s/.test(a) ? `"${a}"` : a));
		const child = spawn(comando, passa, {
			stdio: "inherit",
			shell: process.platform === "win32",
			windowsHide: false,
			// Abre direto no projeto de onde o htc foi chamado (mesmo sem git).
			env: process.env.KANBAN_WORKSPACE?.trim()
				? process.env
				: { ...process.env, KANBAN_WORKSPACE: process.cwd() },
		});
		const sinais: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
		const handlers = sinais.map((sinal) => {
			const h = () => encaminharSinal(child, sinal);
			process.on(sinal, h);
			return [sinal, h] as const;
		});
		const limpar = () => {
			for (const [sinal, h] of handlers) process.off(sinal, h);
		};
		child.once("error", (erro) => {
			limpar();
			writeErr(`falha ao executar kanban: ${erro.message}`);
			resolve(1);
		});
		child.once("close", (codigo) => {
			limpar();
			resolve(codigo ?? 1);
		});
	});
}
