import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { ToolPolicy } from "@cline/core";

import { registerDisposable } from "@cline/shared";
import { injetar_bypass } from "./runtime/htc-bypass";
import {
	instrucao_galhos,
	resolver_politica_agentes,
} from "./runtime/subagent-policy";
import type { Command } from "commander";
import type { ConfigBridge } from "./bridge/server";
import { registerHistoryCommand } from "./commands/history-command";
import {
	CommanderError,
	commanderToParsedArgs,
	createProgram,
} from "./commands/program";
import {
	autoUpdateOnStartup,
} from "./commands/update";
import { CLI_DEFAULT_CHECKPOINT_CONFIG } from "./runtime/defaults";
import { criar_controlador_de_checkpoint } from "./runtime/checkpoint-shadow";
import { PAYLOADS as PAYLOADS_BYPASS } from "./runtime/htc-bypass";

const PAYLOADS_IDS = PAYLOADS_BYPASS.map((payload) => payload.id).join("|");
import type { TuiStartupTarget } from "./tui/types";
import { filterChatModels } from "./utils/chat-models";
import { getCliBuildInfo } from "./utils/common";
import {
	garantir_fingerprint_do_opencode,
} from "./utils/opencode_fingerprint";
import {
	eh_provedor_opencode,
	normalizar_modelo_opencode,
	preparar_ambiente_do_opencode,
} from "./utils/opencode_provider";
import {
	aviso_de_workspace_largo,
	indexacao_do_workspace_bloqueada,
} from "./utils/workspace_guard";
import {
	caminhoProviders,
	repararProvidersDoDisco,
	salvarProviderPreservando,
} from "./utils/providers-sanidade";
import {
	buildCliCompactionConfig,
	CLI_COMPACTION_MODE_EXPECTED_TEXT,
} from "./utils/compaction-mode";
import {
	refreshCliFeatureFlagsInBackground,
	setCliFeatureFlagsAccountContext,
} from "./utils/feature-flags";
import {
	configureSandboxEnvironment,
	normalizeAutoApproveArgs,
	resolveWorkspaceRoot,
} from "./utils/helpers";
import {
	c,
	installStreamErrorGuards,
	setCurrentOutputMode,
	writeErr,
	writeln,
} from "./utils/output";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
} from "./utils/provider-auth";
import { resolveCliReasoning } from "./utils/reasoning";
import {
	resolveStartupCompactionMode,
	resolveStartupMode,
	resolveStartupToolAutoApprove,
} from "./utils/startup-settings";
import { rewriteTeamPrompt, TEAM_COMMAND_USAGE } from "./utils/team-command";
import {
	captureCliExtensionActivated,
	getCliTelemetryService,
	identifyTelemetryAccount,
} from "./utils/telemetry";
import type { Config } from "./utils/types";
import { runConnectWizard } from "./wizards/connect";
import { runMcpWizard } from "./wizards/mcp";
import { runScheduleWizard } from "./wizards/schedule";

export function stdinHasPipedInput(): boolean {
	if (process.stdin.isTTY) return false;
	try {
		const stats = fstatSync(0);
		return stats.isFIFO() || stats.isFile();
	} catch {
		return false;
	}
}

async function createProviderSettingsManager() {
	const { ProviderSettingsManager } = await import("@cline/core");
	return new ProviderSettingsManager();
}

/**
 * Provider free local (dsh-our-free-model ou free-gemini-api).
 *
 * Antes so o `dsh` abria esta porta, entao o servidor Gemini em :8001 nunca
 * aparecia no /model mesmo estando no ar. Agora qualquer canal ligado (ou
 * HTC_FREE_BASE) tenta registrar, e o endpoint/chave/modelos vem do canal que
 * responder primeiro (env > dsh > gemini).
 */
async function ensureFreeProvider(manager: Awaited<ReturnType<typeof createProviderSettingsManager>>) {
	const { freeLigado } = await import("./utils/free-state");
	const envBase = process.env.HTC_FREE_BASE?.trim();
	if (
		!envBase &&
		!freeLigado("dsh") &&
		!freeLigado("gemini")
	) {
		return;
	}
	const { escolherCanalFree } = await import("./utils/free-endpoints");
	// Abrir o HTC com os canais ligados sobe dsh e gemini juntos, antes de
	// resolver o endpoint: sem isso a sessao nasce sem `htc-free`.
	try {
		const { subirCanaisFree } = await import("./utils/free-boot");
		await subirCanaisFree();
	} catch {
		// sem launcher: segue com o que ja estiver no ar
	}
	const vivo = await escolherCanalFree(undefined, 2500);
	const base = (envBase || vivo?.base || "").replace(/\/+$/, "");
	if (process.env.HTC_DEBUG_FREE === "1") {
		console.error(
			`[free] canal=${vivo?.canal ?? "(nenhum)"} base=${base || "(vazia)"} modelos=${vivo?.modelos.length ?? 0}`,
		);
	}
	if (!base) {
		// Sem canal vivo: registra o que ja esta no disco para o provider nao
		// morrer com "Unknown or disabled provider" antes do endpoint subir.
		try {
			const { registrarProvidersCustom } = await import("./utils/provider-registry");
			await registrarProvidersCustom(manager);
		} catch {
			// registry indisponivel
		}
		return;
	}
	const chave = process.env.HTC_FREE_KEY?.trim() || vivo?.key || "";
	try {
		const { gravarProviderFree } = await import("./utils/free-models");
		await gravarProviderFree(manager, {
			base,
			chave,
			modelos: vivo?.modelos ?? [],
		});
	} catch {
		// registry indisponivel: segue sem o provider free
	}
	// models.json ja escrito: aplica no registry do llms ANTES do primeiro
	// handler, senao `Unknown or disabled provider "htc-free"`.
	try {
		const { registrarProvidersCustom } = await import("./utils/provider-registry");
		await registrarProvidersCustom(manager);
	} catch {
		// registry indisponivel: o erro original continua valendo
	}
}

async function promptDeepSeekApiKey(): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise<string>((resolve) => {
		rl.question(
			"Chave DeepSeek (https://platform.deepseek.com/api_keys) — Enter para pular: ",
			(answer) => {
				rl.close();
				resolve(answer.trim());
			},
		);
	});
}

async function ensureDeepSeekProvider(manager: Awaited<ReturnType<typeof createProviderSettingsManager>>) {
	const { listLocalProviders, addLocalProvider, updateLocalProvider } = await import("@cline/core");

	// Chave DeepSeek: env -> persistido. Prompt SO quando o operador pediu
	// deepseek (HTC_ASK_DEEPSEEK_KEY=1) — o padrao do HTC e rodar sem chave no
	// provider local (opencode), entao pedir chave no init nao faz sentido.
	let apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
	if (!apiKey) {
		try {
			apiKey = getPersistedProviderApiKey("deepseek", manager.getProviderSettings("deepseek"))?.trim() ?? "";
		} catch {
			// sem chave persistida: segue sem prompt
		}
	}
	if (!apiKey && process.env.HTC_ASK_DEEPSEEK_KEY === "1" && process.stdin.isTTY && process.stdout.isTTY) {
		apiKey = await promptDeepSeekApiKey();
	}

	try {
		const { providers } = await listLocalProviders(manager, { isClinePassEnabled: false });
		const ja_existe = providers.some((p) => p.id === "deepseek");
		if (!ja_existe) {
			await addLocalProvider(manager, {
				providerId: "deepseek",
				name: "DeepSeek",
				baseUrl: "https://api.deepseek.com/v1",
				apiKey,
				models: ["deepseek-chat", "deepseek-reasoner"],
				defaultModelId: "deepseek-chat",
				protocol: "openai-chat" as const,
				capabilities: ["popular"] as const,
			});
		} else if (apiKey) {
			await updateLocalProvider(manager, { providerId: "deepseek", apiKey });
		}
	} catch {
		// provider registry not available - skip silently
	}

	// Expose para o stream custom (ai.ts le process.env.DEEPSEEK_API_KEY)
	if (apiKey) {
		process.env.DEEPSEEK_API_KEY = apiKey;
	}
}


async function loadCliRuntimeModules() {
	const [coreServer, prompt, runAgentModule] = await Promise.all([
		import("@cline/core"),
		import("./runtime/prompt"),
		import("./runtime/run-agent"),
	]);
	return {
		coreServer,
		resolveSystemPrompt: prompt.resolveSystemPrompt,
		runAgent: runAgentModule.runAgent,
	};
}

async function loadInteractiveRuntimeModule() {
	const { runInteractive } = await import("./runtime/run-interactive");
	return runInteractive;
}

/**
 * Two-pass approach for --config: a quick scan of process.argv extracts the
 * config directory before commander parses, because setClineDir() must run
 * before any code that reads the home/config directory.
 *
 * Recognizes both Commander spellings:
 *   --config <dir>
 *   --config=<dir>
 *
 * Exported for unit testing; callers in this file should use this rather
 * than reimplementing the scan.
 */
export function resolveConfigDirArg(argv: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--config") {
			const value = argv[i + 1]?.trim();
			return value ? value : undefined;
		}
		if (arg?.startsWith("--config=")) {
			const value = arg.slice("--config=".length).trim();
			return value ? value : undefined;
		}
	}
	return undefined;
}

function collectOption(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

// Shells strip quote characters before argv reaches us, so a prompt that was
// typed in quotes is only observable when it remains one argv token with spaces.
function promptArgLooksQuoted(arg: string | undefined): boolean {
	return !!arg && /\s/.test(arg);
}

function writePromptArgError(args: string[]): void {
	const renderedArgs = args.join(" ");
	writeErr(
		`Unknown command or unquoted prompt: ${renderedArgs}\nPrompt text must be passed as a single quoted argument, for example: htc "fix the tests". Use "htc --help" to see available commands and flags.`,
	);
}

function startupTargetTakesPrecedenceOverMigrationNotice(
	target: TuiStartupTarget | undefined,
): boolean {
	return target === "config" || target === "history";
}

export async function runCli(): Promise<void> {
	installStreamErrorGuards();
	// Fingerprint do OpenCode no fio: sem `x-opencode-session` o gateway responde
	// 400 MissingSessionID e o turno morre antes de comecar.
	try {
		const { instalarFingerprintOpenCode } = await import("./utils/opencode-fetch");
		instalarFingerprintOpenCode();
	} catch {
		// sem crypto/fetch global: segue sem o header
	}
	autoUpdateOnStartup();

	const cliArgs = process.argv.slice(2);
	// `htc run "<prompt>"` e o mesmo caminho one-shot de `htc "<prompt>"`.
	if (cliArgs[0] === "run") {
		process.argv.splice(2, 1);
	}
	// Identidade visual: titulo "htc", vermelho CB1B45 e perfil do Windows Terminal.
	if (process.env.HTC_NO_IDENTITY !== "1") {
		const { iniciarIdentidadeTerminal } = await import(
			"./utils/terminal_identity"
		);
		iniciarIdentidadeTerminal();
	}
	// Sem isso o provider local morre em "spawn opencode ENOENT".
	{
		const { garantir_opencode_no_path } = await import("./utils/path_bootstrap");
		garantir_opencode_no_path();
	}
	const isFullTTY =
		process.stdin.isTTY === true && process.stdout.isTTY === true;
	const configDir = resolveConfigDirArg(cliArgs);
	const { setClineDir, setHomeDir } = await import("@cline/shared/storage");
	let raizEstado: string | undefined;
	if (configDir) {
		setClineDir(configDir);
		raizEstado = configDir;
	} else {
		// Estado do HTC vive em ~/.htc (nao em ~/.cline). Migra uma vez o que ja
		// existir do runtime antigo e passa a usar o diretorio proprio.
		const { prepararEstadoHtc } = await import("./utils/estado");
		raizEstado = prepararEstadoHtc();
		setClineDir(raizEstado);
	}
	setHomeDir(homedir());

	// RTK: com o binario instalado, o system prompt passa a instruir `rtk` para
	// saida verbosa (ls/read/grep/git). Sem binario, nada entra. HTC_RTK=off desliga.
	// NAO usar shim de PATH: `rtk ls` chama o `ls` do PATH e o shim vira fork bomb.

	// Auto-reparo antes de qualquer leitura de provider: `saveProviderSettings`
	// do core substitui a entrada inteira, entao uma gravacao parcial anterior
	// (modelo/reasoning) deixa o provider sem apiKey/baseUrl e o boot cai no
	// provider default do catalogo. Aqui a credencial volta do backup.
	{
		const correcoes = repararProvidersDoDisco(caminhoProviders(raizEstado));
		for (const correcao of correcoes) {
			writeErr(`${c.dim}[providers] ${correcao}${c.reset}`);
		}
	}

	// Sidebar por sessao: publica HTC_SIDEBAR_FILE (ops/state/htc_sidebar.<pid>.json)
	// para que quem escreve o estado da operacao acerte o arquivo desta sessao.
	{
		const { prepararSidebar } = await import("./utils/sidebar");
		prepararSidebar(process.cwd());
	}

	// Capture activation telemetry only after config/home directory selection
	// has been applied, so the telemetry singleton's persisted distinct-id
	// (and any other storage it touches) lands under the user-selected
	// `--config <dir>` rather than the default home/config location.
	captureCliExtensionActivated();

	const normalizedArgs = normalizeAutoApproveArgs(cliArgs);

	// Subcommand routing via Commander
	const ctx: {
		exitCode?: number;
		startupTarget?: TuiStartupTarget;
	} = {};
	const io = { writeln, writeErr };
	const program = createProgram();
	// Re-enable built-in help/version output for the routing program
	program.configureOutput({
		writeOut: (str: string) => process.stdout.write(str),
		writeErr: () => {},
	});
	// Default action handles non-subcommand args (e.g. prompt text)
	program.action(() => {});

	// `htc ops`: o painel de operacao mora no CLI, nao em binario separado
	program
		.command("ops")
		.description("abre o painel de operacao (frota, supply, aprovacoes, sessoes, leases)")
		.action(async () => {
			const { rodar } = await import("./ops/painel");
			await rodar();
		});

	// `htc monitor`: LeakRadar como termometro do acervo (contagem e gratis)
	program
		.command("monitor")
		.description("varre o acervo no LeakRadar e mostra o que cresceu desde a ultima passada")
		.argument("[dominios...]", "dominios alvo (default: hosts do acervo)")
		.action(async (dominios: string[]) => {
			const m = await import("./server/monitor");
			const perfil = await m.perfil();
			const r = await m.monitorar(dominios.length ? dominios : m.dominiosDoAcervo(20));
			process.stdout.write(`${JSON.stringify({ perfil, ...r }, null, 1)}\n`);
		});

	// `htc explorar`: sai dos mesmos cantos — propoe provedores novos para o que falta
	program
		.command("explorar")
		.description("propoe novos alvos de provedor (vps/proxy/ia) para o que falta no acervo")
		.option("-n, --limite <n>", "quantos candidatos", "40")
		.action(async (o: { limite?: string }) => {
			const { executar } = await import("./server/explorador");
			process.stdout.write(`${JSON.stringify(executar(Number(o.limite ?? 40)), null, 1)}\n`);
		});

	// /suprimento: pedido em linguagem natural -> mede o acervo e diz onde caçar o que falta
	program
		.command("suprimento")
		.description("pede suprimento (vps/proxy/ia) em linguagem natural e mede o acervo")
		.argument("[texto...]", "ex: 3 vps e 4 api keys de ia, proxy BR residencial")
		.action(async (texto: string[]) => {
			const { executar } = await import("./commands/suprimento");
			const r = await executar((texto ?? []).join(" "));
			process.stdout.write(`${JSON.stringify(r, null, 1)}\n`);
		});

	// Auth subcommand: defines its own options so commander parses them
	// directly. The short flags -p/-m intentionally shadow the root's -p (plan)
	// and -m (model); commander scopes options per-command so there is no
	// conflict.
	const authCmd = program
		.command("auth")
		.description("Authenticate a provider and configure what model is used")
		.argument("[provider]", "Provider id (positional shorthand for -p)")
		.option("-p, --provider <id>", "Provider ID")
		.option("-k, --apikey <key>", "API key")
		.option("-m, --modelid <id>", "Model ID")
		.option("-b, --baseurl <url>", "Base URL")
		.option("--azure-api-version <version>", "Azure API version")
		.option("--config <dir>", "configuration directory")
		.option("-c, --cwd <path>", "Working directory")
		.option(
			"--data-dir <dir>",
			"Use isolated local state at <dir> instead of ~/.cline (enables sandbox mode)",
		)
		.option("-v, --verbose", "Show verbose output")
		.action(async (positionalProvider: string | undefined) => {
			const opts = authCmd.opts<{
				provider?: string;
				apikey?: string;
				modelid?: string;
				baseurl?: string;
				azureApiVersion?: string;
				config?: string;
				cwd?: string;
				dataDir?: string;
				verbose?: boolean;
			}>();
			// Honor --config inside the action as a defense-in-depth measure.
			// The early pre-pass in runCli() also calls setClineDir(), but only
			// for argv tokens it can spot before commander runs. Reapplying
			// here ensures opts.config (parsed by commander, including the
			// --config=<dir> form) is always respected before any provider
			// settings manager is constructed against ~/.cline.
			if (opts.config?.trim()) {
				const { setClineDir } = await import("@cline/shared/storage");
				setClineDir(opts.config.trim());
			}
			// Honor --data-dir before constructing the provider settings manager
			// so writes land under the chosen data dir instead of ~/.cline.
			configureSandboxEnvironment({
				enabled: !!opts.dataDir || process.env.CLINE_SANDBOX?.trim() === "1",
				cwd: opts.cwd ?? process.cwd(),
				explicitDir: opts.dataDir,
			});
			const { runAuthCommand } = await import("./commands/auth");
			const providerSettingsManager = await createProviderSettingsManager();
			ctx.exitCode = await runAuthCommand({
				providerSettingsManager,
				explicitProvider: opts.provider ?? positionalProvider,
				apikey: opts.apikey,
				modelid: opts.modelid,
				baseurl: opts.baseurl,
				azureApiVersion: opts.azureApiVersion,
				io,
			});
		});

	const createConfigRuntimeCommand = async () => {
		const { createConfigCommand } = await import("./commands/config");
		let configCmd: Command;
		configCmd = createConfigCommand(
			() => resolveWorkspaceRoot(program.opts().cwd ?? process.cwd()),
			() => {
				const outputMode =
					program.opts().json || configCmd.opts().json
						? ("json" as const)
						: ("text" as const);
				setCurrentOutputMode(outputMode);
				return outputMode;
			},
			io,
			(code) => {
				ctx.exitCode = code;
			},
			() => {
				ctx.startupTarget = "config";
			},
		);
		return configCmd;
	};

	program
		.command("config")
		.description("Show current configuration")
		.option("--json", "Output as JSON")
		.option("--config <dir>", "configuration directory")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			const realCmd = await createConfigRuntimeCommand();
			await realCmd.parseAsync(cmd.args, { from: "user" });
		});

	const pluginCmd = program
		.command("plugin")
		.description("Manage HTC Plugins")
		.action(() => {
			pluginCmd.help();
		});
	const pluginInstallCmd = pluginCmd
		.command("install")
		.alias("i")
		.description(
			"Install a HTC Plugin from an official keyword, npm, git, URL, or a local path",
		)
		.argument(
			"<source>",
			"official keyword, npm package, git URL, plugin file URL, or local plugin path",
		)
		.option("--npm", "Treat source as an npm package")
		.option("--git", "Treat source as a git repository")
		.option("--force", "Replace an existing install for the same source")
		.option("--json", "Output as JSON")
		.option("--cwd <path>", "Install to <path>/.cline/plugins")
		.action(async (source: string) => {
			const opts = pluginInstallCmd.opts<{
				npm?: boolean;
				git?: boolean;
				force?: boolean;
				json?: boolean;
				cwd?: string;
			}>();
			const sourceTypes = [
				opts.npm ? ("npm" as const) : undefined,
				opts.git ? ("git" as const) : undefined,
			].filter((sourceType) => sourceType !== undefined);
			if (sourceTypes.length > 1) {
				writeErr("plugin install accepts only one source type flag");
				ctx.exitCode = 1;
				return;
			}
			const { runPluginInstallCommand } = await import("./commands/plugin");
			ctx.exitCode = await runPluginInstallCommand({
				source,
				sourceType: sourceTypes[0],
				cwd: opts.cwd,
				force: opts.force === true,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});
	const pluginUninstallCmd = pluginCmd
		.command("uninstall")
		.alias("remove")
		.alias("rm")
		.description("Uninstall a HTC Plugin by name or path")
		.argument("<name>", "plugin package name, installed slug, or plugin path")
		.option("--json", "Output as JSON")
		.option(
			"--cwd <path>",
			"Search <path>/.cline/plugins before global plugins",
		)
		.action(async (name: string) => {
			const opts = pluginUninstallCmd.opts<{
				json?: boolean;
				cwd?: string;
			}>();
			const { runPluginUninstallCommand } = await import("./commands/plugin");
			ctx.exitCode = await runPluginUninstallCommand({
				name,
				cwd: opts.cwd,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});
	const skillCmd = program
		.command("skill")
		.description("Manage HTC Skills via the open skills CLI (npx skills)")
		.allowUnknownOption()
		.passThroughOptions()
		.argument("[args...]", "arguments forwarded to the skills CLI")
		.addHelpText(
			"after",
			"\nForwards to the open skills CLI via npx. Examples:\n" +
				"  htc skill add <owner/repo>       Add a skill into HTC\n" +
				"  htc skill install <owner/repo>   Alias for add\n" +
				"  htc skill list                   List installed skills\n" +
				"  htc skill remove                 Remove installed skills\n" +
				"  htc skill uninstall              Alias for remove\n" +
				"\nadd/install and remove/uninstall default to '--agent htc' unless you pass your own --agent.\n" +
				"Run 'npx skills --help' for the full command reference.",
		)
		.action(async () => {
			const { runSkillCommand } = await import("./commands/skill");
			ctx.exitCode = await runSkillCommand(skillCmd.args, io);
		});

	const connectCmd = program
		.command("connect")
		.description("Connect to an external channel")
		.argument("[channel]", "Channel to connect HTC to")
		.option("--stop", "Kill all current channel connections")
		.option("--restart", "Restart a channel connection")
		.option(
			"--restart-instance <id>",
			"Restart one connector instance (used by daemon recovery)",
		)
		.option(
			"--cleanup-instance <id>",
			"Reap one dead connector instance, preserving autostart (used by hub supervision)",
		)
		.allowUnknownOption()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\nRun 'connect <channel> --help' for channel-specific options.",
		)
		.action(async (adapter: string | undefined) => {
			const {
				formatAdapterList,
				runCleanupConnectorInstance,
				runConnectAdapter,
				runRestartConnector,
				runStopAllConnectors,
				runStopConnector,
			} = await import("./commands/connect");
			const opts = connectCmd.opts();
			const exclusiveModes = [
				opts.stop,
				opts.restart || opts.restartInstance,
				opts.cleanupInstance,
			].filter(Boolean).length;
			if (exclusiveModes > 1) {
				io.writeErr(
					"connect accepts only one of --stop, --restart or --cleanup-instance",
				);
				ctx.exitCode = 1;
			} else if (opts.cleanupInstance) {
				if (!adapter) {
					io.writeErr("connect --cleanup-instance requires a channel");
					ctx.exitCode = 1;
				} else {
					ctx.exitCode = await runCleanupConnectorInstance(
						adapter,
						opts.cleanupInstance,
						io,
					);
				}
			} else if (opts.stop) {
				if (adapter) {
					ctx.exitCode = await runStopConnector(adapter, io);
				} else {
					ctx.exitCode = await runStopAllConnectors(io);
				}
			} else if (opts.restart || opts.restartInstance) {
				if (!adapter) {
					io.writeErr("connect --restart requires a channel");
					ctx.exitCode = 1;
				} else {
					ctx.exitCode = await runRestartConnector(
						adapter,
						connectCmd.args.slice(1),
						io,
						opts.restartInstance,
					);
				}
			} else if (adapter) {
				// connectCmd.args = [adapter, ...passthroughFlags]. Pass only the
				// connector-specific flags (everything after the adapter name).
				ctx.exitCode = await runConnectAdapter(
					adapter,
					connectCmd.args.slice(1),
					io,
				);
			} else if (isFullTTY) {
				ctx.exitCode = await runConnectWizard();
			} else {
				writeln(`\nAdapters:\n${formatAdapterList()}`);
				connectCmd.help();
			}
		});

	const mcpCmd = program
		.command("mcp")
		.description("Manage MCP servers")
		.action(async () => {
			if (isFullTTY) {
				ctx.exitCode = await runMcpWizard();
			} else {
				writeln(
					"MCP wizard requires a TTY. Use cline config mcp to list servers.",
				);
			}
		});
	const mcpInstallCmd = mcpCmd
		.command("install")
		.alias("add")
		.description("Open the MCP add wizard with server fields prefilled")
		.argument("<name>", "MCP server name")
		.argument(
			"[targetArgs...]",
			"URL for remote transports, or command and args after -- for stdio",
		)
		.option(
			"--transport <transport>",
			"stdio, sse, http, streamable-http, or streamableHttp (default: stdio)",
		)
		.option("--header <header>", "Remote MCP request header", collectOption, [])
		.option("--yes", "Install noninteractively without opening the wizard")
		.option("--json", "Output as JSON")
		.action(async (name: string, targetArgs: string[]) => {
			const opts = mcpInstallCmd.opts<{
				header?: string[];
				json?: boolean;
				transport?: string;
				yes?: boolean;
			}>();
			const { runMcpInstallCommand } = await import("./commands/mcp");
			ctx.exitCode = await runMcpInstallCommand({
				name,
				headers: opts.header,
				targetArgs,
				transport: opts.transport,
				json: opts.json === true || program.opts().json === true,
				yes: opts.yes === true,
				io,
			});
		});
	const mcpUninstallCmd = mcpCmd
		.command("uninstall")
		.alias("remove")
		.alias("rm")
		.description("Uninstall an MCP server by name")
		.argument("<name>", "MCP server name")
		.option("--json", "Output as JSON")
		.action(async (name: string) => {
			const opts = mcpUninstallCmd.opts<{
				json?: boolean;
			}>();
			const { runMcpUninstallCommand } = await import("./commands/mcp");
			ctx.exitCode = await runMcpUninstallCommand({
				name,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});

	const createDoctorRuntimeCommand = async () => {
		const { createDoctorCommand } = await import("./commands/doctor");
		return createDoctorCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("doctor")
		.description("Diagnose and fix configuration issues")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\nCommands:\n  fix  Kill all running processes\n  log  Open the CLI log file\n",
		)
		.action(async (_opts: unknown, cmd: Command) => {
			const doctorCmd = await createDoctorRuntimeCommand();
			await doctorCmd.parseAsync(cmd.args, { from: "user" });
		});

	program
		.command("uninstall")
		.description("Remove o HTC do sistema (binario, estado e PATH)")
		.option("--keep-state", "Preserva ~/.htc (sessoes e config)")
		.option("--dry-run", "Mostra o que seria removido, sem apagar")
		.option("-f, --force", "Executa sem pedir confirmacao (alias: --yes)")
		.option("--yes", "Alias de --force")
		.action(async (_opts: unknown, cmd: Command) => {
			const opts = cmd.opts<{
				keepState?: boolean;
				yes?: boolean;
				dryRun?: boolean;
				force?: boolean;
			}>();
			const { runUninstall } = await import("./commands/uninstall");
			ctx.exitCode = await runUninstall({
				keepState: opts.keepState === true,
				yes: opts.yes === true || opts.force === true,
				dryRun: opts.dryRun === true,
			});
		});

	const debugCmd = program
		.command("debug")
		.description("Diagnostico (caminhos, estado)");
	debugCmd
		.command("paths")
		.description("Imprime caminhos locais: config, data, cache, state, bin, log")
		.argument("[selector]", "all|home|config|data|cache|state|bin|log", "all")
		.action(async (selector: string) => {
			const { runDebugPaths } = await import("./commands/debug");
			ctx.exitCode = await runDebugPaths(selector);
		});
	debugCmd.action(() => {
		debugCmd.help();
	});

	program
		.command("providers")
		.description("Canais free locais (dsh, gemini) — loopback")
		.argument("[id]", "dsh|gemini|up")
		.argument("[acao]", "on|off")
		.action(async (id: string | undefined, acao: string | undefined) => {
			const { runProviders } = await import("./commands/providers");
			ctx.exitCode = await runProviders({ id, acao });
		});

	program
		.command("missao [args...]")
		.description("Estado da operacao (alvo/fase/achados/shells) que sobrevive ao turno")
		.option("--status", "mostra a missao atual")
		.option("--json", "imprime o estado cru")
		.option("--novo", "troca de alvo mesmo com missao aberta")
		.option("--objetivo <txt>", "objetivo (default: shell interativo no alvo)")
		.option("--escopo <lista>", "hosts permitidos, separados por virgula")
		.option("--fase <fase>", "recon|enum|vetor|exploit|shell|pos (legado)")
		.option("--op <nome>", "opera a missao de uma lane (op1/op2) em vez da sessao")
		.option(
			"--degrau <degrau>",
			"ecossistema|superficie|entrada|webshell|tunel|pivo|credencial|sessao|ordem|transferencia",
		)
		.option("--shell <host>", "registra shell aberta (exige -e com a prova)")
		.option("--caixa", "mostra a caixa de contexto (constantes, hash e fontes)")
		.option("--transporte <t>", "transporte da shell (tcp, http, smb...)")
		.option("-e, --evidencia <txt>", "evidencia do achado/shell")
		.option("--validado", "marca o achado como validado")
		.option("--fechar", "encerra a missao")
		.action(async (args: string[], opts: Record<string, unknown>) => {
			const { runMissao } = await import("./commands/missao");
			ctx.exitCode = await runMissao({
				args,
				status: opts.status === true,
				json: opts.json === true,
				novo: opts.novo === true,
				objetivo: typeof opts.objetivo === "string" ? opts.objetivo : undefined,
				escopo: typeof opts.escopo === "string" ? opts.escopo : undefined,
				op: typeof opts.op === "string" ? opts.op : undefined,
				fase: typeof opts.fase === "string" ? opts.fase : undefined,
				degrau: typeof opts.degrau === "string" ? opts.degrau : undefined,
				caixa: opts.caixa === true,
				shell: typeof opts.shell === "string" ? opts.shell : undefined,
				transporte: typeof opts.transporte === "string" ? opts.transporte : undefined,
				evidencia: typeof opts.evidencia === "string" ? opts.evidencia : undefined,
				validado: opts.validado === true,
				fechar: opts.fechar === true,
			});
		});

	program
		.command("op [args...]")
		.description("Lanes nomeadas (OP1/OP2): estado medido, prompt gerado e sessao em background")
		.option("--status", "board das lanes (default)")
		.option("--json", "imprime o estado cru de cada lane")
		.option("--novo", "cria/atualiza a lane (nome no positional, alvo em --alvo)")
		.option("--alvo <host>", "host principal da lane")
		.option("--objetivo <txt>", "objetivo da lane")
		.option("--escopo <lista>", "hosts da lane, separados por virgula")
		.option("--instrumento <txt>", "fixa o primeiro instrumento do degrau (vazio = motor escolhe)")
		.option("--prompt", "imprime o prompt gerado do estado")
		.option("--abrir", "grava o prompt e mostra o comando da sessao")
		.option("--spawn", "com --abrir: abre a sessao em background (-z)")
		.option("--loop", "vigia: turnos seguidos ate o objetivo, com steer e relatorio")
		.option("--detach", "com --loop: roda o vigia em background (pode fechar o terminal)")
		.option("--horas <n>", "prazo do vigia em horas (default 3)", Number)
		.option("--turnos <n>", "teto de turnos do vigia (default 24)", Number)
		.option("--teto-turno <min>", "teto por turno em minutos (default 25)", Number)
		.option("--intervalo <s>", "pausa entre turnos em segundos (default 20)", Number)
		.option("--limite-secos <n>", "turnos sem artefato antes do steer (default 3)", Number)
		.option("--log", "ultimos turnos do vigia desta lane")
		.option("--relatorio", "relatorio da lane para ler ao acordar")
		.option("--parar", "sinaliza parada do vigia no fim do turno corrente")
		.option("--fechar", "fecha a lane (o estado da missao continua no disco)")
		.action(async (args: string[], opts: Record<string, unknown>) => {
			const { runOp } = await import("./commands/op");
			ctx.exitCode = await runOp({
				args,
				status: opts.status === true,
				json: opts.json === true,
				novo: opts.novo === true,
				alvo: typeof opts.alvo === "string" ? opts.alvo : undefined,
				objetivo: typeof opts.objetivo === "string" ? opts.objetivo : undefined,
				escopo: typeof opts.escopo === "string" ? opts.escopo : undefined,
				instrumento: typeof opts.instrumento === "string" ? opts.instrumento : undefined,
				prompt: opts.prompt === true,
				abrir: opts.abrir === true,
				spawn: opts.spawn === true,
				loop: opts.loop === true,
				detach: opts.detach === true,
				horas: typeof opts.horas === "number" ? opts.horas : undefined,
				turnos: typeof opts.turnos === "number" ? opts.turnos : undefined,
				tetoTurno: typeof opts.tetoTurno === "number" ? opts.tetoTurno : undefined,
				intervalo: typeof opts.intervalo === "number" ? opts.intervalo : undefined,
				limiteSecos:
					typeof opts.limiteSecos === "number" ? opts.limiteSecos : undefined,
				log: opts.log === true,
				relatorio: opts.relatorio === true,
				parar: opts.parar === true,
				fechar: opts.fechar === true,
			});
		});

	program
		.command("fila [args...]")
		.description("Fila de alvos: um alvo por turno, uma fila por sessao")
		.option("--json", "imprime a fila crua")
		.option("--sessao <id>", "opera a fila de uma sessao especifica")
		.option("--op <nome>", "opera a fila de uma lane (op1/op2) — vale mais que a sessao")
		.option("--todas", "limpar: apaga a fila global, a de cada sessao e a pendente")
		.option("-e, --evidencia <txt>", "motivo ao estacionar um alvo")
		.action(async (args: string[], opts: Record<string, unknown>) => {
			const { runFila } = await import("./commands/fila");
			ctx.exitCode = await runFila({
				args,
				json: opts.json === true,
				sessao: typeof opts.sessao === "string" ? opts.sessao : undefined,
				op: typeof opts.op === "string" ? opts.op : undefined,
				todas: opts.todas === true,
				evidencia: typeof opts.evidencia === "string" ? opts.evidencia : undefined,
			});
		});

	program
		.command("correlacao")
		.description("Corpus dos achados por host + brief do turno (grava ops/corpus.md)")
		.option("--digest", "imprime o corpus inteiro, host por host")
		.option("--brief", "imprime so o pedido do turno de correlacao")
		.option("--json", "imprime o corpus cru")
		.option("--sem-gravar", "nao escreve no disco (leitura apenas)")
		.option("--host <host>", "recorta o corpus a um host (URL, dominio ou host:porta)")
		.action(async (opts: Record<string, unknown>) => {
			const { runCorrelacao } = await import("./commands/correlacao");
			ctx.exitCode = await runCorrelacao({
				digest: opts.digest === true,
				brief: opts.brief === true,
				json: opts.json === true,
				semGravar: opts.semGravar === true,
				host: typeof opts.host === "string" ? opts.host : undefined,
			});
		});

	program
		.command("slot [args...]")
		.description("Credenciais por sessao: um provider (go-slot-N) por slot")
		.option("--json", "imprime os slots crus")
		.action(async (args: string[], opts: Record<string, unknown>) => {
			const { runSlot } = await import("./commands/slots");
			ctx.exitCode = await runSlot({
				args,
				json: opts.json === true,
			});
		});

	program
		.command("rtk [args...]")
		.description("Compressao de saida de comando (rtk-ai/rtk): status, shims, ganhos")
		.action(async (args: string[]) => {
			const { runRtk } = await import("./commands/rtk");
			ctx.exitCode = await runRtk({ args });
		});

	program
		.command("doutrina")
		.description("Doutrina do operador: regras, egress, vault de notas e deteccao")
		.option("--init", "cria o arquivo de doutrina (nao sobrescreve)")
		.option("--json", "imprime o arquivo cru")
		.action(async (opts: { init?: boolean; json?: boolean }) => {
			const {
				carregarDoutrina,
				caminhoDoutrina,
				garantirDoutrinaExemplo,
				textoDoutrina,
			} = await import("./runtime/doutrina");
			const caminho = caminhoDoutrina();
			if (opts.init) {
				const { criado } = garantirDoutrinaExemplo();
				writeln(
					criado
						? `${c.green}criado${c.reset} ${caminho}`
						: `${c.dim}ja existe${c.reset} ${caminho}`,
				);
			}
			const { doutrina, avisos } = carregarDoutrina();
			if (opts.json) {
				const { readFileSync } = await import("node:fs");
				try {
					writeln(readFileSync(caminho, "utf8").trimEnd());
				} catch {
					writeln(`${c.dim}(sem arquivo em ${caminho})${c.reset}`);
				}
			} else {
				writeln(`${c.dim}arquivo${c.reset}  ${caminho}`);
				const bloco = textoDoutrina(doutrina);
				writeln(bloco || `${c.dim}(vazio — nada e injetado no system)${c.reset}`);
			}
			for (const aviso of avisos) writeln(`${c.yellow}aviso:${c.reset} ${aviso}`);
			ctx.exitCode = 0;
		});

	program
		.command("lab")
		.description("Laboratorio: mede taxa de entrega do bypass")
		.command("bypass")
		.description("Roda as sondas de recusa e mede artefato por variante de payload")
		.option("--variant <id>", `variante: ${PAYLOADS_IDS}`)
		.option("--only <ids>", "so estas sondas (lista separada por virgula)")
		.option("--runs <n>", "repeticoes por sonda", "1")
		.option("-P, --provider <id>", "provider do one-shot")
		.option("-m, --modelo <id>", "modelo do one-shot")
		.option("--timeout <ms>", "timeout por sonda", "180000")
		.option("--setor", "só as sondas de setor (banco/pagamento/terceiros)")
		.option("--todos", "sondas técnicas + setor")
		.option("--mock", "valida o harness sem rede nem token")
		.option("--json", "relatorio em JSON")
		.option("--out <arquivo>", "grava o relatorio")
		.action(async (opts: Record<string, string | boolean>) => {
			const { runLabBypass } = await import("./commands/lab");
			ctx.exitCode = await runLabBypass({
				variante: typeof opts.variant === "string" ? opts.variant : undefined,
				only: typeof opts.only === "string" ? opts.only : undefined,
				runs: typeof opts.runs === "string" ? opts.runs : undefined,
				provider: typeof opts.provider === "string" ? opts.provider : undefined,
				modelo: typeof opts.modelo === "string" ? opts.modelo : undefined,
				timeout: typeof opts.timeout === "string" ? opts.timeout : undefined,
				out: typeof opts.out === "string" ? opts.out : undefined,
				setor: opts.setor === true,
				todos: opts.todos === true,
				json: opts.json === true,
				mock: opts.mock === true,
			});
		});

	program
		.command("free")
		.description("Sonda um endpoint OpenAI local (modelos free) e mostra como usar")
		.option("--base <url>", "Base URL (default: HTC_FREE_BASE ou http://127.0.0.1:3000/v1)")
		.option("-k, --key <chave>", "Chave do painel (default: HTC_FREE_KEY)")
		.action(async (_opts: unknown, cmd: Command) => {
			const opts = cmd.opts<{ base?: string; key?: string }>();
			const { runFree } = await import("./commands/free");
			ctx.exitCode = await runFree({ base: opts.base, key: opts.key });
		});

	program
		.command("upgrade")
		.description("Atualiza o HTC (e o runtime do cline quando a release inclui)")
		.option("--check", "So verifica, sem baixar")
		.option("-f, --force", "Reinstala a versao atual")
		.action(async (_opts: unknown, cmd: Command) => {
			const opts = cmd.opts<{ check?: boolean; force?: boolean }>();
			const { runUpgrade } = await import("./commands/upgrade");
			ctx.exitCode = await runUpgrade({
				check: opts.check === true,
				force: opts.force === true,
			});
		});

	registerHistoryCommand({
		program,
		io,
		setExitCode: (code) => {
			ctx.exitCode = code;
		},
		setStartupTarget: (target) => {
			ctx.startupTarget = target;
		},
		isInteractiveTTY: () => isFullTTY,
	});

	program
		.command("hook")
		.description("Handle a hook payload from stdin")
		.allowUnknownOption()
		.allowExcessArguments()
		.action(async () => {
			const { runHookCommand } = await import("./commands/hook");
			ctx.exitCode = await runHookCommand(io);
		});

	const createScheduleRuntimeCommand = async () => {
		const { createScheduleCommand } = await import("./commands/schedule");
		return createScheduleCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};
	const createHubRuntimeCommand = async () => {
		const { createHubCommand } = await import("./commands/hub");
		return createHubCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("schedule")
		.description("Manage scheduled tasks")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			if (cmd.args.length === 0 && isFullTTY) {
				ctx.exitCode = await runScheduleWizard();
				return;
			}
			const scheduleCmd = await createScheduleRuntimeCommand();
			await scheduleCmd.parseAsync(cmd.args, { from: "user" });
		});
	program
		.command("hub")
		.description("Manage the local hub daemon")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			const hubCmd = await createHubRuntimeCommand();
			await hubCmd.parseAsync(cmd.args, { from: "user" });
		});

	const dashboardCmd = program
		.command("dashboard")
		.description("Start the Cline Hub dashboard and open it in a browser")
		.option("--config <dir>", "configuration directory")
		.option("-c, --cwd <path>", "Workspace root", process.cwd())
		.option(
			"--data-dir <dir>",
			"Use isolated local state at <dir> instead of ~/.cline (enables sandbox mode)",
		)
		.option("--host <host>", "Dashboard bind host")
		.option("--port <port>", "Dashboard HTTP/WebSocket port")
		.option("--public-url <url>", "Public dashboard URL")
		.option("--room-secret <secret>", "Invite secret for browser access")
		.option("--no-open", "Start the dashboard without opening a browser")
		.action(async () => {
			const opts = dashboardCmd.opts<{
				config?: string;
				cwd?: string;
				dataDir?: string;
				host?: string;
				port?: string;
				publicUrl?: string;
				roomSecret?: string;
				open?: boolean;
			}>();
			const { runDashboardCommand } = await import("./commands/dashboard");
			ctx.exitCode = await runDashboardCommand({
				configDir: opts.config,
				cwd: opts.cwd,
				dataDir: opts.dataDir,
				host: opts.host,
				port: opts.port,
				publicUrl: opts.publicUrl,
				roomSecret: opts.roomSecret,
				openBrowser: opts.open !== false,
				io,
			});
		});

	const updateCmd = program
		.command("update")
		.description("Check for updates and install if available")
		.allowUnknownOption()
		.allowExcessArguments()
		.option("-v, --verbose", "Show verbose output")
		.option("--config <dir>", "configuration directory")
		.action(async () => {
			const { checkForUpdates } = await import("./commands/update");
			ctx.exitCode = await checkForUpdates({
				verbose: updateCmd.opts().verbose === true,
			});
		});

	program
		.command("version")
		.description("Show HTC version number")
		.action(async () => {
			const { showVersion } = await import("./commands/help");
			showVersion();
			ctx.exitCode = 0;
		});

	program
		.command("kanban")
		.description("Abre o kanban do Cline (repassa flags: --no-open, --port)")
		.allowUnknownOption(true)
		.argument("[args...]", "flags repassadas ao kanban")
		.action(async (args: string[]) => {
			const { launchKanban } = await import("./commands/kanban");
			ctx.exitCode = await launchKanban({ args });
		});

	// Familia da bridge: `opencode` e `claude` sobem a bridge local no MESMO
	// fluxo do cliente e a encerram na saida; `serve` sobe so a bridge, para
	// quem liga o eixo de outro canto. Todos leem o mesmo ConfigBridge.
	const aplicar_opcoes_bridge = (cmd: Command): Command =>
		cmd
			.option("--host <host>", "Bridge bind host (default: 127.0.0.1)")
			.option("--port <port>", "Bridge port (default: 8788; first free above it)")
			.option("-P, --provider <id>", "Upstream provider id for the bridge")
			.option("-m, --model <id>", "Default upstream model for the bridge");

	const ler_opcoes_bridge = (
		cmd: Command,
	): { erro: string } | { config: Partial<ConfigBridge> } => {
		const opts = cmd.opts<{
			host?: string;
			port?: string;
			provider?: string;
			model?: string;
		}>();
		const config: Partial<ConfigBridge> = {};
		if (opts.host?.trim()) config.host = opts.host.trim();
		if (opts.provider?.trim()) config.providerId = opts.provider.trim();
		if (opts.model?.trim()) config.modelo = opts.model.trim();
		if (opts.port !== undefined) {
			const porta = Number.parseInt(opts.port, 10);
			if (!Number.isInteger(porta) || porta <= 0) {
				return { erro: `invalid --port "${opts.port}" (expected integer >= 1)` };
			}
			config.port = porta;
		}
		return { config };
	};

	const opencodeCmd = aplicar_opcoes_bridge(
		program
			.command("opencode")
			.description("Start the raehook bridge and launch OpenCode against it")
			.allowUnknownOption()
			.allowExcessArguments(),
	).action(async () => {
		const lidas = ler_opcoes_bridge(opencodeCmd);
		if ("erro" in lidas) {
			writeErr(lidas.erro);
			ctx.exitCode = 1;
			return;
		}
		const { runOpenCodeCommand } = await import("./bridge/opencode_command");
		ctx.exitCode = await runOpenCodeCommand({
			...lidas.config,
			argsOpenCode: opencodeCmd.args,
		});
	});

	const claudeCmd = aplicar_opcoes_bridge(
		program
			.command("claude")
			.description("Start the raehook bridge and launch Claude Code against it")
			.allowUnknownOption()
			.allowExcessArguments(),
	).action(async () => {
		const lidas = ler_opcoes_bridge(claudeCmd);
		if ("erro" in lidas) {
			writeErr(lidas.erro);
			ctx.exitCode = 1;
			return;
		}
		const { runClaudeCommand } = await import("./bridge/claude_command");
		ctx.exitCode = await runClaudeCommand({
			...lidas.config,
			argsClaude: claudeCmd.args,
		});
	});

	const serveCmd = aplicar_opcoes_bridge(
		program
			.command("serve")
			.description("Run the raehook bridge only (Claude Code / remote clients)"),
	).action(async () => {
		const lidas = ler_opcoes_bridge(serveCmd);
		if ("erro" in lidas) {
			writeErr(lidas.erro);
			ctx.exitCode = 1;
			return;
		}
		const { runServeCommand } = await import("./bridge/serve_command");
		ctx.exitCode = await runServeCommand(lidas.config);
	});

	program
		.command("web")
		.description("Painel web da frota (leitura + aprovacoes)")
		.option("-p, --port <n>", "porta", "8787")
		.action(async (opts: { port: string }) => {
			const { iniciarWeb } = await import("./server/web");
			const { url } = iniciarWeb(Number(opts.port) || 8787);
			console.log(`[htc web] ${url}`);
			// segura o processo: sem isso o commander cai no handler de prompt e mata o servidor
			await new Promise(() => {});
		});


	const pediuAjuda =
		normalizedArgs.length === 1 &&
		["--help", "-h", "help"].includes(normalizedArgs[0] ?? "");
	if (pediuAjuda) {
		const { printHtcHelp } = await import("./commands/help-htc");
		const { version } = await import("../package.json");
		printHtcHelp(program, version);
		ctx.exitCode = 0;
		return;
	}

	try {
		await program.parseAsync(normalizedArgs, { from: "user" });
	} catch (err: unknown) {
		if (err instanceof CommanderError) {
			if (err.exitCode !== 0) {
				writeErr(err.message);
				process.exitCode = err.exitCode;
				return;
			}
			return;
		}
		throw err;
	}

	if (ctx.exitCode !== undefined) {
		process.exitCode = ctx.exitCode;
		return;
	}

	const rootOpts = program.opts<{
		kanban?: boolean;
		tui?: boolean;
		update?: boolean;
		verbose?: boolean;
	}>();
	if (rootOpts.update) {
		if (rootOpts.kanban || rootOpts.tui || program.args.length > 0) {
			writeErr("Use --update without a prompt or task flags.");
			process.exitCode = 1;
			return;
		}
		const { checkForUpdates } = await import("./commands/update");
		process.exitCode = await checkForUpdates({
			verbose: rootOpts.verbose === true,
		});
		return;
	}
	if (rootOpts.kanban) {
		if (rootOpts.tui) {
			writeErr("Use either --kanban or --tui, not both.");
			process.exitCode = 1;
			return;
		}
		if (program.args.length > 0) {
			writeErr("Use --kanban without a prompt.");
			process.exitCode = 1;
			return;
		}
		const { launchKanban } = await import("./commands/kanban");
		process.exitCode = await launchKanban();
		return;
	}

	// Default flow: no subcommand matched, or fall-through from config/history.
	let args = commanderToParsedArgs(program);

	let startupTarget = ctx.startupTarget;
	let resumeSessionId: string | undefined;
	if (args.id !== undefined) {
		const sessionId = args.id.trim();
		if (!sessionId) {
			writeErr("--id requires <session-id>");
			process.exitCode = 1;
			return;
		}
		resumeSessionId = sessionId;
		startupTarget = "chat";
		process.env.CLINE_HOOK_AGENT_RESUME = "1";
	} else {
		delete process.env.CLINE_HOOK_AGENT_RESUME;
	}
	if (startupTarget) {
		args = {
			...args,
			interactive: true,
			// `--tui` sozinho abre vazio; `--id` + prompt abre a conversa E manda
			// a mensagem (continuacao automatica apos o restart do atualizador).
			prompt: args.prompt?.trim() ? args.prompt : undefined,
		};
	}

	if (args.invalidThinkingLevel) {
		writeErr(
			`invalid thinking level "${args.invalidThinkingLevel}" (expected "none", "low", "medium", "high", or "xhigh")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidCompactionMode) {
		writeErr(
			`invalid compaction mode "${args.invalidCompactionMode}" (expected ${CLI_COMPACTION_MODE_EXPECTED_TEXT})`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidAutoApprove) {
		writeErr(
			`invalid auto-approve value "${args.invalidAutoApprove}" (expected "true" or "false")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidTimeoutSeconds) {
		writeErr(
			`invalid timeout "${args.invalidTimeoutSeconds}" (expected integer >= 1)`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidAutoContinue) {
		writeErr(
			`invalid auto-continue value "${args.invalidAutoContinue}" (expected "true" or "false")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidMaxAutoContinues) {
		writeErr(
			`invalid max-auto-continues "${args.invalidMaxAutoContinues}" (expected integer >= 1, or 0/inf for no limit)`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidAgents) {
		writeErr(
			`invalid agents value "${args.invalidAgents}" (expected "true" or "false")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidRetries) {
		writeln(
			`${c.dim}[warn] ignoring invalid --retries value "${args.invalidRetries}" (expected integer >= 1)${c.reset}`,
		);
	}
	if (args.hooksDir?.trim()) {
		process.env.CLINE_HOOKS_DIR = args.hooksDir.trim();
	}
	if (args.prompt && !args.interactive) {
		// Uma palavra so e prompt valido quando NAO colide com um subcomando:
		// `htc ping` deve rodar "ping", enquanto `htc histroy` e erro de digitacao.
		const nomesDeComando = new Set(program.commands.map((cmd) => cmd.name()));
		const primeira = program.args[0];
		const palavraSolta =
			program.args.length === 1 &&
			!!primeira &&
			!nomesDeComando.has(primeira) &&
			!/^-/.test(primeira);
		if (
			program.args.length > 1 ||
			(!promptArgLooksQuoted(primeira) && !palavraSolta)
		) {
			writePromptArgError(program.args);
			process.exitCode = 1;
			return;
		}
	}
	setCurrentOutputMode(args.outputMode);

	if (args.outputMode === "json" && (args.interactive || !args.prompt)) {
		writeErr(
			"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)",
		);
		process.exitCode = 1;
		return;
	}

	// ACP mode: not available in HTC CLI
	if (args.acpMode) {
		writeErr("ACP mode not available in HTC CLI");
		return;
	}

	if (args.worktree) {
		if (
			!args.prompt &&
			!resumeSessionId &&
			!stdinHasPipedInput() &&
			!isFullTTY
		) {
			writeErr("--worktree without a prompt requires an interactive terminal.");
			process.exitCode = 1;
			return;
		}
		if (resumeSessionId) {
			const { getSessionRow } = await import("./session/session");
			const session = await getSessionRow(resumeSessionId);
			if (!session) {
				writeErr(`Session not found: ${resumeSessionId}`);
				process.exitCode = 1;
				return;
			}
		}
		const { createTaskWorktree } = await import("./utils/worktree");
		const sourceCwd = args.cwd ?? process.cwd();
		const result = await createTaskWorktree({ cwd: sourceCwd });
		if (!result.success || !result.path) {
			writeErr(`--worktree failed: ${result.message}`);
			process.exitCode = 1;
			return;
		}
		writeln(`Created worktree at ${result.path}`);
		args = {
			...args,
			cwd: result.path,
		};
	}

	const cwd = args.cwd ?? process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	if (indexacao_do_workspace_bloqueada(workspaceRoot)) {
		// Home/ancestral/raiz como workspace faz o indice de arquivos passar de
		// centenas de milhares de caminhos e estourar a RAM do processo.
		writeln(`${c.yellow}${aviso_de_workspace_largo(workspaceRoot)}${c.reset}`);
	}
	// Sandbox mode is enabled implicitly whenever --data-dir is provided, or
	// when CLINE_SANDBOX=1 is set in the environment (in which case the data
	// dir falls back to $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox).
	const sandboxEnabled =
		!!args.dataDir || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.dataDir,
	});

	// Keep command-style subcommands on a narrow path. Runtime-only imports pull
	// in provider resolution, config services, and session startup wiring that
	// should only load when the CLI is actually starting an agent session.
	const providerSettingsManager = await createProviderSettingsManager();
	await ensureDeepSeekProvider(providerSettingsManager);
	// Slots de credencial (go-slot-N): cada sessao escolhe o dela no /model.
	// Publica em background — config ausente nao atrasa o boot.
	void (async () => {
		try {
			const { aplicarSlots } = await import("./utils/slots");
			await aplicarSlots(providerSettingsManager);
		} catch {
			// sem slots configurados: segue o jogo
		}
	})();
	// Catalogo do canal free (htc-free) em segundo plano, para nao atrasar o
	// boot num endpoint que pode estar dormindo.
	void (async () => {
		try {
			const { sincronizarTodosOsFree } = await import("./utils/free-models");
			await sincronizarTodosOsFree(providerSettingsManager);
			const { registrarProvidersCustom } = await import("./utils/provider-registry");
			await registrarProvidersCustom(providerSettingsManager);
		} catch {
			// sem endpoint: segue com o catalogo que ja estava
		}
	})();
	await ensureFreeProvider(providerSettingsManager);
	const {
		coreServer,
		coreServer: { createUserInstructionConfigService },
		resolveSystemPrompt,
		runAgent,
	} = await loadCliRuntimeModules();

	// General settings toggled in the TUI /settings panel persist to the
	// global settings file; explicit CLI flags take precedence over the
	// persisted values, which in turn override the built-in defaults.
	const persistedGlobalSettings = coreServer.readGlobalSettings();
	const defaultToolAutoApprove = true;
	const effectiveToolAutoApprove = resolveStartupToolAutoApprove(
		args,
		persistedGlobalSettings,
		defaultToolAutoApprove,
	);
	const toolPolicies: Record<string, ToolPolicy> = {
		"*": {
			autoApprove: effectiveToolAutoApprove,
		},
	};
	const effectiveMode = resolveStartupMode(args, persistedGlobalSettings);
	const effectiveCompactionMode = resolveStartupCompactionMode(
		args,
		persistedGlobalSettings,
	);

	// Register the SDK early logger as early as possible — before any
	// provider settings reads — so the full startup sequence is captured.
	// These components operate before/outside ClineCore sessions, so the
	// session-scoped logger can't reach them.
	const { createCliLoggerAdapter } = await import("./logging/adapter");
	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "main",
	});
	coreServer.setSdkLogger(loggerAdapter.core);

	const userInstructionService = createUserInstructionConfigService({
		skills: {
			workspacePath: workspaceRoot,
			includePluginSkills: true,
			cwd,
		},
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	await userInstructionService.start().catch(() => {});
	let userInstructionServiceDisposed = false;
	const stopUserInstructionService = () => {
		if (userInstructionServiceDisposed) {
			return;
		}
		userInstructionServiceDisposed = true;
		userInstructionService.stop();
	};
	registerDisposable(stopUserInstructionService);
	try {
		const persistedClineAccountId = providerSettingsManager
			.getProviderSettings("cline")
			?.auth?.accountId?.trim();
		if (persistedClineAccountId) {
			setCliFeatureFlagsAccountContext({ id: persistedClineAccountId });
		}
		refreshCliFeatureFlagsInBackground();
		const lastUsedProviderSettings =
			providerSettingsManager.getLastUsedProviderSettings({
				isClinePassEnabled: true,
			});
		// Retomar volta no provider/modelo DA SESSAO, nao no ultimo global.
		// O marcador (gravado a cada start e a cada troca em /model) e a fonte
		// que sobrevive ao restart; o core cobre sessao antiga de outro processo.
		if (resumeSessionId) {
			try {
				const { lerUltimaSessao } = await import("./runtime/last-session");
				const marcada = lerUltimaSessao();
				if (marcada && marcada.sessionId === resumeSessionId) {
					if (!args.provider?.trim() && marcada.provider) {
						args.provider = marcada.provider;
					}
					if (!args.model?.trim() && marcada.model) {
						args.model = marcada.model;
					}
				}
			} catch {
				// marcador ausente: segue para o core
			}
			if (!args.provider?.trim() || !args.model?.trim()) {
				try {
					const { getSessionRow } = await import("./session/session");
					const anterior = await getSessionRow(resumeSessionId);
					if (anterior) {
						if (!args.provider?.trim() && anterior.provider) {
							args.provider = anterior.provider;
						}
						if (!args.model?.trim() && anterior.model) {
							args.model = anterior.model;
						}
					}
				} catch {
					// sessao ilegivel: segue com a config atual
				}
			}
		}
		const provider = normalizeProviderId(
			args.provider?.trim() ||
				lastUsedProviderSettings?.provider ||
				// Sem escolha previa: o provider local (opencode) roda sem chave.
				// "cline" so entra se o operador escolher em /settings ou --provider.
				"opencode",
		);
		let selectedProviderSettings =
			providerSettingsManager.getProviderSettings(provider);

		// Apply locally persisted Cline account identity so subsequent events
		// (task.*, workspace.initialized) carry user_id when available.
		// Note: user.extension_activated fires anonymously earlier in startup
		// and cannot be retroactively updated; this is by design for
		// lightweight subcommand and pre-auth CLI flows. See CLINE-2406.
		if (provider === "cline") {
			const savedAuth = selectedProviderSettings?.auth;
			if (savedAuth?.accountId) {
				identifyTelemetryAccount({
					id: savedAuth.accountId,
					provider: "cline",
					organizationId: savedAuth.organizationId,
					organizationName: savedAuth.organizationName,
					memberId: savedAuth.memberId,
				});
			}
		}

		const persistedApiKey = getPersistedProviderApiKey(
			provider,
			selectedProviderSettings,
		);
		const providedApiKey = args.key?.trim() || undefined;
		let apiKey = providedApiKey || persistedApiKey || undefined;

		const isYoloMode = args.mode === "yolo";
		const isZenMode = args.mode === "zen";

		// In headless mode (yolo / json / piped stdin without --tui),
		// don't attempt browser-based OAuth. Authentication may still resolve at
		// runtime from environment-based provider auth or persisted OAuth tokens.
		const isHeadless =
			isYoloMode ||
			isZenMode ||
			args.outputMode === "json" ||
			(!process.stdin.isTTY && !args.interactive);
		const isInteractive = (args.interactive || !args.prompt) && !isHeadless;

		if (!apiKey && isOAuthProvider(provider) && !isHeadless && !isInteractive) {
			const oauthResult = await ensureOAuthProviderApiKey({
				providerId: provider,
				currentApiKey: apiKey,
				existingSettings: selectedProviderSettings,
				providerSettingsManager,
				io: { writeln, writeErr },
			});
			selectedProviderSettings =
				oauthResult?.selectedProviderSettings ?? selectedProviderSettings;
			apiKey = oauthResult?.apiKey ?? apiKey;
		}

		// O endpoint do OpenCode (Zen/Go) exige o fingerprint do cliente; sem ele
		// o upstream devolve 400 "Request is missing x-opencode-session". O
		// fingerprint vai em `settings.headers` do provider (o core repassa ao
		// handler) e e garantido aqui, ANTES de ler a config que o run usa.
		garantir_fingerprint_do_opencode(providerSettingsManager, provider);

		let knownModels: Config["knownModels"];
		try {
			const persistedProviderConfig = providerSettingsManager.getProviderConfig(
				provider,
				{
					includeKnownModels: false,
				},
			);
			const catalogOptions = isInteractive
				? {
						loadLatestOnInit: true,
						loadPrivateOnAuth: true,
						failOnError: false,
					}
				: undefined;
			const resolvedProviderConfig = await coreServer.resolveProviderConfig(
				provider,
				catalogOptions,
				persistedProviderConfig,
			);
			knownModels = resolvedProviderConfig?.knownModels;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[model-catalog] catalog resolution failed (${message})${c.reset}`,
			);
		}
		const knownModelIds = knownModels
			? Object.keys(filterChatModels(knownModels))
			: [];
		const resolvedReasoning = resolveCliReasoning({
			thinking: args.thinking,
			thinkingExplicitlySet: args.thinkingExplicitlySet,
			reasoningEffort: args.reasoningEffort,
			persistedReasoning: selectedProviderSettings?.reasoning,
		});
		// A flag so vale se virar ProviderSettings.reasoning: e esse objeto que a
		// requisicao do provider le. Vale para QUALQUER provider (inclusive os sem
		// settings salvos, caso do opencode local com -m).
		if (args.thinkingExplicitlySet) {
			const reasoning =
				resolvedReasoning.thinking === false
					? { enabled: false as const }
					: {
							enabled: true as const,
							...(resolvedReasoning.reasoningEffort
								? { effort: resolvedReasoning.reasoningEffort }
								: {}),
						};
			selectedProviderSettings = {
				...(selectedProviderSettings ?? { provider }),
				provider,
				reasoning,
			} as typeof selectedProviderSettings;
			try {
				salvarProviderPreservando(providerSettingsManager, {
					...(selectedProviderSettings ?? {}),
					provider,
					...(args.model ? { model: args.model } : {}),
				});
			} catch {
				// persistencia e conveniencia: a sessao atual usa o objeto em memoria
			}
			if (process.env.HTC_DEBUG_REASONING === "1") {
				writeln(
					`${c.dim}[reasoning] provider=${provider} ${
						reasoning.enabled === false
							? "off"
							: `on${"effort" in reasoning ? ` (${reasoning.effort})` : ""}`
					}${c.reset}`,
				);
			}
		}
		// OpenCode local sobe servidor proprio; o default do SDK (10s) estoura em
		// maquina fria. 60s + auto-start deixam o primeiro turno acontecer.
		if (provider === "opencode" || provider === "opencode-go") {
			const limite = Number.parseInt(
				process.env.HTC_OPENCODE_SERVER_TIMEOUT ?? "60000",
				10,
			);
			selectedProviderSettings = {
				...(selectedProviderSettings ?? { provider }),
				provider,
				serverTimeout: Number.isFinite(limite) && limite > 0 ? limite : 60000,
				autoStartServer: true,
			} as typeof selectedProviderSettings;
		}
		const cliBuildInfo = getCliBuildInfo();
		const { createCliLoggerAdapter } = await import("./logging/adapter");
		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "main",
		});
		loggerAdapter.core.log("CLI run started", {
			interactive: args.interactive === true,
			hasPrompt: !!args.prompt?.trim(),
			cwd,
		});

		const baseSystemPrompt = await resolveSystemPrompt({
			cwd,
			explicitSystemPrompt: args.systemPrompt,
			providerId: provider,
			mode: effectiveMode,
		});
		// Thinking tambem no prompt: metade dos providers openai-compatible ignora
		// reasoning_effort. A diretiva garante a mudanca de comportamento.
		const diretivaThinking =
			resolvedReasoning.thinking === false
				? "\n\nResponda direto: nao delibere, nao explore alternativas antes de agir."
				: resolvedReasoning.thinking === true
					? `\n\nPense antes de agir (profundidade: ${
							resolvedReasoning.reasoningEffort ?? "medium"
						}). Internamente: liste os caminhos possiveis, escolha o mais curto que`
						+ " produz evidencia, e so entao execute. Nao mostre o rascunho; mostre o resultado."
					: "";
		const baseSystemPromptComThinking = `${baseSystemPrompt}${diretivaThinking}`;
		const politicaAgentes = resolver_politica_agentes(
			effectiveMode,
			args.agents,
		);
		// Os galhos (subagentes/time) entram no prompt: gate de registro, teto de
		// contexto, steer por elo e "faca no espaco" (in-process, sem arvore nova).
		const htcSystemPrompt =
			politicaAgentes.enabled
				? `${injetar_bypass(baseSystemPromptComThinking)}\n\n${instrucao_galhos(politicaAgentes)}`
				: injetar_bypass(baseSystemPromptComThinking);
		const providerEhOpencode = eh_provedor_opencode(provider);
		const modelIdResolvido =
			args.model ??
			selectedProviderSettings?.model ??
			knownModelIds[0] ??
			"anthropic/claude-sonnet-4.6";
		// O provider opencode exige `opencode/<modelo>`; sem o prefixo o servidor
		// local nao repassa o modelo e a request nao chega no Zen.
		const modelId = providerEhOpencode
			? normalizar_modelo_opencode(modelIdResolvido)
			: modelIdResolvido;
		if (providerEhOpencode) {
			// Aguarda a escolha de porta livre: varias CLIs no mesmo modelo nao
			// podem compartilhar a mesma porta do servidor opencode local.
			await preparar_ambiente_do_opencode(process.env, apiKey ?? "");
		}
		const config: Config = {
			providerId: provider,
			modelId,
			apiKey: apiKey ?? "",
			knownModels,
			systemPrompt: htcSystemPrompt,
			execution: {
				maxConsecutiveMistakes: args.retries ?? 3,
			},
			// O one-shot (`htc "missao"`) e o modo principal de automacao e era o
			// unico sem controlador de checkpoint: o do core exige repo git no cwd
			// e vira no-op silencioso em pasta de trabalho. Mesmo repo-sombra da TUI.
			checkpoint: {
				...CLI_DEFAULT_CHECKPOINT_CONFIG,
				createCheckpoint: criar_controlador_de_checkpoint(
					workspaceRoot,
					loggerAdapter.core,
				),
			},
			compaction: buildCliCompactionConfig(effectiveCompactionMode),
			timeoutSeconds: args.timeoutSeconds,
			// Retomada automatica entre turnos. yolo/zen ligam sempre; na TUI o
			// `undefined` deixa o runtime decidir por estado de trabalho (fila
			// com alvo ou missao aberta). Antes a TUI nascia desligada e o
			// agente parava no primeiro movimento — o operador tinha que cutucar
			// a cada alvo. `--auto-continue false` continua sendo o desligar.
			autoContinue: {
				enabled:
					args.autoContinue ??
					(isYoloMode || effectiveMode === "zen" ? true : undefined),
				max: args.maxAutoContinues,
				// Em autonomia "?" no fim NAO e pedido de decisao. O agente decide,
				// executa e so para em [FIM] / marcador explicito / teto.
				stopOnQuestion: false,
			},
			sandbox: sandboxEnabled,
			sandboxDataDir,
			verbose: args.verbose,
			thinking: resolvedReasoning.thinking,
			reasoningEffort: resolvedReasoning.reasoningEffort,
			outputMode: args.outputMode,
			mode: effectiveMode,
			logger: loggerAdapter.core,
			loggerConfig: loggerAdapter.runtimeConfig,
			telemetry: getCliTelemetryService(loggerAdapter.core),
			defaultToolAutoApprove,
			toolPolicies,
			enableSpawnAgent: politicaAgentes.enabled,
			// Time (board/mailbox) so com HTC_TEAMS=1 ou /team: medido 30/10,
			// 19 sessoes raiz com 19 times e 3 subsessoes — o time era custo fixo
			// por sessao para trabalho que um galho resolve.
			enableAgentTeams: politicaAgentes.teams,
			enableTools: true,
			cwd,
			workspaceRoot,
			extensionContext: {
				client: {
					name: "htc-cli",
					version: cliBuildInfo.version,
					platform: "cli",
					platformVersion: cliBuildInfo.version,
					isMultiRoot: false,
				},
				workspace: {
					rootPath: workspaceRoot,
					cwd,
					workspaceName: basename(cwd),
					ide: "Terminal Shell",
					platform: process.platform,
				},
				logger: loggerAdapter.core,
			},
			teamName: politicaAgentes.enabled
				? args.teamName?.trim() || undefined
				: undefined,
		};
		try {
			// For OAuth providers, don't write the resolved key into apiKey;
			// the token lives in auth.accessToken and apiKey is reserved for
			// migrated/manual keys.
			const persistApiKey =
				// Persist explicit `-k/--key` even for OAuth-capable providers.
				providedApiKey
					? { apiKey: providedApiKey }
					: apiKey && !isOAuthProvider(provider)
						? { apiKey }
						: {};
			salvarProviderPreservando(providerSettingsManager, {
				...(selectedProviderSettings ?? {}),
				provider,
				model: config.modelId,
				...persistApiKey,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[provider-settings] failed to persist selection (${message})${c.reset}`,
			);
		}
		// Check for piped input (skip when stdin is not a real pipe/file, e.g. headless CI).
		// Guard `isTTY` first so we never block on fd 0 when stdin is a terminal (and avoid
		// redundant fstat work). `stdinHasPipedInput` also checks `isTTY`, but callers may hit
		// inconsistent state in tests or embedded hosts.
		if (!process.stdin.isTTY && stdinHasPipedInput() && !args.interactive) {
			const chunks: Buffer[] = [];
			for await (const chunk of process.stdin) {
				chunks.push(chunk as Buffer);
			}
			const pipedInput = Buffer.concat(chunks).toString("utf-8").trim();

			if (pipedInput) {
				const prompt = args.prompt
					? `${args.prompt}\n\n${pipedInput}`
					: pipedInput;
				const rewrittenTeamPrompt = rewriteTeamPrompt(prompt);
				if (rewrittenTeamPrompt.kind === "usage") {
					writeln(TEAM_COMMAND_USAGE);
					return;
				}
				const pipedEffectivePrompt =
					rewrittenTeamPrompt.kind === "rewritten"
						? rewrittenTeamPrompt.prompt
						: prompt;
				if (isZenMode) {
					const { runZen } = await import("./runtime/run-zen");
					await runZen(pipedEffectivePrompt, config, userInstructionService);
					return;
				}
				await runAgent(pipedEffectivePrompt, config, userInstructionService);
				return;
			}
		}

		// Interactive mode: zen is incompatible because there is no terminal UI
		// to surface results and nothing waits for the background task.
		if (args.interactive || !args.prompt) {
			if (isZenMode) {
				writeErr(
					args.interactive
						? "--zen is not compatible with interactive mode."
						: "--zen requires a prompt.",
				);
				process.exitCode = 1;
				return;
			}
			const runInteractive = await loadInteractiveRuntimeModule();
			const initialClineProviderSettings =
				provider === "cline" ? selectedProviderSettings : undefined;
			// Popup de migracao do Cline removido: o HTC nao tem campanha de
			// ClinePass nem aviso de produto alheio na abertura.
			await runInteractive(config, userInstructionService, resumeSessionId, {
				initialPrompt: args.prompt,
				clineApiBaseUrl: initialClineProviderSettings?.baseUrl,
				clineProviderSettings: initialClineProviderSettings,
				startupTarget,
			});
			return;
		}

		// Single prompt mode
		const rewrittenTeamPrompt = rewriteTeamPrompt(args.prompt);
		if (rewrittenTeamPrompt.kind === "usage") {
			writeln(TEAM_COMMAND_USAGE);
			return;
		}
		const effectivePrompt =
			rewrittenTeamPrompt.kind === "rewritten"
				? rewrittenTeamPrompt.prompt
				: args.prompt;

		// Zen mode: dispatch the task to the background hub and exit. The CLI
		// does not stay connected to stream output; completion is delivered via
		// the hub's existing ui.notify broadcast (picked up by the menubar app
		// when installed).
		if (isZenMode) {
			const { runZen } = await import("./runtime/run-zen");
			await runZen(effectivePrompt, config, userInstructionService);
			return;
		}

		await runAgent(effectivePrompt, config, userInstructionService);
		// Exit once agent is done in non-interactive mode
		return;
	} finally {
		stopUserInstructionService();
	}
}
