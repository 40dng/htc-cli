// language: TypeScript, file: src/bridge/opencode_command.ts, runtime: Bun/Node
// `rae opencode`: sobe a bridge e o OpenCode no MESMO flow. A bridge escuta em
// loopback; o OpenCode (config ~/.config/opencode) aponta o provider raehook
// pra ela. Ao sair do OpenCode, a bridge e encerrada.

import { spawn } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Llms } from "@cline/core";
import { escolher_porta_livre } from "../utils/opencode_provider";
import { instalar_filtro_de_logs } from "./adapters/htc_handler";
import { erro_de_binario, resolver_binario_opencode } from "./opencode_binario";
import { provider_padrao, resolver_provider } from "./provider_resolver";
import {
	criar_servidor_bridge,
	type ConfigBridge,
	resolver_config_bridge,
} from "./server";
import { TIMEOUT_SHUTDOWN_MS } from "./timeouts";

/** Modelos do HTC que aparecem no picker do OpenCode (todos via bridge). */
async function listar_modelos_picker(): Promise<
	Record<string, Record<string, unknown>>
> {
	const ids = new Set<string>();
	// Fonte de verdade: o proprio endpoint /models do Zen (opencode) e do Go.
	// O catalogo do Llms nao bate com o lineup real (ex.: nao tem v4.1-flash).
	for (const pid of ["opencode", "opencode-go"]) {
		for (const id of await buscar_modelos_endpoint(pid)) ids.add(id);
	}
	// Fallback: catalogo do Llms (caso o endpoint esteja indisponivel).
	if (ids.size === 0) {
		for (const pid of ["opencode", "opencode-go", "deepseek"]) {
			try {
				const ms = await Llms.getModelsForProvider(pid, { filter: "chat" });
				for (const id of Object.keys(ms)) ids.add(id);
			} catch {
				// provider sem catalogo: ignora
			}
		}
	}
	for (const c of [
		"claude-sonnet-4-5",
		"claude-sonnet-4-6",
		"claude-opus-4-6",
		"claude-haiku-4-5",
		"claude-sonnet-5",
		"claude-opus-5",
	]) {
		ids.add(c);
	}
	const modelos: Record<string, Record<string, unknown>> = {};
	for (const id of ids) {
		modelos[id] = {
			name: id,
			tool_call: true,
			reasoning: true,
			limit: { context: 1_000_000, output: 384_000 },
		};
	}
	return modelos;
}

/** Busca o lineup real no endpoint /models do provider (Zen/Go). */
async function buscar_modelos_endpoint(pid: string): Promise<string[]> {
	try {
		const p = resolver_provider(pid);
		const resp = await fetch(`${p.baseUrl}/models`, { headers: p.headers });
		if (!resp.ok) return [];
		const corpo = (await resp.json()) as {
			data?: Array<{ id?: string }>;
			models?: Array<{ id?: string }>;
		};
		const lista = corpo.data ?? corpo.models ?? [];
		return lista
			.map((m) => m.id)
			.filter((x): x is string => typeof x === "string" && x.length > 0);
	} catch {
		return [];
	}
}

/** Tema do TUI do raehook, semeado na config isolada do raehook. */
const TEMA_RAEHOOK = "raehook";

/** Ultimo recurso de modelo quando o provider resolvido nao declara nenhum. */
const MODELO_ULTIMO_RECURSO = "deepseek-v4.1-flash";

/**
 * Dir de config ISOLADO do raehook. O OpenCode resolve config por
 * `$XDG_CONFIG_HOME/opencode`; apontando para ca, o `rae opencode` fala so com
 * a config dele e NUNCA toca em `~/.config/opencode` do usuario (que seguiria
 * funcionando com os providers nativos, o tema proprio, tudo). Override por
 * `HTC_BRIDGE_OC_CONFIG`.
 */
export function resolver_dir_config_isolado(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const explicito = env.HTC_BRIDGE_OC_CONFIG?.trim();
	if (explicito) return explicito;
	return join(tmpdir(), "htc-opencode", "config");
}

/** Copia o tema raehook (e o tui.json que o seleciona) para a config isolada. */
function semear_tema(dirConfigOpencode: string): void {
	try {
		const dirTemaDestino = join(dirConfigOpencode, "themes");
		mkdirSync(dirTemaDestino, { recursive: true });
		const origemUsuario = join(homedir(), ".config", "opencode", "themes");
		if (existsSync(origemUsuario)) {
			for (const nome of readdirSync(origemUsuario)) {
				const origem = join(origemUsuario, nome);
				const destino = join(dirTemaDestino, nome);
				if (!existsSync(destino)) copyFileSync(origem, destino);
			}
		}
		writeFileSync(
			join(dirConfigOpencode, "tui.json"),
			`${JSON.stringify(
				{ $schema: "https://opencode.ai/tui.json", theme: TEMA_RAEHOOK },
				null,
				2,
			)}\n`,
		);
	} catch {
		// best-effort: sem tema, o TUI usa o default
	}
}

/** Escreve o config do OpenCode (isolado) apontando o provider pra bridge. */
async function escrever_config_opencode(
	base: string,
	modeloPadrao: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	try {
		const dirConfig = resolver_dir_config_isolado(env);
		// O OpenCode espera `<XDG_CONFIG_HOME>/opencode`.
		const dirOpencode = join(dirConfig, "opencode");
		mkdirSync(dirOpencode, { recursive: true });
		const models = await listar_modelos_picker();
		// O default precisa existir no picker; se o lineup nao listar o modelo,
		// declara na mao (senao o OpenCode recusa o modelo inicial).
		if (modeloPadrao && !models[modeloPadrao]) {
			models[modeloPadrao] = {
				name: modeloPadrao,
				tool_call: true,
				reasoning: true,
				limit: { context: 1_000_000, output: 384_000 },
			};
		}
		writeFileSync(
			join(dirOpencode, "opencode.jsonc"),
			JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					// Default vai pro provider raehook -> bridge (tratamento HTC).
					// O modelo e o do provider resolvido no HTC, nao um fixo: o
					// claude fixo roteava todo turno pro free tier do Zen (403).
					model: `raehook/${modeloPadrao}`,
					small_model: `raehook/${modeloPadrao}`,
					// So o provider raehook (bridge) fica ativo: TODO modelo passa
					// pela injecao. `disabled_providers` mata os providers nativos do
					// OpenCode (senao ele usa direto e sem injecao). Isto vive na
					// config ISOLADA — nao mexe mais no entorno do usuario.
					enabled_providers: ["raehook"],
					disabled_providers: [
						"anthropic",
						"opencode",
						"opencode-go",
						"opencode-zen",
						"zen",
					],
					provider: {
						// Provider custom: fala a API Anthropic (que a bridge expoe),
						// mas com id/nome proprios pra nao confundir com a Anthropic real.
						raehook: {
							npm: "@ai-sdk/anthropic",
							name: "Raehook",
							options: { baseURL: `${base}/v1`, apiKey: "raehook" },
							models,
						},
					},
					// Auto-aprova ferramentas (o fluxo do raehook exige execucao).
					permission: {
						edit: "allow",
						write: "allow",
						bash: "allow",
						webfetch: "allow",
					},
				},
				null,
				2,
			) + "\n",
		);
		semear_tema(dirOpencode);
	} catch {
		// best-effort
	}
}

// `resolver_binario_opencode` vive em `./opencode_binario` (modulo leve, sem
// dependencia do core) para poder ser testado isolado; reexportado aqui para
// nao quebrar quem ja importava deste arquivo.
export { caminhos_opencode, resolver_binario_opencode } from "./opencode_binario";

function subir_servidor(
	servidor: Server,
	config: ConfigBridge,
): Promise<Error | undefined> {
	return new Promise((resolve) => {
		servidor.once("error", (erro) => resolve(erro));
		servidor.listen(config.port, config.host, () => resolve(undefined));
	});
}

export interface OpcoesOpenCode extends Partial<ConfigBridge> {
	argsOpenCode?: string[];
}

/**
 * Modelo default do provider configurado: o lineup REAL que o HTC usa. Sem isso
 * o default era um claude fixo, roteado para o free tier do Zen — que responde
 * 403 ("free tier can only be used from within OpenCode") mesmo com fingerprint.
 */
function modelo_padrao_do_provider(providerId: string): string | undefined {
	try {
		return resolver_provider(providerId).modelo;
	} catch {
		return undefined;
	}
}

export async function runOpenCodeCommand(
	opcoes: OpcoesOpenCode = {},
): Promise<number> {
	instalar_filtro_de_logs();
	// Provider/modelo default = o que o HTC usa de fato (lastUsedProvider +
	// modelo do provider). Nao fixar "opencode" + claude: todo turno ia para o
	// free tier do Zen, que hoje responde 403 e derrubava o fluxo.
	const providerId =
		opcoes.providerId?.trim() ||
		process.env.HTC_BRIDGE_PROVIDER?.trim() ||
		provider_padrao() ||
		"opencode-go";
	const config = resolver_config_bridge({
		...opcoes,
		providerId,
		modelo:
			opcoes.modelo?.trim() ||
			process.env.HTC_BRIDGE_MODEL?.trim() ||
			modelo_padrao_do_provider(providerId),
	});
	// Porta livre por instancia (evita "port in use" e colisao entre sessoes) e
	// escreve o config do OpenCode na config ISOLADA do raehook.
	const porta = (await escolher_porta_livre(config.port)) ?? config.port;
	config.port = porta;
	const base = `http://${config.host}:${porta}`;
	// Dir de config isolado: o filho (OpenCode) resolve tudo por aqui, sem tocar
	// em `~/.config/opencode`. Exportado ANTES de escrever o config.
	const dirConfig = resolver_dir_config_isolado();
	process.env.XDG_CONFIG_HOME = dirConfig;
	await escrever_config_opencode(base, config.modelo ?? MODELO_ULTIMO_RECURSO);
	const estado = { requisicoes: 0, correcoes: 0 };
	const servidor = criar_servidor_bridge(config, estado);

	const erro = await subir_servidor(servidor, config);
	if (erro) {
		process.stderr.write(
			`[rae opencode] falha ao abrir a bridge em ${config.host}:${porta}: ${erro.message}\n`,
		);
		return 1;
	}

	const binario = resolver_binario_opencode();
	// Nao setamos ANTHROPIC_*: o provider raehook ja tem o baseURL no config, e
	// variaveis ANTHROPIC_* fariam o OpenCode registrar o provider anthropic nativo.
	// XDG_CONFIG_HOME aponta para a config isolada (o filho herda).
	const env: NodeJS.ProcessEnv = {
		...process.env,
		XDG_CONFIG_HOME: dirConfig,
	};

	process.stdout.write(
		`\n  🔹 Raehook bridge  ->  ${base}  (provider: ${config.providerId})\n` +
			`  OpenCode          ->  ${binario}\n\n`,
	);

	return await new Promise<number>((resolve) => {
		const filho = spawn(binario, opcoes.argsOpenCode ?? [], {
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
			process.stderr.write(
				`[rae opencode] nao foi possivel iniciar o OpenCode: ${erro_de_binario(err)}\n`,
			);
			finalizar(1);
		});
		filho.on("exit", (codigo, sinal) => finalizar(codigo ?? (sinal ? 1 : 0)));
		process.on("SIGINT", () => filho.kill("SIGINT"));
		process.on("SIGTERM", () => filho.kill("SIGTERM"));
	});
}
