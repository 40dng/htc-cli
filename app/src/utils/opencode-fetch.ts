/**
 * HTC — fingerprint do cliente OpenCode no HTTP
 *
 * O gateway do OpenCode (`opencode.ai/zen` e `/zen/go`) recusa request sem
 * `x-opencode-session`:
 *   400 {"type":"error","error":{"type":"MissingSessionID", ...}}
 * que o core traduz para `Request is missing x-opencode-session...`.
 *
 * O header tem que existir NO FIO. O `ProviderSettingsManager` guarda
 * `headers`, mas o caminho do `@cline/llms` nem sempre repassa — entao a
 * garantia fica aqui, num wrapper unico de `fetch` instalado no boot: vale
 * para o core, para o bridge e para qualquer subagente.
 */
const VERSAO_PADRAO = "1.19.0";

function hex(n: number): string {
	const bytes = new Uint8Array(n);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base62(n: number): string {
	const alfabeto = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	const bytes = new Uint8Array(n);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => alfabeto[b % 62]).join("");
}

/** `ses_` + 12 hex + 14 base62 (formato canonico do OpenCode). */
function idSessao(): string {
	return `ses_${hex(6)}${base62(14)}`;
}

export interface OpcoesFingerprint {
	versao?: string;
	sessao?: string;
}

let instalado = false;
let sessaoAtual = "";
let requestAtual = "";
const projetoAtual = `prj_${base62(20)}`;

function cabecalhosOpenCode(versao: string): Record<string, string> {
	return {
		"user-agent": `opencode/${versao}`,
		"x-opencode-client": "cli",
		"x-opencode-session": sessaoAtual,
		"x-opencode-request": requestAtual,
		"x-opencode-project": projetoAtual,
	};
}

function urlDe(entrada: unknown): string {
	if (typeof entrada === "string") return entrada;
	if (entrada instanceof URL) return entrada.href;
	const talvez = entrada as { url?: unknown };
	return typeof talvez?.url === "string" ? talvez.url : "";
}

function alvoOpenCode(url: string): boolean {
	return /(^|\.)opencode\.ai/i.test(url) || url.includes("opencode.ai/zen");
}

/**
 * Instala o wrapper (idempotente). Devolve `true` se instalou agora.
 * `HTC_OPENCODE_VERSION` troca a versao anunciada.
 */
export function instalarFingerprintOpenCode(opcoes: OpcoesFingerprint = {}): boolean {
	if (instalado) return false;
	instalado = true;
	const versao = opcoes.versao ?? process.env.HTC_OPENCODE_VERSION?.trim() ?? VERSAO_PADRAO;
	sessaoAtual = opcoes.sessao ?? idSessao();
	requestAtual = `req_${base62(20)}`;

	const original = globalThis.fetch;
	(globalThis as any).fetch = async (entrada: any, init?: any) => {
		let url = "";
		try {
			url = urlDe(entrada);
		} catch {
			url = "";
		}
		if (!url || !alvoOpenCode(url)) return original(entrada, init);

		const extras = cabecalhosOpenCode(versao);
		requestAtual = `req_${base62(20)}`;
		extras["x-opencode-request"] = requestAtual;

		// Request ja montada: precisa virar uma NOVA Request com os headers.
		if (typeof Request !== "undefined" && entrada instanceof Request && !init) {
			const headers = new Headers(entrada.headers);
			for (const [k, v] of Object.entries(extras)) if (!headers.has(k)) headers.set(k, v);
			return original(new Request(entrada, { headers }));
		}

		const headers = new Headers(init?.headers ?? undefined);
		for (const [k, v] of Object.entries(extras)) if (!headers.has(k)) headers.set(k, v);
		return original(entrada, { ...(init ?? {}), headers });
	};

	return true;
}

/** Sessao atual (para diagnostico no `htc debug`). */
export function sessaoOpenCode(): string {
	return sessaoAtual;
}
