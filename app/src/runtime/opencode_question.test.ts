// language: TypeScript, file: src/runtime/opencode_question.test.ts, runtime: Bun, runner: bun:test
import { afterEach, describe, expect, it, mock } from "bun:test";
import {
	CHAVE_GLOBAL_DO_RESOLVEDOR,
	criar_resolvedor_do_cli,
	criar_resolvedor_preguicoso,
	ler_resolvedor_de_pergunta,
	registrar_resolvedor_de_pergunta,
	remover_resolvedor_de_pergunta,
	type PedidoDePerguntaOpencode,
} from "./opencode_question";

const PEDIDO: PedidoDePerguntaOpencode = {
	questionId: "que_0d94e35fb001uROXVLxRq03P5n",
	sessionId: "ses_1",
	questions: [
		{
			question: "Qual alvo primeiro?",
			header: "alvo",
			options: [
				{ label: "bracell", description: "comecar pelo bracell" },
				{ label: "copart", description: "comecar pelo copart" },
			],
		},
	],
};

afterEach(() => {
	remover_resolvedor_de_pergunta();
});

describe("registro do resolvedor", () => {
	it("publica e limpa o resolvedor no globalThis", () => {
		expect(ler_resolvedor_de_pergunta()).toBeNull();
		registrar_resolvedor_de_pergunta(() => [["bracell"]], "teste");
		expect(typeof ler_resolvedor_de_pergunta()).toBe("function");
		expect(
			(globalThis as Record<string, unknown>)[CHAVE_GLOBAL_DO_RESOLVEDOR],
		).toBeDefined();
		remover_resolvedor_de_pergunta();
		expect(ler_resolvedor_de_pergunta()).toBeNull();
	});
});

describe("criar_resolvedor_do_cli", () => {
	it("mapeia a opcao escolhida para a lista de labels esperada pelo opencode", async () => {
		const perguntar = mock(async () => "copart");
		const resolver = criar_resolvedor_do_cli(perguntar);

		const respostas = await resolver(PEDIDO);

		expect(respostas).toEqual([["copart"]]);
		expect(perguntar).toHaveBeenCalledTimes(1);
		const [texto, opcoes] = perguntar.mock.calls[0];
		expect(texto).toContain("Qual alvo primeiro?");
		expect(texto).toContain("bracell: comecar pelo bracell");
		expect(opcoes).toEqual(["bracell", "copart"]);
	});

	it("aceita resposta livre quando o label nao bate", async () => {
		const resolver = criar_resolvedor_do_cli(mock(async () => "outro alvo qualquer"));
		const respostas = await resolver(PEDIDO);
		expect(respostas).toEqual([["outro alvo qualquer"]]);
	});

	it("divide por virgula quando a pergunta e multipla", async () => {
		const resolver = criar_resolvedor_do_cli(mock(async () => "bracell,copart"));
		const respostas = await resolver({
			...PEDIDO,
			questions: [{ ...PEDIDO.questions[0], multiple: true }],
		});
		expect(respostas).toEqual([["bracell", "copart"]]);
	});

	it("cai na primeira opcao quando a resposta vem vazia", async () => {
		const resolver = criar_resolvedor_do_cli(mock(async () => "   "));
		const respostas = await resolver(PEDIDO);
		expect(respostas).toEqual([["bracell"]]);
	});

	it("devolve null quando nao ha perguntas", async () => {
		const resolver = criar_resolvedor_do_cli(mock(async () => "x"));
		expect(await resolver({ ...PEDIDO, questions: [] })).toBeNull();
	});
});

describe("criar_resolvedor_preguicoso", () => {
	it("devolve null enquanto o canal do TUI nao existe", async () => {
		const resolver = criar_resolvedor_preguicoso(() => null);
		expect(await resolver(PEDIDO)).toBeNull();
	});

	it("usa o canal assim que ele e publicado", async () => {
		let canal: ((p: string, o: string[]) => Promise<string>) | null = null;
		const resolver = criar_resolvedor_preguicoso(() => canal);
		expect(await resolver(PEDIDO)).toBeNull();
		canal = async () => "bracell";
		expect(await resolver(PEDIDO)).toEqual([["bracell"]]);
	});
});
