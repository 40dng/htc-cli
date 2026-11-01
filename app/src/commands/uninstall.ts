/**
 * HTC — uninstall
 *
 * Remove apenas o que o instalador criou:
 *   binario, ~/.htc (--keep-state preserva), fragmento do Windows Terminal e
 *   as linhas "# htc" do PATH. Sem --force nao apaga: imprime o plano.
 */
import {
	existsSync,
	lstatSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UninstallOptions {
	keepState?: boolean;
	/** Apaga sem confirmacao (--force / --yes). */
	yes?: boolean;
	/** Apenas mostra o que seria removido (--dry-run). */
	dryRun?: boolean;
}

const MARCA = "# htc";

function rcFiles(home: string): string[] {
	return [
		join(home, ".bashrc"),
		join(home, ".zshrc"),
		join(home, ".profile"),
		join(home, ".config", "fish", "config.fish"),
	];
}

function removerDoPath(home: string, log: string[]): void {
	for (const rc of rcFiles(home)) {
		if (!existsSync(rc)) continue;
		let texto: string;
		try {
			texto = readFileSync(rc, "utf8");
		} catch {
			continue;
		}
		if (!texto.includes(MARCA)) continue;
		const antes = texto.length;
		const linhas = texto
			.split(/\r?\n/)
			.filter((linha) => !linha.includes(MARCA));
		const novo = linhas.join("\n");
		if (novo.length === antes) continue;
		try {
			writeFileSync(rc, novo, "utf8");
			log.push(`PATH limpo em ${rc}`);
		} catch {
			log.push(`PATH: nao consegui escrever ${rc}`);
		}
	}
}

export async function runUninstall(opts: UninstallOptions = {}): Promise<number> {
	const home = homedir();
	const estado = join(home, ".htc");
	const binarios = [
		join(home, ".local", "bin", "htc"),
		join(home, ".local", "bin", "htcli"),
		"/usr/local/bin/htc",
		join(estado, "bin", "htc"),
		join(estado, "bin", "htc.exe"),
	];

	const presentes = binarios.filter((b) => existsSync(b));
	const temEstado = existsSync(estado);

	console.log("HTC — desinstalar");
	console.log("");
	console.log("  binarios :", presentes.length ? presentes.join(", ") : "(nenhum)");
	console.log(
		"  estado   :",
		temEstado ? `${estado}${opts.keepState ? " (preservado)" : ""}` : "(ausente)",
	);
	console.log("  PATH     : linhas marcadas com \"# htc\"");

	if (opts.dryRun) {
		console.log("");
		console.log("--dry-run: nada sera apagado.");
		return 0;
	}

	if (!opts.yes) {
		console.log("");
		console.log("Nada foi apagado. Rode com --force (ou --yes) para executar:");
		console.log("  htc uninstall --force [--keep-state]");
		return 1;
	}

	const log: string[] = [];
	for (const alvo of presentes) {
		try {
			const st = lstatSync(alvo);
			if (st.isSymbolicLink() || st.isFile()) {
				unlinkSync(alvo);
				log.push(`removido ${alvo}`);
			}
		} catch {
			log.push(`falhou remover ${alvo}`);
		}
	}
	if (temEstado && !opts.keepState) {
		try {
			rmSync(estado, { recursive: true, force: true });
			log.push(`removido ${estado}`);
		} catch {
			log.push(`falhou remover ${estado}`);
		}
	}
	removerDoPath(home, log);

	// Fragmento do Windows Terminal (perfil "htc").
	if (process.platform === "win32" && process.env.LOCALAPPDATA) {
		const frag = join(
			process.env.LOCALAPPDATA,
			"Microsoft",
			"Windows Terminal",
			"Fragments",
			"htc",
		);
		if (existsSync(frag)) {
			try {
				rmSync(frag, { recursive: true, force: true });
				log.push(`removido ${frag}`);
			} catch {
				log.push(`falhou remover ${frag}`);
			}
		}
	}

	for (const linha of log) console.log("  " + linha);
	console.log("");
	console.log("Pronto. Feche e reabra o terminal.");
	return 0;
}
