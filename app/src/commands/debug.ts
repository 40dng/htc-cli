/**
 * HTC — debug paths
 *
 * Imprime caminhos locais (nunca abre banco nem inicia servidor).
 *   all|config|data|cache|state|bin|log
 * Respeita HTC_HOME (default ~/.htc) — mesmo layout do instalador.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function htcHome(): string {
	return process.env.HTC_HOME?.trim() || join(homedir(), ".htc");
}

export function htcPaths(): Record<string, string> {
	const home = htcHome();
	return {
		home,
		config: join(home, "config"),
		data: join(home, "data"),
		cache: join(home, "cache"),
		state: join(home, "state"),
		log: join(home, "log"),
		bin: join(home, "bin"),
	};
}

export async function runDebugPaths(selector = "all"): Promise<number> {
	const paths = htcPaths();
	const chave = (selector || "all").trim().toLowerCase();
	if (chave !== "all") {
		const valor = paths[chave];
		if (!valor) {
			console.error(
				`seletor invalido: ${selector} (use ${Object.keys(paths).join("|")})`,
			);
			return 1;
		}
		process.stdout.write(`${valor}\n`);
		return 0;
	}
	for (const [nome, valor] of Object.entries(paths)) {
		console.log(`${nome.padEnd(7)} ${valor}`);
	}
	return 0;
}
