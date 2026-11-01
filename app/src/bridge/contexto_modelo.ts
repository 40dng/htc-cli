// language: TypeScript, file: src/bridge/contexto_modelo.ts, runtime: Bun/Node
// Janela de contexto REAL dos modelos do OpenCode Go, conforme o catalogo do
// models.dev (provider `opencode-go`). Usada para o Claude Code nao assumir
// 200k e compactar cedo. Fonte: https://models.dev/api.json (campo limit.context).

/** Contexto real por modelo do OpenCode Go (tokens). */
export const CONTEXTO_OPENCODE_GO: Record<string, number> = {
	"deepseek-v4-flash": 1_000_000,
	"deepseek-v4-flash-vision-exp": 1_000_000,
	"deepseek-v4.1-flash": 1_000_000,
	"deepseek-v4-pro": 1_000_000,
	"deepseek-flash": 1_000_000,
	"glm-5.1": 200_000,
	"glm-5.2": 1_000_000,
	"glm-5.3": 1_000_000,
	"glm-5.3-flash": 1_000_000,
	"grok-4.6": 500_000,
	"grok-4.7": 500_000,
	"muse-spark-1.2-contributor": 1_048_576,
	"muse-spark-1.3-contributor": 1_048_576,
	"gpt-5.6-luna": 1_050_000,
	"gpt-6-luna": 1_050_000,
	"claude-haiku-5-5": 1_000_000,
	hy3: 256_000,
	"hy4-preview": 1_024_000,
	"kimi-k2.6": 262_144,
	"kimi-k2.7-code": 262_144,
	"kimi-k3": 1_048_576,
	"mimo-v2.5": 1_000_000,
	"mimo-v2.6-flash": 1_048_576,
	"mimo-v2.5-pro": 1_048_576,
	"mimo-v2.6-pro": 1_048_576,
	"minimax-m2.5": 200_000,
	"minimax-m2.7": 204_800,
	"minimax-m3": 1_000_000,
	"space-bunny": 1_048_576,
	"longcat-2.0": 1_000_000,
	"longcat-2.5-preview-free": 1_000_000,
	"qwen3.6-plus": 1_000_000,
	"qwen3.7-max": 1_000_000,
	"qwen3.7-plus": 1_000_000,
	"qwen3.8-max": 1_000_000,
	"qwen3.8-flash": 1_000_000,
};

/** Fallback quando o modelo nao esta na tabela (maioria do Go e 1M). */
export const CONTEXTO_PADRAO_TOKENS = 1_000_000;

/** Remove anotacao de janela (`[1m]`) e prefixo `provider/` do id. */
function normalizar_modelo(modelo: string): string {
	return modelo
		.replace(/\[[0-9]+m\]$/i, "")
		.replace(/^[^/]+\//, "")
		.trim();
}

/** Contexto real do modelo; cai no padrao (1M) se desconhecido. */
export function contexto_do_modelo(modelo?: string): number {
	if (!modelo) return CONTEXTO_PADRAO_TOKENS;
	const limpo = normalizar_modelo(modelo);
	return CONTEXTO_OPENCODE_GO[limpo] ?? CONTEXTO_PADRAO_TOKENS;
}
