// language: TypeScript, file: src/lab/executor.ts, runtime: bun/node
// Executor real do laboratorio: um turno one-shot do proprio HTC por sonda.
//
// Roda o binario (ou `bun src/index.ts` no dev) com `--json` e HTC_PAYLOAD da
// variante — o caminho exercitado e exatamente o que o operador usa, com o
// payload, a doutrina e a deteccao de recusa reais. Nada de mock de provider.

import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import type { Executor, SaidaExecucao } from "./runner";

export interface OpcoesExecutorHtc {
	/** Binario ou runtime. Default: process.execPath (o proprio htc). */
	binario?: string;
	provider?: string;
	modelo?: string;
	thinking?: string;
	cwd?: string;
	/** Argumentos extras repassados ao one-shot. */
	extras?: string[];
}

function montar_comando(opcoes: OpcoesExecutorHtc): { comando: string; base: string[] } {
	const binario = opcoes.binario ?? process.execPath;
	const nome = basename(binario).toLowerCase();
	const ehHtc = nome.startsWith("htc");
	if (ehHtc) return { comando: binario, base: [] };
	// Rodando via `bun src/index.ts`: o entrypoint precisa ir como argumento.
	const entrypoint = process.argv[1];
	return { comando: binario, base: entrypoint ? [entrypoint] : [] };
}

/** Extrai o texto final da saida JSON do one-shot; cai no stdout cru. */
export function extrair_texto(saida: string): string {
	let resultado = "";
	let ultimoTexto = "";
	for (const linha of saida.split(/\r?\n/)) {
		const bruta = linha.trim();
		if (!bruta.startsWith("{")) continue;
		try {
			const evento = JSON.parse(bruta) as {
				type?: string;
				text?: unknown;
				event?: { type?: string; contentType?: string; text?: unknown };
			};
			if (evento.type === "run_result" && typeof evento.text === "string") {
				resultado = evento.text;
				continue;
			}
			// Turno encerrado por `submit` nao gera run_result: o texto visivel
			// esta no content_end/text do stream.
			const interno = evento.event;
			if (
				interno?.type === "content_end" &&
				interno.contentType === "text" &&
				typeof interno.text === "string"
			) {
				ultimoTexto = interno.text;
			}
		} catch {
			// linha que nao e JSON (log, spinner) — ignora
		}
	}
	return resultado || ultimoTexto || saida.trim();
}

export function criar_executor_htc(opcoes: OpcoesExecutorHtc = {}): Executor {
	const { comando, base } = montar_comando(opcoes);
	return async ({ sonda, variante, timeoutMs }): Promise<SaidaExecucao> => {
		const args = [
			...base,
			sonda.pedido,
			"--json",
			// Sem yolo, one-shot em modo act pede aprovacao de ferramenta no stdin:
			// o probe trava esperando Enter e o laboratorio mede timeout, nao recusa.
			"--yolo",
			// yolo liga auto-continue por padrao: sem isso o probe reenvia turno
			// indefinidamente e o laboratorio mede timeout em vez de recusa.
			"--auto-continue",
			"false",
			"--thinking",
			opcoes.thinking ?? "none",
			...(opcoes.provider ? ["-P", opcoes.provider] : []),
			...(opcoes.modelo ? ["-m", opcoes.modelo] : []),
			...(opcoes.extras ?? []),
		];
		const inicio = Date.now();
		return await new Promise<SaidaExecucao>((resolve) => {
			const filho = spawn(comando, args, {
				cwd: opcoes.cwd ?? process.cwd(),
				windowsHide: true,
				env: {
					...process.env,
					HTC_PAYLOAD: variante,
					// Laboratorio nao pode herdar ancora/pensamento de uma sessao TUI.
					HTC_NO_IDENTITY: "1",
				},
			});
			let stdout = "";
			let stderr = "";
			let encerrado = false;
			const timer = setTimeout(() => {
				if (encerrado) return;
				filho.kill();
				resolve({ texto: "", erro: `timeout ${timeoutMs}ms`, duracaoMs: Date.now() - inicio });
			}, timeoutMs);
			filho.stdout?.on("data", (chunk) => {
				stdout += String(chunk);
			});
			filho.stderr?.on("data", (chunk) => {
				stderr += String(chunk);
			});
			filho.on("close", (codigo) => {
				encerrado = true;
				clearTimeout(timer);
				const texto = extrair_texto(stdout);
				if (codigo !== 0 && !texto) {
					resolve({
						texto: "",
						erro: `exit ${codigo}: ${stderr.trim().slice(0, 200) || "sem stderr"}`,
						duracaoMs: Date.now() - inicio,
					});
					return;
				}
				resolve({ texto, duracaoMs: Date.now() - inicio });
			});
			filho.on("error", (erro) => {
				encerrado = true;
				clearTimeout(timer);
				resolve({ texto: "", erro: String(erro), duracaoMs: Date.now() - inicio });
			});
		});
	};
}

/** Caminho do binario instalado, para o CLI avisar quando nao existir. */
export function binarioPadrao(): string {
	return process.execPath;
}

export { join };
