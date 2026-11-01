/** Nome curto do provider ("Opencode Go", "DeepSeek"...). Fonte unica. */
const MAPA: Record<string, string> = {
	opencode: "Opencode",
	"opencode-go": "Opencode Go",
	"htc-free": "Free local",
	deepseek: "DeepSeek",
	anthropic: "Anthropic",
	openai: "OpenAI",
	"openai-native": "OpenAI",
	"openai-codex": "ChatGPT",
	"openai-compatible": "OpenAI-compat",
	openrouter: "OpenRouter",
	cline: "Cline",
	"cline-pass": "ClinePass",
	gemini: "Gemini",
	vertex: "Vertex",
	bedrock: "Bedrock",
	ollama: "Ollama",
	lmstudio: "LM Studio",
	xai: "xAI",
	groq: "Groq",
	mistral: "Mistral",
	qwen: "Qwen",
	moonshot: "Moonshot",
	zai: "Z.AI",
};

export function rotuloDoProvider(providerId: string): string {
	const id = (providerId ?? "").trim();
	if (!id) return "";
	if (MAPA[id]) return MAPA[id]!;
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ");
}
