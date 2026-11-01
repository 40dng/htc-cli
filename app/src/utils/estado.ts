/**
 * HTC — diretorio de estado
 *
 * O runtime herdado grava em `~/.cline/data`. O HTC usa `~/.htc/data`.
 * Na primeira execucao copia o que existe (settings, sessions) para nao perder
 * login/modelo. `HTC_STATE_DIR` sobrescreve; `HTC_KEEP_CLINE_DIR=1` mantem o
 * comportamento antigo.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function prepararEstadoHtc(): string {
	const sobrescrito = process.env.HTC_STATE_DIR?.trim();
	if (sobrescrito) {
		// HTC_STATE_DIR e a RAIZ do estado, nao o diretorio de dados: setClineDir()
		// deriva `<dir>/data` por conta propria (resolveClineDataDir).
		mkdirSync(sobrescrito, { recursive: true });
		return sobrescrito;
	}
	if (process.env.HTC_KEEP_CLINE_DIR === "1") {
		return join(homedir(), ".cline");
	}

	const raiz = join(homedir(), ".htc");
	const destino = join(raiz, "data");
	const legado = join(homedir(), ".cline", "data");
	mkdirSync(destino, { recursive: true });
	// Migracao ADITIVA: o diretorio novo pode ja existir (cache/db) sem settings.
	// Copia item a item o que falta, sem sobrescrever nada.
	for (const item of ["settings", "sessions", "db"]) {
		const alvoItem = join(destino, item);
		const origemItem = join(legado, item);
		if (!existsSync(alvoItem) && existsSync(origemItem)) {
			try {
				cpSync(origemItem, alvoItem, { recursive: true, force: false });
			} catch {
				// sem migracao: o usuario reconfigura pelo /model
			}
			continue;
		}
		// O diretorio ja existe: copia item a item o que falta. Sem isso o
		// `models.json` (catalogo de modelos dos providers custom) ficava so em
		// ~/.cline e o bridge/runtime liam catalogos diferentes.
		if (!existsSync(alvoItem) || !existsSync(origemItem)) continue;
		try {
			for (const arquivo of readdirSync(origemItem)) {
				const alvoArquivo = join(alvoItem, arquivo);
				if (existsSync(alvoArquivo)) continue;
				cpSync(join(origemItem, arquivo), alvoArquivo, { force: false });
			}
		} catch {
			// item ilegivel: segue com o que ja existe
		}
	}
	absorver_data_aninhado(destino);
	return raiz;
}

/**
 * Ate a 1.0.0 a saida era `<raiz>/data` em vez de `<raiz>`, e o `setClineDir()`
 * derivava outro `data` -- sessoes novas caiam em `~/.htc/data/data/sessions` e
 * nunca apareciam no historico, que le `~/.htc/data/sessions`.
 *
 * Absorve o que ficou la, SO `sessions` e so o que falta: copiar `db` com WAL
 * vivo arrisca corromper o arquivo, e sessao orfa custa menos que banco quebrado.
 */
function absorver_data_aninhado(destino: string): void {
	const aninhado = join(destino, "data");
	if (!existsSync(aninhado)) return;
	const origemSessoes = join(aninhado, "sessions");
	if (!existsSync(origemSessoes)) return;
	const alvoSessoes = join(destino, "sessions");
	try {
		mkdirSync(alvoSessoes, { recursive: true });
		for (const arquivo of readdirSync(origemSessoes)) {
			const alvo = join(alvoSessoes, arquivo);
			if (existsSync(alvo)) continue;
			cpSync(join(origemSessoes, arquivo), alvo, { recursive: true, force: false });
		}
	} catch {
		// sessoes antigas continuam onde estao; nada e apagado
	}
}
