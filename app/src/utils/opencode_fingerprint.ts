/**
 * Caminho HTTP do provider opencode (Zen `opencode` e Go `opencode-go`). O
 * endpoint exige o fingerprint do cliente OpenCode: sem `x-opencode-session` o
 * servidor responde 400 `MissingSessionID` ("Request is missing
 * x-opencode-session and cannot be routed efficiently"). O core NAO conhece esse
 * header, entao ele tem de vir em `settings.headers` (EndpointConfig.headers),
 * que o `toProviderConfig` repassa ao handler. Aqui mora o fingerprint.
 *
 * Versao do fingerprint e dado volatil (o OpenCode se auto-atualiza): override
 * por `HTC_OPENCODE_VERSION`. O servidor aceita qualquer `ses_` bem formado, mas
 * ele e gerado por PROCESSO para o roteamento nao colidir entre sessoes.
 */
export const PROVEDOR_GO = "opencode-go";

/** Versao usada no User-Agent do fingerprint. */
export const VERSAO_OPENCODE_PADRAO = "1.19.0";

/** Prefixo de session id canonico do OpenCode. */
const ALFABETO_BASE62 =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function id_base62(qtd: number): string {
	let saida = "";
	for (let i = 0; i < qtd; i += 1) {
		saida += ALFABETO_BASE62[Math.floor(Math.random() * ALFABETO_BASE62.length)];
	}
	return saida;
}

/** Sessao estavel por processo (o upstream usa para rotear/cachear). */
export const SESSAO_OPENCODE = `ses_${Date.now().toString(16).slice(-12).padStart(12, "0")}${id_base62(14)}`;

/** Request/project ids do fingerprint, estaveis por processo (idempotencia). */
const REQUEST_OPENCODE = `req_${id_base62(20)}`;
const PROJECT_OPENCODE = `prj_${id_base62(20)}`;

/**
 * O provider e servido por HTTP DIRETO contra o endpoint do OpenCode? O
 * `opencode` (Zen) usa o SDK local (servidor opencode, que ja manda o
 * fingerprint); `opencode-go` e os demais `opencode-*` falam direto pela API
 * openai-compatible do core — e ESSES precisam do header.
 */
export function precisa_de_fingerprint(providerId: string | undefined): boolean {
	return (providerId ?? "").trim().toLowerCase().startsWith("opencode-");
}

/** Fingerprint exigido pelo endpoint (x-opencode-*). */
export function cabecalhos_do_opencode(
	env: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const versao = env.HTC_OPENCODE_VERSION?.trim() || VERSAO_OPENCODE_PADRAO;
	return {
		"user-agent": `opencode/${versao}`,
		"x-opencode-client": "cli",
		"x-opencode-session": SESSAO_OPENCODE,
		"x-opencode-request": REQUEST_OPENCODE,
		"x-opencode-project": PROJECT_OPENCODE,
	};
}

/** Superficie minima do ProviderSettingsManager usada aqui (facilita teste). */
export interface GerenciadorDeSettings {
	getProviderSettings(providerId: string): Record<string, unknown> | undefined;
	saveProviderSettings(settings: unknown, options?: unknown): unknown;
}

/**
 * Garante o fingerprint em `settings.headers` do provider opencode/opencode-go.
 * Idempotente: so grava quando algo muda. `headers` do operador vencem o
 * fingerprint (nunca sobrescreve escolha explicita). Devolve true se gravou.
 */
export function garantir_fingerprint_do_opencode(
	gerenciador: GerenciadorDeSettings,
	providerId: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	if (!precisa_de_fingerprint(providerId)) return false;
	const atuais = gerenciador.getProviderSettings(providerId);
	if (!atuais) return false;
	const headersAtuais = (atuais.headers ?? {}) as Record<string, string>;
	const fingerprint = cabecalhos_do_opencode(env);
	const headers = { ...fingerprint, ...headersAtuais };
	const mudou = Object.entries(headers).some(
		([nome, valor]) => headersAtuais[nome] !== valor,
	);
	if (!mudou) return false;
	gerenciador.saveProviderSettings({ ...atuais, headers });
	return true;
}
