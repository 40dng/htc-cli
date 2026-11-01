// language: TypeScript, file: src/utils/sidebar.ts, target: Bun / Windows
/**
 * HTC — estado da sidebar POR SESSAO.
 *
 * O painel OPERACAO/AGENTES lia um arquivo unico (`ops/state/htc_sidebar.json`),
 * entao duas sessoes abertas mostravam exatamente o mesmo conteudo -- o widget
 * que diferia era so o de SESSAO, que vem do contexto vivo do processo.
 *
 * Uma sessao HTC = um processo, entao a chave e o pid. `HTC_SIDEBAR_CHAVE`
 * sobrescreve (teste/roteiro). Quem escreve o estado deve usar
 * `HTC_SIDEBAR_FILE`, publicado por `prepararSidebar()` no boot.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DIR_SIDEBAR = join("ops", "state");

export function chaveSessao(env: NodeJS.ProcessEnv = process.env): string {
	const explicita = env.HTC_SIDEBAR_CHAVE?.trim();
	return explicita && explicita.length > 0 ? explicita : String(process.pid);
}

export function caminhoSidebarSessao(cwd: string, chave = chaveSessao()): string {
	return join(cwd, DIR_SIDEBAR, `htc_sidebar.${chave}.json`);
}

export function caminhoSidebarGlobal(cwd: string): string {
	return join(cwd, DIR_SIDEBAR, "htc_sidebar.json");
}

/**
 * Chamado uma vez no boot. Publica `HTC_SIDEBAR_FILE` para quem escreve o estado
 * (agente, hook, script) acertar o arquivo da sessao sem adivinhar o nome.
 */
export function prepararSidebar(cwd: string = process.cwd()): string | undefined {
	const alvo = caminhoSidebarSessao(cwd);
	try {
		mkdirSync(join(cwd, DIR_SIDEBAR), { recursive: true });
		process.env.HTC_SIDEBAR_FILE = alvo;
		return alvo;
	} catch {
		return undefined;
	}
}

/**
 * Mescla um patch no arquivo da sessao.
 *
 * Existe porque o painel tem mais de um escritor: a missao espelha alvo/fase/
 * achados, o runtime espelha payload/nivel/giros. Sem merge, o ultimo a escrever
 * apagava o campo do outro — era o que deixava AGENTES e OPERACAO vazios na
 * sidebar mesmo com os dois vivos.
 *
 * Painel nao e fonte de verdade: falha em silencio.
 */
export function espelharSidebar(
	patch: Record<string, unknown>,
	env: NodeJS.ProcessEnv = process.env,
): void {
	const arquivo = env.HTC_SIDEBAR_FILE?.trim();
	if (!arquivo) return;
	try {
		mkdirSync(dirname(arquivo), { recursive: true });
		let anterior: Record<string, unknown> = {};
		if (existsSync(arquivo)) {
			try {
				anterior = JSON.parse(readFileSync(arquivo, "utf8")) as Record<
					string,
					unknown
				>;
			} catch {
				anterior = {};
			}
		}
		writeFileSync(
			arquivo,
			`${JSON.stringify({ ...anterior, ...patch }, null, 2)}\n`,
			"utf8",
		);
	} catch {
		// painel e painel
	}
}

// ─── Fontes do painel ────────────────────────────────────────────────────────
// A sidebar lia um arquivo so (alvo/fase/achados) e por isso mostrava "sem
// estado" em operacao viva com fila de 7. Estas duas leituras trazem o que o
// painel precisa e nao existia: posicao na fila e galhos em execucao.

export type ResumoFilaSidebar = {
	total: number;
	novo: number;
	em_curso: number;
	feito: number;
	parado: number;
	atual?: string;
	tentativas?: number;
};

function dirEstado(env: NodeJS.ProcessEnv): string {
	return join(env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc"), "state");
}

/**
 * Resumo da fila da SESSAO. Regra de caminho identica a `caminhoFila`
 * (runtime/fila-alvos.ts): HTC_FILA > state/fila.<sessao>.json > state/fila.json.
 * Reimplementado aqui de proposito — o hook da TUI nao carrega o runtime inteiro
 * (missao, dossie) so para ler tres contadores.
 */
export function lerResumoFila(
	env: NodeJS.ProcessEnv = process.env,
): ResumoFilaSidebar | undefined {
	const caminho =
		env.HTC_FILA?.trim() ||
		(() => {
			const sessao = env.HTC_SESSION_ID?.trim();
			return sessao
				? join(dirEstado(env), `fila.${sessao}.json`)
				: join(dirEstado(env), "fila.json");
		})();
	try {
		const bruto = JSON.parse(readFileSync(caminho, "utf8")) as {
			alvos?: { alvo?: string; estado?: string; tentativas?: number }[];
		};
		const alvos = Array.isArray(bruto.alvos) ? bruto.alvos : [];
		const contar = (estado: string) =>
			alvos.filter((a) => a.estado === estado).length;
		const atual =
			alvos.find((a) => a.estado === "em_curso") ?? alvos.find((a) => a.estado === "novo");
		return {
			total: alvos.length,
			novo: contar("novo"),
			em_curso: contar("em_curso"),
			feito: contar("feito"),
			parado: contar("parado"),
			atual: atual?.alvo,
			tentativas: atual?.tentativas,
		};
	} catch {
		return undefined;
	}
}

export type ResumoGalhosSidebar = {
	total: number;
	ultimo?: string;
	ha?: number;
};

/**
 * Galhos da sessao: um arquivo de relatorio por galho, em
 * `<state>/galhos/<sessao>/<id>.relatorio`. E a unica fonte viva de subagente em
 * disco — o painel AGENTES lia `agentes` do espelho da missao, campo que nenhum
 * escritor preenchia, entao o widget vivia em "nenhum".
 */
export function lerGalhos(
	env: NodeJS.ProcessEnv = process.env,
): ResumoGalhosSidebar | undefined {
	const sessao = env.HTC_SESSION_ID?.trim();
	if (!sessao) return undefined;
	const dir = join(dirEstado(env), "galhos", sessao);
	try {
		const arquivos = readdirSync(dir).filter((n) => n.endsWith(".relatorio"));
		if (arquivos.length === 0) return { total: 0 };
		let ultimo = "";
		let mtime = 0;
		for (const nome of arquivos) {
			try {
				const s = statSync(join(dir, nome));
				if (s.mtimeMs > mtime) {
					mtime = s.mtimeMs;
					ultimo = nome.replace(/\.relatorio$/, "");
				}
			} catch {
				// arquivo sumiu no meio da leitura
			}
		}
		return {
			total: arquivos.length,
			ultimo,
			ha: mtime > 0 ? Math.max(0, Math.round((Date.now() - mtime) / 1000)) : undefined,
		};
	} catch {
		return undefined;
	}
}
