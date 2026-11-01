// language: TypeScript, file: src/bridge/rota_upstream.ts, runtime: Bun/Node
// Decide a ROTA do upstream. O endpoint do OpenCode (Zen/Go) exige o fingerprint
// do cliente OpenCode no HTTP (`x-opencode-session`); sem ele o servidor responde
// 400 `MissingSessionID` ("Request is missing x-opencode-session and cannot be
// routed efficiently"). O handler do core NAO manda esse header, entao para esses
// endpoints a unica rota valida e o HTTP direto (que monta o fingerprint em
// provider_resolver.ts). Deixar o handler entrar aqui TROCA o erro real
// (402/403/429) por um 400 de header enganoso - foi o sintoma reportado.

/** Host do endpoint de um provider (string vazia se a URL for invalida). */
export function host_do_endpoint(baseUrl: string): string {
	try {
		return new URL(baseUrl).host.toLowerCase();
	} catch {
		return "";
	}
}

/** O endpoint e do OpenCode (opencode.ai ou subdominio)? */
export function endpoint_eh_opencode(baseUrl: string): boolean {
	const host = host_do_endpoint(baseUrl);
	return host === "opencode.ai" || host.endsWith(".opencode.ai");
}
