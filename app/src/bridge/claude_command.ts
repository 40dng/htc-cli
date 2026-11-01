// language: TypeScript, file: src/bridge/claude_command.ts, runtime: Bun/Node
// `htc claude`: sobe a bridge e o Claude Code no MESMO flow. A bridge escuta em
// loopback, o filho `claude` recebe ANTHROPIC_BASE_URL apontando para ela e, ao
// sair o Claude Code, a bridge e encerrada. Um comando, zero terminal extra.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { instalar_filtro_de_logs } from "./adapters/htc_handler";
import {
	criar_servidor_bridge,
	type ConfigBridge,
	resolver_config_bridge,
} from "./server";
import { contexto_do_modelo } from "./contexto_modelo";
import { TIMEOUT_SHUTDOWN_MS } from "./timeouts";

/** Localiza o binario do Claude Code. */
export function resolver_binario_claude(
	env: Record<string, string | undefined> = process.env,
): string {
	const explicito = env.HTC_CLAUDE_BIN?.trim();
	if (explicito) return explicito;
	const candidatos = [
		join(homedir(), ".local", "bin", "claude.exe"),
		join(homedir(), ".local", "bin", "claude"),
		join(homedir(), ".claude", "local", "claude"),
	];
	for (const caminho of candidatos) {
		if (existsSync(caminho)) return caminho;
	}
	return process.platform === "win32" ? "claude.exe" : "claude";
}

function subir_servidor(servidor: Server, config: ConfigBridge): Promise<Error | undefined> {
	return new Promise((resolve) => {
		servidor.once("error", (erro) => resolve(erro));
		servidor.listen(config.port, config.host, () => resolve(undefined));
	});
}

export interface OpcoesClaude extends Partial<ConfigBridge> {
	argsClaude?: string[];
}

export async function runClaudeCommand(opcoes: OpcoesClaude = {}): Promise<number> {
	instalar_filtro_de_logs();
	const config = resolver_config_bridge(opcoes);
	const estado = { requisicoes: 0, correcoes: 0 };
	const servidor = criar_servidor_bridge(config, estado);

	const erro = await subir_servidor(servidor, config);
	if (erro) {
		process.stderr.write(
			`[htc claude] falha ao abrir a bridge em ${config.host}:${config.port}: ${erro.message}\n`,
		);
		return 1;
	}

	const base = `http://${config.host}:${config.port}`;
	const binario = resolver_binario_claude();
	const modelo = config.modelo ?? "";
	// Contexto REAL do modelo (tabela do OpenCode Go); override explicito vence.
	const contexto =
		process.env.HTC_BRIDGE_CONTEXT_TOKENS ?? String(contexto_do_modelo(modelo));
	const env: NodeJS.ProcessEnv = {
		...process.env,
		ANTHROPIC_BASE_URL: base,
		ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? "htc-local",
		CLAUDE_CODE_MAX_CONTEXT_TOKENS: contexto,
		// Nao deixa o Claude Code sobrescrever o titulo do terminal (mantem o
		// nosso OSC "\u{1F539} raehook").
		CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
	};
	// Nao fixar ANTHROPIC_MODEL: o Claude Code restaura o ULTIMO modelo escolhido
	// em /model (persistido em ~/.claude/settings.json).
	delete env.ANTHROPIC_MODEL;

	// Define o titulo do terminal (cmd / Windows Terminal).
	process.stdout.write("\x1b]0;htc\x07");
	process.stdout.write(
		`\n  raehook bridge  ->  ${base}  (provider: ${config.providerId})\n` +
			`  contexto          ->  ${contexto} tokens\n` +
			`  Claude Code       ->  ${binario}\n\n`,
	);

	// Por padrao roda com permissoes liberadas (o workflow do raehook exige —
	// sem isso, o modo "dontAsk" do settings bloqueia Bash/PowerShell e o modelo
	// nao consegue executar nada). Se o usuario passar um flag proprio, respeita.
	const argsUsuario = opcoes.argsClaude ?? [];
	const jaTemPermissao = argsUsuario.some(
		(a) =>
			a === "--dangerously-skip-permissions" ||
			a === "--permission-mode" ||
			a.startsWith("--permission-mode="),
	);
	const argsFinais = jaTemPermissao
		? argsUsuario
		: ["--dangerously-skip-permissions", ...argsUsuario];

	return await new Promise<number>((resolve) => {
		const filho = spawn(binario, argsFinais, {
			stdio: "inherit",
			env,
		});

		let finalizando = false;
		const encerrar_bridge = () => {
			const forcado = setTimeout(() => {
				servidor.closeAllConnections?.();
			}, TIMEOUT_SHUTDOWN_MS);
			forcado.unref?.();
			servidor.close(() => clearTimeout(forcado));
		};
		const finalizar = (codigo: number) => {
			if (finalizando) return;
			finalizando = true;
			encerrar_bridge();
			resolve(codigo);
		};

		filho.on("error", (err) => {
			process.stderr.write(`[htc claude] nao foi possivel iniciar o Claude Code: ${err.message}\n`);
			finalizar(1);
		});
		filho.on("exit", (codigo, sinal) => {
			finalizar(codigo ?? (sinal ? 1 : 0));
		});
		// Ctrl+C no terminal: repassa ao filho; a bridge encerra quando ele sair.
		process.on("SIGINT", () => filho.kill("SIGINT"));
		process.on("SIGTERM", () => filho.kill("SIGTERM"));
	});
}
