import { tmpdir } from "node:os";
import { classificar_risco } from "../runtime/risco-comando";


// Guarda de comando: barra o que faz a sessao TRAVAR no shell (issue
// cline#11622) antes de o comando chegar ao executor. O core ja trunca a SAIDA
// em ~48K; o que ele nao limita e o proprio COMANDO. Heredoc e one-liner
// gigantes penduram o terminal do Windows (cmd tem teto de ~8191 chars e nao
// entende heredoc), e a sessao fica esperando para sempre.
//
// O `beforeTool` retorna `{ skip: true, reason }`: o modelo recebe o motivo como
// resultado da tool e o turno CONTINUA (nao e `stop`), entao a mensagem ensina a
// alternativa em vez de so matar o comando.

// Em cmd.exe a linha de comando e limitada a ~8191 chars; acima disso o shell
// trunca ou pendura. Bash no Windows via MSYS aguenta mais, por isso o teto de
// seguranca fica abaixo do limite do cmd para nao chegar perto dele.
export const MAX_SAFE_COMMAND_CHARS = 8000;

// Limites do upstream (cline#11641, "guide oversized execute_command calls"):
// la o handler rejeita comando > 12_000 e heredoc grande > 4_000. Neste alvo
// (Windows/cmd) nao da para afrouxar ate 12_000 — cmd trunca/pendura perto de
// 8191 — entao MAX_SAFE_COMMAND_CHARS (8000) segue como teto EFETIVO e os
// numeros do PR ficam nomeados para a mensagem e para um shell POSIX.
export const MAX_COMMAND_LENGTH = 12_000;
export const MAX_HEREDOC_COMMAND_LENGTH = 4_000;

// Um heredoc e o padrao que mais prende o shell: abre `<<EOF` e o terminal fica
// esperando a linha terminadora.
export const HEREDOC_MARKER_RE =
	/(?<![<])<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./-]+))/;

// Construtores de bloco que transformam N comandos numa unica string ainda
// maior (o modelo encadeia here-docs e o comando final explode de tamanho).
const MULTI_LINE_JOINER_RE = /(`|&&|\|\|)\s*[\r\n]/;

// Comandos que ficam ESPERANDO stdin/tecla: em sessao headless eles nao recebem
// entrada e penduram o shell ate o timeout — o "session hangs waiting for the
// shell" do #11622, na variante que nao e heredoc. Casamos so na POSICAO de
// comando (inicio ou apos separador) para nao bloquear `echo more`/`--more`.
const INTERACTIVE_STDIN_RE =
	/(?:^|[\r\n;&|(]\s*)(?:pause|choice)(?:\s|$)|(?:^|[\r\n;&|(]\s*)set\s+\/p\b|(?:^|[\r\n;&|(]\s*)(?:more|less|vi|vim|nano)(?:\s|$)|(?:^|[\r\n;&|(]\s*)read(?:\s|$)/i;

// Marcador de varredura AMPLA: recursao ou alvo raiz/home/drive/curinga. Uma
// listagem normal no diretorio corrente nao casa aqui (fica so marcada como
// risco high, sem bloqueio); o que casa e o que varre a arvore inteira.
const RISCO_AMPLO_RE =
	/(?:^|\s)(?:-r|-R|--recursive|\/s)(?:\s|$)|(?:^|\s)(?:\/|~|\.\.?|\*|[A-Za-z]:[\\/])(?:\s|$)/;

export type CommandGuardKind =
	| "heredoc"
	| "interactive-stdin"
	| "high-risk"
	| "oversized-command"
	| "oversized-multiline";

export interface CommandGuardHit {
	kind: CommandGuardKind;
	length: number;
	detail: string;
}

function extractCommands(input: unknown): string[] {
	if (typeof input === "string") return [input];
	if (!input || typeof input !== "object") return [];
	const record = input as Record<string, unknown>;
	if (Array.isArray(record.commands)) {
		return record.commands.flatMap((cmd) => {
			if (typeof cmd === "string") return [cmd];
			if (cmd && typeof cmd === "object") {
				const c = cmd as { command?: unknown; args?: unknown };
				const base = typeof c.command === "string" ? c.command : "";
				const args = Array.isArray(c.args)
					? c.args.filter((a) => typeof a === "string").join(" ")
					: "";
				return [args ? `${base} ${args}` : base];
			}
			return [];
		});
	}
	if (typeof record.command === "string") {
		const args = Array.isArray(record.args)
			? record.args.filter((a) => typeof a === "string").join(" ")
			: "";
		return [args ? `${record.command} ${args}` : record.command];
	}
	if (typeof record.cmd === "string") return [record.cmd];
	return [];
}

/**
 * Detecta o motivo de bloqueio de um comando de terminal, ou `undefined` se o
 * comando pode rodar. Nao toca no ambiente: e so leitura do texto do comando.
 */
export function detectCommandGuard(
	command: string,
	maxChars: number = MAX_SAFE_COMMAND_CHARS,
): CommandGuardHit | undefined {
	if (HEREDOC_MARKER_RE.test(command)) {
		return {
			kind: "heredoc",
			length: command.length,
			detail: `heredoc, ${command.length} chars`,
		};
	}
	if (INTERACTIVE_STDIN_RE.test(command)) {
		return {
			kind: "interactive-stdin",
			length: command.length,
			detail: "comando interativo aguardando entrada/tecla",
		};
	}
	// Comando amplo/recursivo (ls/dir/find/grep na raiz): varre a arvore inteira,
	// enche a memoria e pendura o shell. O risco puro (sem varredura ampla) nao
	// bloqueia — so alimenta o radar do supervisor.
	const analise = classificar_risco(command);
	if (analise.nivel === "high" && RISCO_AMPLO_RE.test(command)) {
		return {
			kind: "high-risk",
			length: command.length,
			detail: analise.motivos.join("; "),
		};
	}
	if (command.length > maxChars) {
		return {
			kind: "oversized-command",
			length: command.length,
			detail: `${command.length} chars`,
		};
	}
	if (command.includes("\n") && MULTI_LINE_JOINER_RE.test(command)) {
		return {
			kind: "oversized-multiline",
			length: command.length,
			detail: "comando multi-linha encadeado",
		};
	}
	return undefined;
}

const TEMP_DIR = tmpdir();

/** Comando de leitura direto ao executavel do alvo, sem heredoc nem redirecionamento. */
export const EXAMPLE_READ_ONLY_COMMAND = `node -e "console.log('oi')"`;

export function commandGuardReason(hit: CommandGuardHit): string {
	const base =
		"Command not executed: it would hang the terminal (the session would freeze waiting for the shell). " +
		"You are on Windows; cmd.exe cannot run heredoc (`<<EOF`) and its command line tops out around 8191 characters. ";
	const guidance =
		"Break it into shorter terminal commands and run them sequentially instead of combining everything into one command. " +
		"Use one short command per call; use the file tools (`write`/`edit`/`apply_patch`) instead of redirecting a heredoc into a file, " +
		`and for output that is large, write it to a file under \`${TEMP_DIR}\` or read the file in ranges. ` +
		`Keep each command under ${MAX_SAFE_COMMAND_CHARS} characters (upstream allows ${MAX_COMMAND_LENGTH}, but this Windows shell does not).`;
	switch (hit.kind) {
		case "heredoc":
			return `${base}Blocked: heredoc detected (${hit.detail}; upstream blocks > ${MAX_HEREDOC_COMMAND_LENGTH}). ${guidance}`;
		case "interactive-stdin":
			return `${base}Blocked: interactive command that waits for input (${hit.detail}). This is a headless session — nothing will send the keystroke, so the shell hangs until timeout. ${guidance}Use non-interactive flags instead (e.g. \`pause\`/\`set /p\`/\`more\`/\`vi\` have no place here; pass arguments directly, add \`--no-pager\`, or read the file with the file tools).`;
		case "high-risk":
			return `${base}Blocked: high-risk scan (${hit.detail}). A recursive/root listing or search walks the whole tree, blows up memory, and hangs the shell. Narrow the target: point at a specific directory, add a bound (\`head\`, \`--max-count\`, \`--files-with-matches\`, a path), or use the repo search tool instead of shelling out to \`ls\`/\`find\`/\`grep -r\` on a broad root. ${guidance}`;
		case "oversized-command":
			return `${base}Blocked: command too long (${hit.detail}). ${guidance}`;
		case "oversized-multiline":
			return `${base}Blocked: chained multi-line command (${hit.detail}). ${guidance}`;
	}
}

/**
 * Avalia um input de `run_commands` e devolve o primeiro bloqueio encontrado.
 * Exportado para o `beforeTool` do runtime.
 */
export function evaluar_comando_do_run_commands(
	input: unknown,
	maxChars: number = MAX_SAFE_COMMAND_CHARS,
): { hit: CommandGuardHit; command: string } | undefined {
	for (const command of extractCommands(input)) {
		const hit = detectCommandGuard(command, maxChars);
		if (hit) return { hit, command };
	}
	return undefined;
}
