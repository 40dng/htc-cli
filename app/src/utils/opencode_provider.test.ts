// language: TypeScript, file: src/utils/opencode_provider.test.ts, runtime: Bun, runner: bun:test
import { describe, expect, it } from "bun:test";
import {
	aplicar_proxy_no_ambiente,
	CHAVE_ANONIMA_DO_ZEN,
	eh_provedor_opencode,
	escolher_porta_livre,
	escolher_proxy_do_opencode,
	MODELO_ZEN_PADRAO,
	normalizar_modelo_opencode,
	PORTA_PADRAO_OPENCODE,
	preparar_ambiente_do_opencode,
	PROVEDOR_DO_ZEN,
	VARIAVEL_DE_PROXY,
} from "./opencode_provider";

function porta_em_uso(porta: number): boolean {
	const resultado = Bun.spawnSync([
		"node",
		"-e",
		`const s=require("net").createServer().listen(${porta},"127.0.0.1",()=>{s.close();process.exit(0)}).on("error",()=>process.exit(1))`,
	]);
	return resultado.exitCode !== 0;
}

describe("normalizar_modelo_opencode", () => {
	it("prefixa com o provedor zen quando falta o separador", () => {
		expect(normalizar_modelo_opencode("claude-sonnet-4-6")).toBe(
			"opencode/claude-sonnet-4-6",
		);
	});

	it("preserva modelo ja qualificado", () => {
		expect(normalizar_modelo_opencode("opencode/big-pickle")).toBe(
			"opencode/big-pickle",
		);
	});

	it("usa o default quando vazio", () => {
		expect(normalizar_modelo_opencode(undefined)).toBe(
			`${PROVEDOR_DO_ZEN}/${MODELO_ZEN_PADRAO}`,
		);
		expect(normalizar_modelo_opencode("  ")).toBe(
			`${PROVEDOR_DO_ZEN}/${MODELO_ZEN_PADRAO}`,
		);
	});
});

describe("eh_provedor_opencode", () => {
	it("reconhece o provider com espacos e caixa alta", () => {
		expect(eh_provedor_opencode("opencode")).toBe(true);
		expect(eh_provedor_opencode(" OpenCode ")).toBe(true);
		expect(eh_provedor_opencode("deepseek")).toBe(false);
		expect(eh_provedor_opencode(undefined)).toBe(false);
	});
});

describe("preparar_ambiente_do_opencode", () => {
	it("define uma porta livre valida quando ausente", async () => {
		const env: Record<string, string | undefined> = {};
		const porta = await preparar_ambiente_do_opencode(env);
		expect(porta).toBeGreaterThan(0);
		expect(porta).toBeLessThan(65536);
		expect(env.HTC_OPENCODE_PORT).toBe(String(porta));
	});

	it("respeita porta ja definida pelo usuario", async () => {
		const env: Record<string, string | undefined> = { HTC_OPENCODE_PORT: "5001" };
		expect(await preparar_ambiente_do_opencode(env)).toBe(5001);
		expect(env.HTC_OPENCODE_PORT).toBe("5001");
	});

	it("substitui valor invalido por uma porta livre", async () => {
		const env: Record<string, string | undefined> = { HTC_OPENCODE_PORT: "abc" };
		const porta = await preparar_ambiente_do_opencode(env);
		expect(porta).toBeGreaterThan(0);
		expect(porta).toBeLessThan(65536);
	});

	it("nao reutiliza uma porta ja ocupada (duas instancias nao colidem)", async () => {
		// Ocupa uma porta qualquer e confirma que a escolha a partir dela desvia,
		// que e exatamente o que impedia duas CLIs no mesmo modelo.
		const bloqueio = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: { data() {} },
		});
		const ocupada = bloqueio.port;
		try {
			const env: Record<string, string | undefined> = {
				HTC_OPENCODE_PORT: "",
			};
			// Sem porta explicita: a escolha comeca em PORTA_PADRAO_OPENCODE; para
			// provar o desvio, forcamos a preferida logo ao lado da ocupada.
			const porta = await escolher_porta_livre(ocupada);
			expect(porta).not.toBe(ocupada);
			expect(env.HTC_OPENCODE_PORT).toBe("");
		} finally {
			bloqueio.stop(true);
		}
	});

	it("exporta a apiKey configurada para OPENCODE_API_KEY", async () => {
		const env: Record<string, string | undefined> = {};
		await preparar_ambiente_do_opencode(env, "  oc_sk_abc  ");
		expect(env.OPENCODE_API_KEY).toBe("oc_sk_abc");
	});

	it("usa a chave anonima public quando a chave e vazia (todos os modelos, sem cobranca)", async () => {
		const env: Record<string, string | undefined> = {
			OPENCODE_API_KEY: "oc_sk_antiga",
		};
		await preparar_ambiente_do_opencode(env, "");
		expect(env.OPENCODE_API_KEY).toBe(CHAVE_ANONIMA_DO_ZEN);
	});

	it("nao mexe em OPENCODE_API_KEY quando nenhuma chave e informada", async () => {
		const env: Record<string, string | undefined> = {
			OPENCODE_API_KEY: "oc_sk_antiga",
		};
		await preparar_ambiente_do_opencode(env);
		expect(env.OPENCODE_API_KEY).toBe("oc_sk_antiga");
	});
});

describe("escolher_proxy_do_opencode", () => {
	it("proxy explicito vence o pool", () => {
		const env: Record<string, string | undefined> = {
			[VARIAVEL_DE_PROXY]: "socks4://1.2.3.4:1080",
			HTC_OPENCODE_PROXY_POOL: "C:/nao/existe.txt",
		};
		expect(escolher_proxy_do_opencode(env)).toBe("socks4://1.2.3.4:1080");
	});

	it("le o pool ignorando comentarios e linhas vazias", () => {
		const env: Record<string, string | undefined> = {
			HTC_OPENCODE_PROXY_POOL: "C:/pool.txt",
		};
		const conteudo = "# comentario\n\nsocks4://1.1.1.1:1080\nsocks4://2.2.2.2:1080\n";
		const escolhido = escolher_proxy_do_opencode(env, () => conteudo);
		expect(["socks4://1.1.1.1:1080", "socks4://2.2.2.2:1080"]).toContain(escolhido!);
	});

	it("devolve undefined quando o pool nao existe", () => {
		const env: Record<string, string | undefined> = {
			HTC_OPENCODE_PROXY_POOL: "C:/inexistente.txt",
		};
		expect(
			escolher_proxy_do_opencode(env, () => {
				throw new Error("ENOENT");
			}),
		).toBeUndefined();
	});
});

describe("aplicar_proxy_no_ambiente", () => {
	it("define HTTPS_PROXY/HTTP_PROXY e protege o loopback", () => {
		const env: Record<string, string | undefined> = {};
		expect(aplicar_proxy_no_ambiente("http://127.0.0.1:9000", env)).toBe(true);
		expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:9000");
		expect(env.HTTP_PROXY).toBe("http://127.0.0.1:9000");
		expect(env.NO_PROXY).toContain("127.0.0.1");
		expect(env.NO_PROXY).toContain("localhost");
	});

	it("preserva o NO_PROXY existente sem duplicar", () => {
		const env: Record<string, string | undefined> = {
			NO_PROXY: "127.0.0.1,.interno",
		};
		aplicar_proxy_no_ambiente("http://127.0.0.1:9000", env);
		expect(env.NO_PROXY).toBe("127.0.0.1,.interno,localhost,::1");
	});

	it("nao faz nada sem proxy", () => {
		const env: Record<string, string | undefined> = {};
		expect(aplicar_proxy_no_ambiente(undefined, env)).toBe(false);
		expect(env.HTTPS_PROXY).toBeUndefined();
	});
});
