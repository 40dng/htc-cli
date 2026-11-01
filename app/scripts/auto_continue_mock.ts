/**
 * Mock upstream OpenAI-compatible para o E2E do auto-continue.
 * 1a chamada -> um "board" (resumo sem [FIM]) => o runtime DEVE retomar.
 * 2a chamada -> "pronto [FIM]"                      => o runtime DEVE parar.
 * Uso: bun run scripts/auto_continue_mock.ts
 */
let chamadas = 0;

const server = Bun.serve({
	port: 8899,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname.endsWith("/chat/completions")) {
			chamadas += 1;
			const conteudo =
				chamadas === 1
					? "Board: fiz o lote 1. Resta o lote 2. Prossigo no proximo."
					: "pronto [FIM]";
			console.log(`[mock] chamada ${chamadas} -> ${conteudo}`);
			return Response.json({
				id: `mock-${chamadas}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: "mock-model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: conteudo },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
		}
		return new Response("not found", { status: 404 });
	},
});

console.log(`[mock] listening on ${server.url}`);
