// language: TypeScript, file: src/runtime/op.test.ts, runtime: bun
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { caminhoFila } from "./fila-alvos";
import {
	abrirMissao,
	caminhoMissao,
	chaveDaOperacao,
	definirDegrau,
	registrarAchado,
} from "./missao";
import {
	caminhoOperacoes,
	caminhoPromptDaOperacao,
	carregarOperacoes,
	comandoDaOperacao,
	criarOperacao,
	estadoDaOperacao,
	fecharOperacao,
	gravarPromptDaOperacao,
	hostsDasOutrasLanes,
	promptDaOperacao,
	quadroDeOperacoes,
} from "./op";

const OPERACAO_A = "integra.coop-a.example.com";
const OPERACAO_B = "contaonline.coop-b.example.com";

describe("lanes (HTC_OP)", () => {
	let raiz = "";
	let anterior: Record<string, string | undefined> = {};

	beforeEach(() => {
		raiz = mkdtempSync(join(tmpdir(), "htc-op-"));
		anterior = {
			HTC_STATE_DIR: process.env.HTC_STATE_DIR,
			HTC_OP: process.env.HTC_OP,
			HTC_SESSION_ID: process.env.HTC_SESSION_ID,
			HTC_MISSAO_FILE: process.env.HTC_MISSAO_FILE,
			HTC_FILA: process.env.HTC_FILA,
		};
		process.env.HTC_STATE_DIR = raiz;
		delete process.env.HTC_OP;
		delete process.env.HTC_SESSION_ID;
		delete process.env.HTC_MISSAO_FILE;
		delete process.env.HTC_FILA;
	});

	afterEach(() => {
		for (const [chave, valor] of Object.entries(anterior)) {
			if (valor === undefined) delete process.env[chave];
			else process.env[chave] = valor;
		}
		rmSync(raiz, { recursive: true, force: true });
	});

	it("chave normaliza OP1 e op1 para a mesma lane", () => {
		expect(chaveDaOperacao("OP1")).toBe("op1");
		expect(chaveDaOperacao(" op1 ")).toBe("op1");
		expect(chaveDaOperacao("op 1 / alpha")).toBe("op-1-alpha");
		expect(chaveDaOperacao("")).toBe("op");
	});

	it("missao da lane vence o session id e nao cai no global", () => {
		process.env.HTC_SESSION_ID = "sessao-descartavel";
		process.env.HTC_OP = "OP1";
		const caminho = caminhoMissao();
		expect(caminho.endsWith(join("state", "missao.op1.json"))).toBe(true);
		expect(caminho).not.toContain("sessao-descartavel");
	});

	it("fila da lane vence o session id", () => {
		process.env.HTC_SESSION_ID = "sessao-descartavel";
		process.env.HTC_OP = "op2";
		expect(caminhoFila().endsWith(join("state", "fila.op2.json"))).toBe(true);
	});

	it("cria a lane e e idempotente pela chave", () => {
		const primeira = criarOperacao({
			nome: "OP1",
			alvo: OPERACAO_A,
			escopo: [`api.${OPERACAO_A}`],
		});
		expect(primeira.criada).toBe(true);
		expect(primeira.operacao.nome).toBe("op1");
		expect(primeira.operacao.escopo).toEqual([`api.${OPERACAO_A}`]);
		expect(existsSync(caminhoOperacoes())).toBe(true);

		const segunda = criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		expect(segunda.criada).toBe(false);
		expect(carregarOperacoes()).toHaveLength(1);
		// escopo antigo nao e apagado por uma atualizacao sem escopo
		expect(segunda.operacao.escopo).toEqual([`api.${OPERACAO_A}`]);
	});

	it("estado da lane le a missao dela, nao a da outra", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		criarOperacao({ nome: "op2", alvo: OPERACAO_B });
		abrirMissao({ alvo: OPERACAO_A, env: { ...process.env, HTC_OP: "op1" } });
		definirDegrau("entrada", { ...process.env, HTC_OP: "op1" });
		registrarAchado(
			{ titulo: "token inautenticado 200", evidencia: "x_auth_token", validado: true },
			{ ...process.env, HTC_OP: "op1" },
		);
		abrirMissao({ alvo: OPERACAO_B, env: { ...process.env, HTC_OP: "op2" } });
		registrarAchado(
			{ titulo: "whitelist trn 217/219/638", validado: false },
			{ ...process.env, HTC_OP: "op2" },
		);

		const a = estadoDaOperacao("op1");
		const b = estadoDaOperacao("op2");
		expect(a?.degrau).toBe("entrada");
		expect(a?.n).toBe(3);
		expect(a?.achados).toBe(1);
		expect(a?.validados).toBe(1);
		expect(a?.ultimo).toBe("token inautenticado 200");
		expect(a?.instrumento.length).toBeGreaterThan(0);
		expect(b?.achados).toBe(1);
		expect(b?.validados).toBe(0);
	});

	it("board mostra as duas lanes com degrau e contagem", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		criarOperacao({ nome: "op2", alvo: OPERACAO_B });
		abrirMissao({ alvo: OPERACAO_B, env: { ...process.env, HTC_OP: "op2" } });
		definirDegrau("webshell", { ...process.env, HTC_OP: "op2" });
		const quadro = quadroDeOperacoes();
		expect(quadro).toContain("op1");
		expect(quadro).toContain("op2");
		expect(quadro).toContain("degrau 4/10 webshell");
		expect(quadro).toContain("0 achados/0 validados");
	});

	it("instrumento fixado pela lane vence a tabela do degrau", () => {
		criarOperacao({
			nome: "op1",
			alvo: OPERACAO_A,
			instrumento: "the live token on the operation the app already authorizes",
		});
		abrirMissao({ alvo: OPERACAO_A, env: { ...process.env, HTC_OP: "op1" } });
		definirDegrau("sessao", { ...process.env, HTC_OP: "op1" });
		const estado = estadoDaOperacao("op1");
		expect(estado?.degrau).toBe("sessao");
		expect(estado?.instrumento).toBe(
			"the live token on the operation the app already authorizes",
		);
	});

	it("prompt gerado carrega alvo, instrumento e a cerca das outras lanes", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		criarOperacao({ nome: "op2", alvo: OPERACAO_B });
		abrirMissao({ alvo: OPERACAO_A, env: { ...process.env, HTC_OP: "op1" } });
		const prompt = promptDaOperacao("op1");
		expect(prompt).toBeDefined();
		expect(prompt).toContain(OPERACAO_A);
		expect(prompt).toContain("degrau: 2/10 superficie");
		expect(prompt).toContain("instrument:");
		expect(prompt).toContain("proof required:");
		expect(prompt).toContain(`Nao toque em: ${OPERACAO_B}`);
		expect(prompt).toContain("HTC_OP=op1");
		expect(prompt).not.toContain(`Nao toque em: ${OPERACAO_A}`);
	});

	it("cerca lista hosts das outras lanes sem repetir", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A, escopo: [`api.${OPERACAO_A}`] });
		criarOperacao({ nome: "op2", alvo: OPERACAO_B, escopo: [OPERACAO_A] });
		// op1 ve o alvo de op2 E o host que op2 declarou no escopo dela
		expect(hostsDasOutrasLanes("op1")).toEqual([OPERACAO_B, OPERACAO_A]);
		expect(hostsDasOutrasLanes("op2")).toEqual([OPERACAO_A, `api.${OPERACAO_A}`]);
	});

	it("grava o prompt e devolve o caminho da lane", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		const caminho = gravarPromptDaOperacao("op1");
		expect(caminho).toBe(caminhoPromptDaOperacao("op1"));
		expect(existsSync(caminho as string)).toBe(true);
		expect(readFileSync(caminho as string, "utf8")).toContain(OPERACAO_A);
	});

	it("comando de abertura aponta para o prompt e carrega HTC_OP", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		const comando = comandoDaOperacao("op1");
		expect(comando).toBeDefined();
		expect(comando?.env.HTC_OP).toBe("op1");
		expect(comando?.args).toContain("-z");
		expect(comando?.args.join(" ")).toContain(caminhoPromptDaOperacao("op1"));
		expect(comandoDaOperacao("nao-existe")).toBeUndefined();
	});

	it("comando bloqueante nao usa -z e mantem HTC_OP", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		const comando = comandoDaOperacao("op1", process.env, {
			bloqueante: true,
			extras: ["-t", "60"],
		});
		expect(comando).toBeDefined();
		expect(comando?.env.HTC_OP).toBe("op1");
		expect(comando?.args).not.toContain("-z");
		expect(comando?.args).toContain("--yolo");
		expect(comando?.args).toContain("--auto-continue");
		expect(comando?.args.slice(-2)).toEqual(["-t", "60"]);
	});

	it("fechar a lane mantem o estado da missao no disco", () => {
		criarOperacao({ nome: "op1", alvo: OPERACAO_A });
		abrirMissao({ alvo: OPERACAO_A, env: { ...process.env, HTC_OP: "op1" } });
		const fechada = fecharOperacao("op1");
		expect(fechada?.fechada).toBe(true);
		expect(existsSync(caminhoMissao({ ...process.env, HTC_OP: "op1" }))).toBe(true);
	});
});
