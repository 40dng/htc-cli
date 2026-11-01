// language: TypeScript, file: src/runtime/risco-comando.ts, target: Bun / Windows
// Risco de comando de terminal. Comando nao e tudo igual: `ls` numa pasta
// gigante, `dir /s`, `grep -r` na raiz ou `cat` de arquivo enorme varrem
// milhoes de caminhos, enchem a memoria e penduram o shell. Aqui cada comando
// ganha um nivel (high/medium/low) e um teto de tempo proporcional — quanto
// maior o risco, menor o tempo que a execucao corre antes de ser abortada.
//
// Puro: so olha o texto do comando. Nao toca no ambiente nem no processo.

export type NivelDeRisco = "high" | "medium" | "low";

export interface AnaliseDeRisco {
	nivel: NivelDeRisco;
	motivos: string[];
	timeout_ms: number;
}

// Teto de tempo por nivel. HIGH e curto de proposito: e o comando que mais
// pendura (listagem/varredura larga) e tambem o que mais consome memoria.
export const TIMEOUT_RISCO_MS: Record<NivelDeRisco, number> = {
	high: 6_000,
	medium: 20_000,
	low: 60_000,
};

const SEPARADOR_DE_COMANDO = /(?:^|[\r\n]|[;&|]{1,2}|\()\s*/;

const RECURSIVO_RE = /(?:^|\s)(?:-r|-R|--recursive|\/s)(?:\s|$)/;
const RAIZ_RE = /(?:^|\s)(?:\/|~|\.\.?|\*|[A-Za-z]:[\\/])(?:\s|$)/;
const LISTAGEM_RE =
	/(?:^|[\r\n;&|(]\s*)(?:ls|dir|gci|get-childitem|tree|du)\b/i;
const BUSCA_RE =
	/(?:^|[\r\n;&|(]\s*)(?:find|grep|rg|findstr|select-string|fd)\b/i;
const LEITURA_RE = /(?:^|[\r\n;&|(]\s*)(?:cat|type|more|less)\b/i;
const GIT_VARREDURA_RE =
	/(?:^|[\r\n;&|(]\s*)git\s+(?:ls-files|status|grep|log)\b/i;
const COPY_OU_MOVE_RE = /(?:^|[\r\n;&|(]\s*)(?:cp|copy|xcopy|robocopy|mv|move)\b/i;

function segmentos(texto: string): string[] {
	return texto
		.split(SEPARADOR_DE_COMANDO)
		.map((parte) => parte.trim())
		.filter((parte) => parte.length > 0);
}

function tokens(segmento: string): string[] {
	return segmento.split(/\s+/).filter((token) => token.length > 0);
}

/** Ha um alvo explicito e estreito (caminho/arquivo concreto) no segmento? */
function tem_alvo_estreito(partes: string[]): boolean {
	// Descarta o proprio comando e as flags; o que sobrar e alvo.
	const restante = partes.slice(1).filter((token) => !token.startsWith("-"));
	if (restante.length === 0) return false;
	// Um alvo e estreito quando nao e raiz/home/corrente/curinga.
	return restante.every((token) => !/^(?:\/|~|\.\.?|\*|[A-Za-z]:[\\/])$/.test(token));
}

export function classificar_risco(comando: string): AnaliseDeRisco {
	const motivos: string[] = [];
	let nivel: NivelDeRisco = "low";

	const marcar = (nivelNovo: NivelDeRisco, motivo: string): void => {
		if (nivelNovo === "high") nivel = "high";
		else if (nivelNovo === "medium" && nivel === "low") nivel = "medium";
		motivos.push(motivo);
	};

	if (RECURSIVO_RE.test(comando)) {
		marcar("high", "varredura recursiva: caminhada ilimitada + memoria");
	}

	for (const segmento of segmentos(comando)) {
		const partes = tokens(segmento);
		if (partes.length === 0) continue;
		const estreito = tem_alvo_estreito(partes);

		if (LISTAGEM_RE.test(segmento)) {
			if (RECURSIVO_RE.test(segmento) || !estreito) {
				marcar("high", "listagem ampla (ls/dir) sem caminho estreito");
			} else {
				marcar("medium", "listagem com alvo");
			}
		}
		if (BUSCA_RE.test(segmento)) {
			if (RECURSIVO_RE.test(segmento) || !estreito || RAIZ_RE.test(segmento)) {
				marcar("high", "busca varrendo a arvore inteira");
			} else {
				marcar("medium", "busca com alvo");
			}
		}
		if (LEITURA_RE.test(segmento)) {
			if (!estreito || RAIZ_RE.test(segmento)) {
				marcar("high", "leitura sem arquivo especifico (stdin/dispositivo)");
			} else {
				marcar("medium", "leitura de arquivo");
			}
		}
		if (GIT_VARREDURA_RE.test(segmento)) {
			marcar("medium", "varredura de repositorio");
		}
		if (COPY_OU_MOVE_RE.test(segmento) && RECURSIVO_RE.test(segmento)) {
			marcar("high", "copia/movimentacao recursiva");
		}
	}

	return {
		nivel,
		motivos: motivos.length > 0 ? motivos : ["comando estreito"],
		timeout_ms: TIMEOUT_RISCO_MS[nivel],
	};
}

/**
 * Risco de uma TOOL em voo, para alimentar o batimento. Quando o texto do
 * comando esta disponivel, vale a analise fina; quando nao esta (o evento de
 * tool do core nao carrega o input), um comando de terminal e tratado como HIGH
 * — e o vetor do #11622 (pendura o shell) e o maior consumidor de memoria.
 * `read_files`/`search` de arquivos grandes tambem pesam: MEDIUM.
 */
export function classificar_risco_da_ferramenta(
	ferramenta: string | undefined,
	comando?: string,
): NivelDeRisco | undefined {
	if (!ferramenta) return undefined;
	const nome = ferramenta.toLowerCase();
	if (nome === "run_commands" || nome === "execute_command" || nome === "bash") {
		const texto = comando?.trim();
		return texto ? classificar_risco(texto).nivel : "high";
	}
	if (
		nome === "read_files" ||
		nome === "read" ||
		nome === "search" ||
		nome === "search_codebase"
	) {
		return "medium";
	}
	if (
		nome === "apply_patch" ||
		nome === "editor" ||
		nome === "write" ||
		nome === "edit"
	) {
		return "medium";
	}
	return undefined;
}
