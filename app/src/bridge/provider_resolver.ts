// language: TypeScript, file: src/bridge/provider_resolver.ts, runtime: Bun/Node
// Resolve o provider REAL configurado no HTC (~/.cline/data/settings) para que a
// bridge fale com o mesmo upstream que a CLI usa. O HTC tem providers aninhados
// (ex.: opencode-go e um subprovider do stack opencode); aqui lemos o que esta
// persistido e devolvemos protocolo + baseUrl + credencial + modelo.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Llms } from "@cline/core";

export type ProtocoloUpstream = "anthropic" | "openai-chat";

export interface ProviderResolvido {
	id: string;
	protocolo: ProtocoloUpstream;
	baseUrl: string;
	apiKey?: string;
	modelo?: string;
	headers: Record<string, string>;
}

interface DefinicaoEmbutida {
	protocolo: ProtocoloUpstream;
	baseUrl: string;
	envDeChave: string[];
}

/**
 * Catalogo minimo dos providers que o HTC usa com mais frequencia. O
 * `baseUrl`/`protocolo` persistido em providers.json sempre vence o catalogo;
 * isto e so o fallback quando o provider nao guarda endpoint (built-in).
 * Endpoints conferidos na doc publica: Zen `https://opencode.ai/zen/v1`,
 * Go `https://opencode.ai/zen/go/v1` (mesma OPENCODE_API_KEY).
 */
export const CATALOGO_EMBUTIDO: Record<string, DefinicaoEmbutida> = {
	anthropic: {
		protocolo: "anthropic",
		baseUrl: "https://api.anthropic.com/v1",
		envDeChave: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
	},
	opencode: {
		protocolo: "openai-chat",
		baseUrl: "https://opencode.ai/zen/v1",
		envDeChave: ["OPENCODE_API_KEY"],
	},
	"opencode-go": {
		protocolo: "openai-chat",
		baseUrl: "https://opencode.ai/zen/go/v1",
		envDeChave: ["OPENCODE_API_KEY"],
	},
	deepseek: {
		protocolo: "openai-chat",
		baseUrl: "https://api.deepseek.com/v1",
		envDeChave: ["DEEPSEEK_API_KEY"],
	},
	nvidia: {
		protocolo: "openai-chat",
		baseUrl: "https://integrate.api.nvidia.com/v1",
		envDeChave: ["NVIDIA_API_KEY"],
	},
};

interface SettingsPersistidos {
	provider?: string;
	model?: string;
	protocol?: string;
	client?: string;
	baseUrl?: string;
	apiKey?: string;
	auth?: { accessToken?: string; apiKey?: string };
}

interface ProvidersJson {
	lastUsedProvider?: string;
	providers?: Record<string, { settings?: SettingsPersistidos }>;
}

interface ModelsJson {
	providers?: Record<
		string,
		{ provider?: { baseUrl?: string; defaultModelId?: string; protocol?: string } }
	>;
}

/** Diretorio de config do HTC. Desde a 1.0.0 o produto grava em `~/.htc`. */
export function resolver_diretorio_config(
	env: Record<string, string | undefined> = process.env,
): string {
	const explicito = env.HTC_BRIDGE_CONFIG_DIR?.trim() || env.HTC_CONFIG_DIR?.trim();
	if (explicito) return explicito;
	// Mesmo criterio do `prepararEstadoHtc()`: HTC_STATE_DIR manda, depois ~/.htc.
	// Antes o default era ~/.cline e o bridge lia um arquivo que o HTC nao escreve
	// mais (modelo/baseUrl divergentes entre bridge e runtime).
	const raiz = env.HTC_STATE_DIR?.trim();
	return raiz || join(homedir(), ".htc");
}

function ler_json<T>(caminho: string): T | undefined {
	try {
		return JSON.parse(readFileSync(caminho, "utf8")) as T;
	} catch {
		return undefined;
	}
}

export function carregar_config_providers(
	env: Record<string, string | undefined> = process.env,
): { providers: ProvidersJson; models: ModelsJson; raiz: string } {
	const raiz = resolver_diretorio_config(env);
	const base = join(raiz, "data", "settings");
	const providers = ler_json<ProvidersJson>(join(base, "providers.json")) ?? {};
	const models = ler_json<ModelsJson>(join(base, "models.json")) ?? {};
	return { providers, models, raiz };
}

/** Ultimo provider usado pelo HTC — o default natural da bridge. */
export function provider_padrao(
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const { providers } = carregar_config_providers(env);
	return providers.lastUsedProvider?.trim() || undefined;
}

function chave_por_env(
	id: string,
	env: Record<string, string | undefined>,
): string | undefined {
	const definicao = CATALOGO_EMBUTIDO[id];
	if (!definicao) return undefined;
	for (const nome of definicao.envDeChave) {
		const valor = env[nome]?.trim();
		if (valor) return valor;
	}
	return undefined;
}

function normalizar_base_url(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

function cabecalhos_do_protocolo(
	protocolo: ProtocoloUpstream,
	apiKey: string | undefined,
): Record<string, string> {
	if (protocolo === "anthropic") {
		const headers: Record<string, string> = {
			"anthropic-version": "2023-06-01",
		};
		if (apiKey) headers["x-api-key"] = apiKey;
		return headers;
	}
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	return headers;
}

/**
 * Resolve um provider persistido. Ordem de precedencia:
 *   1. settings.baseUrl/protocol do providers.json
 *   2. catalogo embutido (fallback para built-ins sem endpoint salvo)
 * Credencial: settings.apiKey -> settings.auth -> env do catalogo.
 */
export function resolver_provider(
	id: string,
	env: Record<string, string | undefined> = process.env,
): ProviderResolvido {
	const { providers, models } = carregar_config_providers(env);
	const entrada = providers.providers?.[id];
	const settings = entrada?.settings;
	const definicao = CATALOGO_EMBUTIDO[id];
	// Catalogo do proprio HTC: baseUrl/protocolo/credencial de QUALQUER provider
	// (216 providers). E a fonte de verdade para providers built-in sem endpoint
	// salvo em providers.json.
	const colecao = Llms.getProviderCollectionSync(id);
	const catalogo = colecao?.provider;

	const baseUrl = normalizar_base_url(
		settings?.baseUrl?.trim() ||
			models.providers?.[id]?.provider?.baseUrl?.trim() ||
			definicao?.baseUrl ||
			catalogo?.baseUrl?.trim() ||
			"",
	);
	if (!baseUrl) {
		throw new Error(
			`provider "${id}" sem baseUrl HTTP utilizavel (ex.: opencode roda via servidor local do OpenCode). Configure no HTC ou use outro provider.`,
		);
	}

	const protocoloBruto =
		settings?.protocol?.trim() ||
		models.providers?.[id]?.provider?.protocol?.trim() ||
		catalogo?.protocol?.trim() ||
		definicao?.protocolo ||
		"openai-chat";
	const protocolo: ProtocoloUpstream =
		protocoloBruto === "anthropic" ? "anthropic" : "openai-chat";

	const chaveDoCatalogo = (() => {
		for (const nome of catalogo?.env ?? []) {
			const valor = env[nome]?.trim();
			if (valor) return valor;
		}
		return undefined;
	})();

	const apiKey =
		settings?.apiKey?.trim() ||
		settings?.auth?.apiKey?.trim() ||
		settings?.auth?.accessToken?.trim() ||
		chave_por_env(id, env) ||
		chaveDoCatalogo ||
		undefined;

	const modelo =
		settings?.model?.trim() ||
		models.providers?.[id]?.provider?.defaultModelId?.trim() ||
		catalogo?.defaultModelId?.trim() ||
		undefined;

	return {
		id,
		protocolo,
		baseUrl,
		apiKey,
		modelo,
		headers: {
			...cabecalhos_do_protocolo(protocolo, apiKey),
			...cabecalhos_extras_do_provider(id, baseUrl),
		},
	};
}

/** Caminho HTTP final do upstream conforme o protocolo. */
export function endpoint_do_provider(provider: ProviderResolvido): string {
	if (provider.protocolo === "anthropic") {
		return `${provider.baseUrl}/messages`;
	}
	return `${provider.baseUrl}/chat/completions`;
}

/**
 * Todos os modelos `provider/modelo` dos providers CONFIGURADOS no HTC (via
 * catalogo). Usado em GET /v1/models para o Claude Code descobrir o lineup.
 */
export async function listar_modelos_configurados(
	env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
	const { providers } = carregar_config_providers(env);
	const ids = Object.keys(providers.providers ?? {});
	const saida: string[] = [];
	for (const pid of ids) {
		try {
			const models = await Llms.getModelsForProvider(pid, { filter: "chat" });
			for (const mid of Object.keys(models)) saida.push(`${pid}/${mid}`);
		} catch {
			// provider sem catalogo: ignora
		}
	}
	return saida;
}

/**
 * OpenCode Zen/Go exigem o FINGERPRINT do cliente OpenCode no HTTP direto:
 * `User-Agent: opencode/<versao>` + `x-opencode-session` no formato canonico
 * (`ses_` + 12 hex + 14 base62) + `x-opencode-client/request/project`. Sem isso
 * a API responde 400/403. Isso libera os modelos FREE direto (sem o servidor
 * opencode local); modelos pagos (Claude) caem no handler.
 */
const VERSAO_OPENCODE = "1.18.35";
const ALFABETO_BASE62 =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function id_base62(qtd: number): string {
	let saida = "";
	for (let i = 0; i < qtd; i += 1) {
		saida += ALFABETO_BASE62[Math.floor(Math.random() * ALFABETO_BASE62.length)];
	}
	return saida;
}

function novo_id_sessao_opencode(): string {
	const hex = Date.now().toString(16).slice(-12).padStart(12, "0");
	return `ses_${hex}${id_base62(14)}`;
}

/** Sessao estavel por processo (preserva cache/roteamento do upstream). */
const SESSAO_OPENCODE = novo_id_sessao_opencode();

function eh_opencode(id: string, baseUrl: string): boolean {
	return (
		id === "opencode" ||
		id === "opencode-go" ||
		baseUrl.includes("opencode.ai")
	);
}

/** Cabecalhos extras exigidos por providers especificos (fingerprint OpenCode). */
export function cabecalhos_extras_do_provider(
	id: string,
	baseUrl: string,
): Record<string, string> {
	if (eh_opencode(id, baseUrl)) {
		return {
			"user-agent": `opencode/${VERSAO_OPENCODE}`,
			"x-opencode-client": "cli",
			"x-opencode-session": SESSAO_OPENCODE,
			"x-opencode-request": `req_${id_base62(20)}`,
			"x-opencode-project": `prj_${id_base62(20)}`,
		};
	}
	return {};
}
