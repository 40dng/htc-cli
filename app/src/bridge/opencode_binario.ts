// language: TypeScript, file: src/bridge/opencode_binario.ts, runtime: Bun/Node
// Localiza o binario do OpenCode. O layout do pacote npm mudou: ate o 1.18 o exe
// ficava em `opencode-ai/bin`; do 1.19 em diante ele vive no subpacote de
// plataforma (`opencode-ai/node_modules/opencode-windows-x64[-baseline]/bin`).
// O instalador antigo (`~/.opencode/bin`) fica como ultimo recurso. Sem cobrir o
// layout novo, `rae opencode` morre em ENOENT depois de o OpenCode se atualizar.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Subpacote de plataforma publicado como optionalDependency do opencode-ai. */
export function pacote_de_plataforma(): string {
	const so =
		process.platform === "win32"
			? "windows"
			: process.platform === "darwin"
				? "darwin"
				: "linux";
	const arq = process.arch === "arm64" ? "arm64" : "x64";
	return `opencode-${so}-${arq}`;
}

/** Nome do executavel conforme o SO. */
function nome_do_executavel(): string {
	return process.platform === "win32" ? "opencode.exe" : "opencode";
}

/** Caminhos candidatos ao binario, na ordem de preferencia. */
export function caminhos_opencode(): string[] {
	const exe = nome_do_executavel();
	const npmGlobal = join(
		homedir(),
		"AppData",
		"Roaming",
		"npm",
		"node_modules",
		"opencode-ai",
	);
	const plataforma = pacote_de_plataforma();
	const candidatos = [
		// Layout do 1.19+ (o npm global instala o subpacote de plataforma).
		join(npmGlobal, "node_modules", plataforma, "bin", exe),
		join(npmGlobal, "node_modules", `${plataforma}-baseline`, "bin", exe),
		// Layout antigo (1.18): o proprio pacote carregava o exe.
		join(npmGlobal, "bin", exe),
		// Instalador antigo por conta propria.
		join(homedir(), ".opencode", "bin", exe),
	];
	if (process.platform === "win32") {
		// CLI embutido no app desktop do OpenCode.
		candidatos.push(
			join(
				homedir(),
				"AppData",
				"Local",
				"Programs",
				"@opencodedesktop",
				"resources",
				"opencode-cli.exe",
			),
		);
	}
	return candidatos;
}

/**
 * Resolve o binario do OpenCode. `HTC_OPENCODE_BIN` e autoritativo (mesmo que o
 * caminho nao exista: o operador apontou o alvo). Sem candidato no disco, devolve
 * o nome puro para a busca no PATH.
 */
export function resolver_binario_opencode(
	env: Record<string, string | undefined> = process.env,
): string {
	const explicito = env.HTC_OPENCODE_BIN?.trim();
	if (explicito) return explicito;
	for (const caminho of caminhos_opencode()) {
		if (existsSync(caminho)) return caminho;
	}
	return nome_do_executavel();
}

/** Falha de spawn legivel: ENOENT vira a lista de caminhos procurados. */
export function erro_de_binario(erro: Error): string {
	if ((erro as NodeJS.ErrnoException).code !== "ENOENT") return erro.message;
	const lista = caminhos_opencode()
		.map((caminho) => `      ${caminho}`)
		.join("\n");
	return (
		`binario do OpenCode nao encontrado. Procurei em:\n${lista}\n` +
		"      aponte HTC_OPENCODE_BIN para o executavel do opencode."
	);
}
