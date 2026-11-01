
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	absorverAlvos,
	adicionarAlvos,
	avancarPorConclusao,
	blocoFila,
	caminhoFila,
	caminhoFilaPendente,
	carregarFila,
	chaveDoAlvo,
	deveEstacionar,
	enquadrarTurno,
	ehLote,
	extrairAlvos,
	limparFila,
	limparTodasAsFilas,
	listarFilasDeSessao,
	marcarAlvo,
	MAX_TENTATIVAS_ALVO,
	proximoAlvo,
	reivindicarFilaPendente,
	registrarTentativa,
	estadoFila,
	resumoFila,
} from "./fila-alvos";
import {
	abrirMissao,
	caminhoMissao,
	carregarMissao,
	sincronizarMissaoComPrompt,
} from "./missao";

let raiz = "";
let arquivo = "";

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-fila-"));
	arquivo = join(raiz, "fila.json");
	process.env.HTC_FILA = arquivo;
});

afterEach(() => {
	delete process.env.HTC_FILA;
	rmSync(raiz, { recursive: true, force: true });
});

const LOTE = `roda o mesmo fluxo nesses:
https://a.example.com/login
https://b.example.com/
c.example.com.br
https://d.example.net:8443/app
e.example.org
mesma tecnica do ultimo, sem varrer o que ja tem resultado em ops/alvos/x.com/y.txt`;

describe("fila de alvos", () => {
	it("extrai os alvos e ignora caminho local", () => {
		const alvos = extrairAlvos(LOTE);
		expect(alvos).toHaveLength(5);
		expect(alvos.join(" ")).not.toContain("ops/alvos");
		expect(alvos.join(" ")).not.toContain("y.txt");
	});

	it("absorve a lista quando o operador aponta um arquivo", () => {
		const lista = join(raiz, "alvos novos.txt");
		writeFileSync(
			lista,
			"     001 CoopA           https://coop-a.example.com/\r\n     002 CoopD/CoopChttps://coop-c.example.com/\r\n     003 CoopB             https://coop-b.example.com/\r\n",
			"utf8",
		);
		const prompt = `continue, as operacoes serao nos alvos agora "${lista}"`;
		const absorcao = absorverAlvos(prompt);
		expect(absorcao.arquivos?.[0]?.alvos).toHaveLength(3);
		expect(absorcao.citados).toHaveLength(3);
		expect(absorcao.absorvidos).toHaveLength(3);
		expect(ehLote(absorcao)).toBe(true);
		// O caminho nao fica no texto: apontar o arquivo deixa o modelo abrir a lista.
		expect(absorcao.texto).not.toContain(lista);
		expect(absorcao.texto).not.toContain("coop-a");
		expect(absorcao.texto).toContain("continue");
		expect(absorcao.texto).toContain("3 host(s) absorbed");
		expect(absorcao.alvo?.chave).toBe("coop-a.example.com");
	});

	it("caminho inexistente ou sem alvo nao muda nada", () => {
		const vazio = join(raiz, "vazio.txt");
		writeFileSync(vazio, "sem host aqui, so prosa\r\n", "utf8");
		const prompt = `continua com "${join(raiz, "nao-existe.txt")}" e "${vazio}"`;
		const absorcao = absorverAlvos(prompt);
		expect(absorcao.citados).toHaveLength(0);
		expect(ehLote(absorcao)).toBe(false);
		expect(absorcao.texto).toContain("nao-existe.txt");
	});

	it("nao duplica alvo que veio no texto e no arquivo", () => {
		const lista = join(raiz, "mix.txt");
		writeFileSync(lista, "https://a.example.com/\nb.example.com\n", "utf8");
		const absorcao = absorverAlvos(`usa https://a.example.com/login e "${lista}"`);
		expect(absorcao.citados).toHaveLength(2);
		expect(absorcao.absorvidos).toHaveLength(2);
	});

	it("deduplica pelo host", () => {
		const alvos = extrairAlvos("https://a.example.com/x e a.example.com/y");
		expect(alvos).toHaveLength(1);
		expect(chaveDoAlvo(alvos[0])).toBe("a.example.com");
	});

	it("absorve a lista: o texto que segue para o modelo nao tem alvo", () => {
		const absorcao = absorverAlvos(LOTE);
		expect(absorcao.absorvidos).toHaveLength(5);
		expect(absorcao.total).toBe(5);
		expect(absorcao.alvo?.chave).toBe("a.example.com");
		expect(absorcao.texto).not.toMatch(/example\.(com|net|org)/);
		expect(absorcao.texto).toContain("mesma tecnica");
	});

	it("aponta um alvo por turno e nao cita os outros", () => {
		absorverAlvos(LOTE);
		proximoAlvo();
		const bloco = blocoFila();
		expect(bloco).toContain("a.example.com");
		expect(bloco).not.toContain("b.example.com");
		expect(bloco).not.toContain("e.example.org");
		expect(bloco.toLowerCase()).not.toContain("5 alvo");
	});

	it("rotaciona a forma do pedido a cada tentativa", () => {
		const formas = [0, 1, 2, 3, 4].map((t) => enquadrarTurno("a.example.com", "sobe o fluxo", t));
		expect(new Set(formas).size).toBe(5);
		for (const forma of formas) expect(forma).toContain("a.example.com");
	});

	it("a quinta forma e cega: so protocolo, sem enquadramento", () => {
		const cega = enquadrarTurno("a.example.com", "sobe o fluxo", 4);
		expect(cega).toContain("Protocol first");
		expect(cega).not.toContain("TARGET:");
		expect(cega).not.toContain("Work order");
		expect(cega).not.toContain("stopped short");
	});

	it("avanca para o proximo quando o alvo fecha", () => {
		absorverAlvos(LOTE);
		const primeiro = proximoAlvo();
		expect(primeiro?.chave).toBe("a.example.com");
		marcarAlvo(primeiro?.alvo ?? "", "feito");
		const segundo = proximoAlvo();
		expect(segundo?.chave).toBe("b.example.com");
		expect(estadoFila().feito).toBe(1);
		expect(estadoFila().em_curso).toBe(1);
	});

	it("estaciona o alvo depois do teto de tentativas", () => {
		adicionarAlvos(["a.example.com"]);
		const alvo = proximoAlvo();
		for (let i = 0; i < MAX_TENTATIVAS_ALVO; i += 1) registrarTentativa(alvo?.alvo ?? "");
		expect(deveEstacionar(alvo?.alvo ?? "")).toBe(true);
		marcarAlvo(alvo?.alvo ?? "", "parado", "recusa persistente");
		expect(estadoFila().parado).toBe(1);
		expect(estadoFila().atual).toBeUndefined();
	});

	it("fila corrompida nao quebra o turno", () => {
		writeFileSync(arquivo, "{ nao e json", "utf8");
		expect(carregarFila()).toEqual({ alvos: [] });
		expect(blocoFila()).toBe("");
		expect(resumoFila()).toBe("fila vazia");
	});

	it("respeita HTC_FILA e limpa a fila", () => {
		expect(caminhoFila()).toBe(arquivo);
		adicionarAlvos(["a.example.com", "b.example.com"]);
		expect(limparFila()).toBe(2);
		expect(carregarFila().alvos).toEqual([]);
	});

	it("so trava a fila quando a entrada e lote", () => {
		const unico = absorverAlvos("olha https://a.example.com");
		expect(ehLote(unico)).toBe(false);
		const lista = absorverAlvos("x https://b.example.com e c.example.org");
		expect(ehLote(lista)).toBe(true);
		const maisUm = absorverAlvos("agora https://d.example.net");
		expect(ehLote(maisUm)).toBe(true);
	});

	it("nao duplica alvo ja enfileirado quando o operador repete", () => {
		adicionarAlvos(["a.example.com"]);
		const segunda = absorverAlvos("de novo https://a.example.com/x");
		expect(segunda.absorvidos).toEqual([]);
		expect(segunda.total).toBe(1);
	});
});

describe("fila e missao", () => {
	it("avancar por [ALVO OK] reposiciona a missao no proximo alvo", () => {
		// Estado isolado: a sincronizacao nunca toca ~/.htc do operador.
		const estado = mkdtempSync(join(tmpdir(), "htc-estado-"));
		const anterior = process.env.HTC_STATE_DIR;
		process.env.HTC_STATE_DIR = estado;
		try {
			adicionarAlvos(["a.example.com", "b.example.com"], process.env);
			proximoAlvo(process.env);
			abrirMissao({ alvo: "a.example.com", env: process.env });
			const proximo = avancarPorConclusao("fechei o host [ALVO OK]", process.env);
			expect(proximo?.alvo).toBe("b.example.com");
			expect(carregarMissao(process.env)?.alvo).toBe("b.example.com");
		} finally {
			if (anterior === undefined) delete process.env.HTC_STATE_DIR;
			else process.env.HTC_STATE_DIR = anterior;
			rmSync(estado, { recursive: true, force: true });
		}
	});

	it("sem missao aberta, o marcador nao cria estado de missao", () => {
		const estado = mkdtempSync(join(tmpdir(), "htc-estado-"));
		const anterior = process.env.HTC_STATE_DIR;
		process.env.HTC_STATE_DIR = estado;
		try {
			adicionarAlvos(["a.example.com", "b.example.com"], process.env);
			proximoAlvo(process.env);
			avancarPorConclusao("[ALVO OK]", process.env);
			expect(carregarMissao(process.env)).toBeUndefined();
		} finally {
			if (anterior === undefined) delete process.env.HTC_STATE_DIR;
			else process.env.HTC_STATE_DIR = anterior;
			rmSync(estado, { recursive: true, force: true });
		}
	});

	it("a missao acompanha o alvo citado e nao afirma o alvo de ontem", () => {
		const estado = mkdtempSync(join(tmpdir(), "htc-estado-"));
		const anterior = process.env.HTC_STATE_DIR;
		process.env.HTC_STATE_DIR = estado;
		try {
			abrirMissao({ alvo: "bore.pub:16086", env: process.env });
			const citado = sincronizarMissaoComPrompt(
				"sobe o chisel em https://coop-a.example.com e testa a 443",
				process.env,
			);
			expect(citado?.alvo).toContain("coop-a.example.com");
			// continua o mesmo alvo: nao reinicia a missao
			const mesmo = sincronizarMissaoComPrompt(
				"testa a 8443 do coop-a.example.com agora",
				process.env,
			);
			expect(mesmo?.achados.length).toBe(citado?.achados.length);
		} finally {
			if (anterior === undefined) delete process.env.HTC_STATE_DIR;
			else process.env.HTC_STATE_DIR = anterior;
			rmSync(estado, { recursive: true, force: true });
		}
	});

	it("blocoFila so afirma o alvo quando o turno e dele", () => {
		const estado = mkdtempSync(join(tmpdir(), "htc-estado-"));
		const anterior = process.env.HTC_STATE_DIR;
		process.env.HTC_STATE_DIR = estado;
		try {
			adicionarAlvos(["a.example.com"], process.env);
			proximoAlvo(process.env);
			expect(blocoFila(process.env, "acao", false)).toBe("");
			expect(blocoFila(process.env, "acao", true)).toContain("TARGET IN HAND");
		} finally {
			if (anterior === undefined) delete process.env.HTC_STATE_DIR;
			else process.env.HTC_STATE_DIR = anterior;
			rmSync(estado, { recursive: true, force: true });
		}
	});
});

describe("fila por sessao", () => {
	const comEstado = (fn: (estado: string) => void): void => {
		const estado = mkdtempSync(join(tmpdir(), "htc-estado-"));
		const anteriorEstado = process.env.HTC_STATE_DIR;
		const anteriorSessao = process.env.HTC_SESSION_ID;
		process.env.HTC_STATE_DIR = estado;
		delete process.env.HTC_FILA;
		mkdirSync(join(estado, "state"), { recursive: true });
		try {
			fn(estado);
		} finally {
			if (anteriorEstado === undefined) delete process.env.HTC_STATE_DIR;
			else process.env.HTC_STATE_DIR = anteriorEstado;
			if (anteriorSessao === undefined) delete process.env.HTC_SESSION_ID;
			else process.env.HTC_SESSION_ID = anteriorSessao;
			process.env.HTC_FILA = arquivo;
			rmSync(estado, { recursive: true, force: true });
		}
	};

	it("cada sessao escreve na propria fila", () => {
		comEstado((estado) => {
			process.env.HTC_SESSION_ID = "sessao-a";
			expect(caminhoFila()).toBe(join(estado, "state", "fila.sessao-a.json"));
			adicionarAlvos(["a.example.com"], process.env);
			process.env.HTC_SESSION_ID = "sessao-b";
			expect(carregarFila(process.env).alvos).toHaveLength(0);
			adicionarAlvos(["b.example.com"], process.env);
			process.env.HTC_SESSION_ID = "sessao-a";
			expect(carregarFila(process.env).alvos.map((a) => a.alvo)).toEqual([
				"a.example.com",
			]);
			expect(
				listarFilasDeSessao(process.env).map((fila) => fila.sessao).sort(),
			).toEqual(["sessao-a", "sessao-b"]);
		});
	});

	it("a pendente e reivindicada uma vez so", () => {
		comEstado((estado) => {
			const pendente = caminhoFilaPendente(process.env);
			writeFileSync(
				pendente,
				JSON.stringify({
					alvos: [
						{ alvo: "a.example.com", estado: "novo", tentativas: 0, criado_em: "x" },
					],
				}),
			);
			process.env.HTC_SESSION_ID = "sessao-a";
			expect(reivindicarFilaPendente(process.env)).toBe(true);
			expect(carregarFila(process.env).alvos).toHaveLength(1);
			// segunda sessao nao herda: a pendente ja foi consumida
			process.env.HTC_SESSION_ID = "sessao-b";
			expect(reivindicarFilaPendente(process.env)).toBe(false);
			expect(carregarFila(process.env).alvos).toHaveLength(0);
			expect(existsSync(join(estado, "state", "fila.sessao-a.json"))).toBe(true);
		});
	});

	it("limparTodasAsFilas apaga global, sessoes e pendente", () => {
		comEstado((estado) => {
			writeFileSync(
				join(estado, "state", "fila.json"),
				JSON.stringify({ alvos: [{ alvo: "g.example.com" }] }),
			);
			process.env.HTC_SESSION_ID = "sessao-a";
			adicionarAlvos(["a.example.com"], process.env);
			process.env.HTC_SESSION_ID = "sessao-b";
			adicionarAlvos(["b.example.com"], process.env);
			writeFileSync(
				caminhoFilaPendente(process.env),
				JSON.stringify({ alvos: [{ alvo: "p.example.com" }] }),
			);
			const limpos = limparTodasAsFilas();
			expect(limpos.map((fila) => fila.sessao).sort()).toEqual([
				"(global)",
				"(pendente)",
				"sessao-a",
				"sessao-b",
			]);
			expect(listarFilasDeSessao(process.env)).toHaveLength(0);
			expect(existsSync(join(estado, "state", "fila.json"))).toBe(false);
			expect(existsSync(caminhoFilaPendente(process.env))).toBe(false);
		});
	});

	it("missao de uma sessao nao aparece na outra", () => {
		comEstado(() => {
			process.env.HTC_SESSION_ID = "sessao-a";
			abrirMissao({ alvo: "a.example.com", env: process.env });
			expect(caminhoMissao(process.env)).toContain("missao.sessao-a.json");
			process.env.HTC_SESSION_ID = "sessao-b";
			expect(carregarMissao(process.env)).toBeUndefined();
		});
	});
});
