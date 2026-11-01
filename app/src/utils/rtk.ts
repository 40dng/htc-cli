// language: TypeScript, file: src/utils/rtk.ts, runtime: bun/node
//
// RTK nativo: o binario `rtk` (rtk-ai/rtk, Rust) comprime a saida de comandos
// antes dela chegar no contexto — 60-90% menos byte em ls/cat/grep/git/testes.
//
// Integracao: ferramenta + regra no system prompt. O agente chama
// `rtk ls|read|grep|git|...` quando o output e grande; o resto segue cru.
//
// NAO se usa shim de PATH aqui: `rtk ls` invoca o `ls` do PATH, o shim chamava o
// rtk de novo e isso virou fork bomb (medido em 31/10 — centenas de processos).
// Shim fica fora, de proposito. `HTC_RTK=off` desliga a regra.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function raizEstado(env: NodeJS.ProcessEnv = process.env): string {
	return env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc");
}

/** Binario do rtk: HTC_RTK_BIN, PATH e os caminhos de instalacao conhecidos. */
export function binarioRtk(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const explicito = env.HTC_RTK_BIN?.trim();
	if (explicito && existsSync(explicito)) return explicito;
	const localizador = process.platform === "win32" ? "where.exe" : "which";
	const busca = spawnSync(localizador, ["rtk"], { encoding: "utf8", windowsHide: true });
	const achado = (busca.stdout ?? "")
		.split(/\r?\n/)
		.map((linha) => linha.trim())
		.find((linha) =>
			linha.toLowerCase().endsWith(process.platform === "win32" ? "rtk.exe" : "rtk"),
		);
	if (achado) return achado;
	// PATH do processo pode estar velho (winget instala e so o proximo shell ve).
	const candidatos =
		process.platform === "win32"
			? [
					join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Links", "rtk.exe"),
					join(homedir(), ".cargo", "bin", "rtk.exe"),
					join(homedir(), "scoop", "shims", "rtk.exe"),
					join(env.ProgramData ?? "C:\\ProgramData", "chocolatey", "bin", "rtk.exe"),
				]
			: [join(homedir(), ".cargo", "bin", "rtk"), "/usr/local/bin/rtk", "/usr/bin/rtk"];
	const direto = candidatos.find((caminho) => existsSync(caminho));
	if (direto) return direto;
	const pacotes = join(
		env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
		"Microsoft",
		"WinGet",
		"Packages",
	);
	try {
		for (const nome of readdirSync(pacotes)) {
			if (!nome.startsWith("rtk-ai.rtk_")) continue;
			const exe = join(pacotes, nome, "rtk.exe");
			if (existsSync(exe)) return exe;
		}
	} catch {
		// sem WinGet: segue sem rtk
	}
	return undefined;
}

/** HTC_RTK=off desliga; default liga quando o binario existe. */
export function rtkLigado(env: NodeJS.ProcessEnv = process.env): boolean {
	if ((env.HTC_RTK ?? "auto").trim().toLowerCase() === "off") return false;
	return Boolean(binarioRtk(env));
}

/** `rtk gain` cru, para o status. */
export function ganhos(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const bin = binarioRtk(env);
	if (!bin) return undefined;
	const saida = spawnSync(bin, ["gain"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
	return (saida.stdout ?? "").trim() || (saida.stderr ?? "").trim() || undefined;
}

/**
 * Regra que entra no system prompt (uma vez por processo). Deliberadamente
 * estreita: so leitura/build. Saida de recon (nmap, nuclei, ffuf, httpx) fica
 * crua — comprimir ali esconde a linha que decide o vetor.
 */
export function diretivaRtk(): string {
	return [
		"TOKEN (rtk) — for verbose read/build output, call rtk instead of the raw command:",
		"`rtk ls <dir>` (tree), `rtk read <file>` (structure first), `rtk grep <pattern> <dir>` (grouped),",
		"`rtk git status|log|diff`, `rtk <test-runner>`.",
		"Do NOT wrap recon output (nmap, nuclei, ffuf, httpx, sqlmap, nxc): it must stay verbatim —",
		"a filter would hide the line that decides the vector.",
	].join(" ");
}
