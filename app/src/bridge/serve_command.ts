// language: TypeScript, file: src/bridge/serve_command.ts, runtime: Bun/Node
// Comando `htc serve`: sobe a bridge local e imprime as variaveis que o Claude
// Code precisa. Encerra graciosamente em SIGINT/SIGTERM com teto de tempo.

import type { Server } from "node:http";
import { instalar_filtro_de_logs } from "./adapters/htc_handler";
import {
	criar_servidor_bridge,
	type ConfigBridge,
	resolver_config_bridge,
} from "./server";
import { TIMEOUT_SHUTDOWN_MS } from "./timeouts";

function imprimir_instrucoes(config: ConfigBridge, modelo?: string): void {
	const base = `http://${config.host}:${config.port}`;
	const linhas = [
		"",
		`  raehook bridge  ->  ${base}`,
		`  provider HTC       :  ${config.providerId}${modelo ? `  (modelo: ${modelo})` : ""}`,
		`  injecao            :  ${process.env.HTC_BRIDGE_INJECT ?? "on"}`,
		"",
		"  Claude Code (~/.claude/settings.json):",
		"    \"env\": {",
		`      \"ANTHROPIC_BASE_URL\": \"${base}\",`,
		"      \"ANTHROPIC_AUTH_TOKEN\": \"htc-local\"",
		modelo ? `      ,\"ANTHROPIC_MODEL\": \"${modelo}\"` : "",
		"    }",
		"",
	];
	process.stdout.write(`${linhas.filter(Boolean).join("\n")}\n`);
}

export async function runServeCommand(
	opcoes: Partial<ConfigBridge> = {},
): Promise<number> {
	instalar_filtro_de_logs();
	const config = resolver_config_bridge(opcoes);
	const estado = { requisicoes: 0, correcoes: 0 };
	const servidor: Server = criar_servidor_bridge(config, estado);

	const subiu = await new Promise<Error | undefined>((resolve) => {
		servidor.once("error", (erro) => resolve(erro));
		servidor.listen(config.port, config.host, () => resolve(undefined));
	});
	if (subiu) {
		process.stderr.write(`[htc serve] falha ao abrir ${config.host}:${config.port}: ${subiu.message}\n`);
		return 1;
	}

	imprimir_instrucoes(config, config.modelo);

	return await new Promise<number>((resolve) => {
		let encerrando = false;
		const encerrar = (sinal: string) => {
			if (encerrando) return;
			encerrando = true;
			process.stdout.write(`\n[htc serve] ${sinal}: encerrando...\n`);
			const forcado = setTimeout(() => {
				servidor.closeAllConnections?.();
				resolve(0);
			}, TIMEOUT_SHUTDOWN_MS);
			forcado.unref?.();
			servidor.close(() => {
				clearTimeout(forcado);
				resolve(0);
			});
		};
		process.on("SIGINT", () => encerrar("SIGINT"));
		process.on("SIGTERM", () => encerrar("SIGTERM"));
	});
}
