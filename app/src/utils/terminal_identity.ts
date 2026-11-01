/**
 * HTC — identidade do terminal
 *
 * 1) Em runtime (TTY): titulo "htc", vermelho da marca no slot 1 da paleta,
 *    fundo/texto coerentes (OSC 0/4/10/11).
 * 2) Windows Terminal: fragmento de perfil (JSON) com nome "htc", icone
 *    "debug" (codicon EBE8), tabColor #CB1B45 e colorScheme "HTC".
 *    Fragmento NAO altera o settings.json do usuario.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HTC_COR = "#CB1B45";
export const HTC_FUNDO = "#0D0D0D";
export const HTC_TEXTO = "#E8EAED";
/** Codicon "debug" (Segoe Fluent Icons). */
export const HTC_ICONE_DEBUG = "\uebe8";

export interface TerminalIdentityOptions {
	/** Nome exibido (titulo da janela e nome do perfil). */
	nome?: string;
	/** Nao escreve o fragmento do Windows Terminal. */
	skipFragment?: boolean;
}

function escriba(stream: NodeJS.WriteStream, sequencia: string): void {
	try {
		stream.write(sequencia);
	} catch {
		// terminal sem suporte: ignorar
	}
}

export function aplicar_identidade_terminal(
	stream: NodeJS.WriteStream = process.stdout,
	opts: TerminalIdentityOptions = {},
): void {
	if (stream.isTTY !== true) {
		return;
	}
	const nome = opts.nome ?? "htc";
	const osc = "\u001b]";
	const st = "\u0007";
	escriba(stream, `${osc}0;${nome}${st}`); // titulo + icone
	escriba(stream, `${osc}2;${nome}${st}`); // titulo
	escriba(stream, `${osc}4;1;${HTC_COR}${st}`); // red -> marca
	escriba(stream, `${osc}4;9;${HTC_COR}${st}`); // bright red -> marca
	escriba(stream, `${osc}10;${HTC_TEXTO}${st}`); // foreground
	escriba(stream, `${osc}11;${HTC_FUNDO}${st}`); // background
}

function commandlineDoHtc(): string {
	const exec = process.execPath;
	const base = (exec.split(/[\\/]/).pop() ?? "").toLowerCase();
	// Binario compilado (htc.exe / htc): o proprio exe e a commandline.
	if (base.startsWith("htc")) {
		return `"${exec}"`;
	}
	// Rodando do fonte via bun: precisa de `bun run <entry>`.
	if (process.versions.bun) {
		const script = process.argv[1] ?? "";
		return script ? `"${exec}" run "${script}"` : `"${exec}"`;
	}
	return `"${exec}"`;
}

export function garantir_fragmento_windows_terminal(
	opts: TerminalIdentityOptions = {},
): string | undefined {
	if (process.platform !== "win32" || opts.skipFragment) {
		return undefined;
	}
	const local = process.env.LOCALAPPDATA;
	if (!local) {
		return undefined;
	}
	const dir = join(local, "Microsoft", "Windows Terminal", "Fragments", "htc");
	const arquivo = join(dir, "htc.json");
	const nome = opts.nome ?? "htc";

	const fragmento = {
		$help: "https://aka.ms/terminal-documentation",
		$schema: "https://aka.ms/terminal-profiles-schema",
		profiles: [
			{
				name: nome,
				commandline: commandlineDoHtc(),
				icon: HTC_ICONE_DEBUG,
				tabColor: HTC_COR,
				colorScheme: "HTC",
				hidden: false,
			},
		],
		schemes: [
			{
				name: "HTC",
				background: HTC_FUNDO,
				foreground: HTC_TEXTO,
				cursorColor: HTC_COR,
				selectionBackground: "#3A1220",
				black: "#0D0D0D",
				red: HTC_COR,
				green: "#4CC38A",
				yellow: "#E8B04B",
				blue: "#7AB8FF",
				purple: "#C9A0FF",
				cyan: "#6FD3C7",
				white: HTC_TEXTO,
				brightBlack: "#5C5F66",
				brightRed: "#FF5C5C",
				brightGreen: "#6FE0A8",
				brightYellow: "#FFD27A",
				brightBlue: "#A8D0FF",
				brightPurple: "#DCC3FF",
				brightCyan: "#9BE8DF",
				brightWhite: "#FFFFFF",
			},
		],
	};

	const json = JSON.stringify(fragmento, null, 2);
	try {
		if (existsSync(arquivo)) {
			const atual = readFileSync(arquivo, "utf8");
			if (atual === json) {
				return arquivo;
			}
		}
		mkdirSync(dir, { recursive: true });
		writeFileSync(arquivo, json, "utf8");
		return arquivo;
	} catch {
		return undefined;
	}
}

/** Chamada unica no startup. Nunca lanca: identidade visual nao derruba sessao. */
export function iniciarIdentidadeTerminal(): void {
	try {
		aplicar_identidade_terminal();
		garantir_fragmento_windows_terminal();
	} catch {
		// silencioso de proposito
	}
}
