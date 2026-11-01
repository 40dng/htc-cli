// language: TypeScript, file: src/runtime/last-session.ts, runtime: bun/node
// Marcador da ultima sessao viva.
//
// O `scripts/atualizar_e_reabrir.ps1` fecha o HTC, instala o build novo e precisa
// reabrir NA MESMA conversa. O processo que morre nao tem como responder "qual
// era a sessao", entao o runtime grava o id aqui a cada start/resume e o script
// le o arquivo antes de fechar.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface UltimaSessao {
	sessionId: string;
	cwd?: string;
	provider?: string;
	model?: string;
	at: string;
}

export function caminhoUltimaSessao(env: NodeJS.ProcessEnv = process.env): string {
	const raiz = env.HTC_STATE_DIR?.trim();
	return raiz
		? join(raiz, "state", "last-session.json")
		: join(homedir(), ".htc", "state", "last-session.json");
}

/** Grava o marcador. Falha de escrita nunca quebra o turno. */
export function marcarUltimaSessao(
	dados: Omit<UltimaSessao, "at">,
	env: NodeJS.ProcessEnv = process.env,
): void {
	try {
		const caminho = caminhoUltimaSessao(env);
		mkdirSync(dirname(caminho), { recursive: true });
		writeFileSync(
			caminho,
			`${JSON.stringify({ ...dados, at: new Date().toISOString() }, null, 2)}\n`,
			"utf8",
		);
	} catch {
		// best-effort
	}
}

export function lerUltimaSessao(env: NodeJS.ProcessEnv = process.env): UltimaSessao | undefined {
	try {
		const bruto = JSON.parse(readFileSync(caminhoUltimaSessao(env), "utf8")) as unknown;
		if (!bruto || typeof bruto !== "object") return undefined;
		const dados = bruto as Record<string, unknown>;
		if (typeof dados.sessionId !== "string" || !dados.sessionId.trim()) return undefined;
		return {
			sessionId: dados.sessionId.trim(),
			cwd: typeof dados.cwd === "string" ? dados.cwd : undefined,
			provider: typeof dados.provider === "string" ? dados.provider : undefined,
			model: typeof dados.model === "string" ? dados.model : undefined,
			at: typeof dados.at === "string" ? dados.at : "",
		};
	} catch {
		return undefined;
	}
}
