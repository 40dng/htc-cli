import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import {
	aplicar_snapshot_do_shadow,
	criar_checkpoint_no_shadow,
	diretorio_do_shadow,
	listar_checkpoints_do_shadow,
} from "./checkpoint-shadow";

let raiz = "";
let workspace = "";
let baseDoShadow = "";

function preparar(): void {
	raiz = mkdtempSync(join(tmpdir(), "htc-ckpt-test-"));
	workspace = join(raiz, "workspace");
	baseDoShadow = join(raiz, "shadow");
	mkdirSync(workspace, { recursive: true });
	process.env.HTC_CHECKPOINT_DIR = baseDoShadow;
}

function contexto(runCount: number) {
	return { cwd: workspace, sessionId: "sessao-teste", runCount } as never;
}

function contextoDe(sessionId: string, runCount: number) {
	return { cwd: workspace, sessionId, runCount } as never;
}

/**
 * Cria um arquivo cujo caminho absoluto passa de MAX_PATH (260 no Windows).
 * Sem o prefixo `\\?\` o proprio Node recusa criar; e exatamente esse arquivo
 * que fazia o `git add` do snapshot abortar com "Filename too long" e o
 * checkpoint parar de salvar no workspace com repack de APK.
 */
function criar_caminho_longo(
	base: string,
): { arquivo: string; absoluto: string } | undefined {
	const segmento = "d".repeat(24);
	const segmentos = Array.from(
		{ length: 9 },
		(_, indice) => `${indice}${segmento}`,
	);
	const absoluto = join(base, ...segmentos, "f.txt");
	if (absoluto.length <= 260) {
		return undefined;
	}
	const prefixado = toNamespacedPath(absoluto);
	try {
		mkdirSync(toNamespacedPath(join(base, ...segmentos)), { recursive: true });
		writeFileSync(prefixado, "versao 1\n");
	} catch {
		return undefined;
	}
	return { arquivo: prefixado, absoluto };
}

beforeEach(preparar);

afterEach(() => {
	delete process.env.HTC_CHECKPOINT_DIR;
	try {
		rmSync(raiz, { recursive: true, force: true });
	} catch {
		// Nome reservado do Windows (teste de snapshot parcial) pode resistir.
	}
});

describe("checkpoint em repo-sombra", () => {
	it("salva snapshot em workspace SEM git", async () => {
		writeFileSync(join(workspace, "a.txt"), "estado inicial\n");
		const resultado = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(resultado?.ref).toMatch(/^[0-9a-f]{40}$/);
		expect(resultado?.runCount).toBe(1);
		expect(existsSync(join(diretorio_do_shadow(workspace), "HTC_SHADOW"))).toBe(true);
	});

	it("restaura o estado exato do snapshot", async () => {
		writeFileSync(join(workspace, "a.txt"), "versao 1\n");
		const primeiro = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(primeiro).toBeDefined();

		writeFileSync(join(workspace, "a.txt"), "versao 2\n");
		writeFileSync(join(workspace, "novo.txt"), "criado depois\n");

		const aplicado = await aplicar_snapshot_do_shadow(workspace, primeiro!.ref);
		expect(aplicado).toBe(true);
		expect(readFileSync(join(workspace, "a.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("versao 1\n");
		// Arquivo criado depois do snapshot nao sobrevive ao restore.
		expect(existsSync(join(workspace, "novo.txt"))).toBe(false);
	});

	it("nao engole node_modules nem gera commit sem identidade git", async () => {
		// Sem user.name/user.email globais o `commit-tree` do git aborta; a
		// identidade do shadow tem que cobrir isso.
		mkdirSync(join(workspace, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(workspace, "node_modules", "dep", "index.js"), "x\n");
		writeFileSync(join(workspace, "a.txt"), "conteudo\n");
		const resultado = await criar_checkpoint_no_shadow(contexto(2), workspace);
		expect(resultado).toBeDefined();
		// Conteudo igual, run diferente: commits distintos (o hash do commit
		// carrega runCount e timestamp; antes podia colidir e o core descartava).
		const segunda = await criar_checkpoint_no_shadow(contexto(3), workspace);
		expect(segunda?.ref).not.toBe(resultado?.ref);

		// node_modules fica FORA do snapshot: apagar um arquivo de dentro dele e
		// restaurar nao o traz de volta (senao o restore pagaria o custo de copiar
		// a arvore inteira em cima do operador).
		rmSync(join(workspace, "node_modules", "dep", "index.js"));
		expect(await aplicar_snapshot_do_shadow(workspace, resultado!.ref)).toBe(true);
		expect(existsSync(join(workspace, "node_modules", "dep", "index.js"))).toBe(false);
	});

	it("adota shadow orfao que perdeu a marca", async () => {
		writeFileSync(join(workspace, "a.txt"), "x\n");
		const primeiro = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(primeiro).toBeDefined();
		// Simula marca apagada por antivirus/escrita interrompida.
		unlinkSync(join(diretorio_do_shadow(workspace), "HTC_SHADOW"));
		const segundo = await criar_checkpoint_no_shadow(contexto(2), workspace);
		expect(segundo).toBeDefined();
	});

	it("recusa aplicar snapshot inexistente", async () => {
		writeFileSync(join(workspace, "a.txt"), "x\n");
		const aplicado = await aplicar_snapshot_do_shadow(
			workspace,
			"0000000000000000000000000000000000000000",
		);
		expect(aplicado).toBe(false);
	});

	it("salva e restaura arquivo com caminho acima de MAX_PATH", async () => {
		// Regressao do "checkpoint nao salva": o `git add` abortava inteiro em
		// "Filename too long" por causa de um unico arquivo de repack, e o turno
		// ficava sem snapshot. Sem core.longpaths + --ignore-errors isto volta a
		// falhar aqui.
		const longo = criar_caminho_longo(workspace);
		if (!longo) {
			// Filesystem sem suporte a caminho longo: nao ha o que medir.
			return;
		}
		writeFileSync(join(workspace, "a.txt"), "curto\n");
		const primeiro = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(primeiro?.ref).toMatch(/^[0-9a-f]{40}$/);

		writeFileSync(longo.arquivo, "versao 2\n");
		expect(await aplicar_snapshot_do_shadow(workspace, primeiro!.ref)).toBe(
			true,
		);
		expect(readFileSync(longo.arquivo, "utf8").replace(/\r\n/g, "\n")).toBe(
			"versao 1\n",
		);
	});

	it("lista os snapshots do workspace por sessao, ordenados por run", async () => {
		writeFileSync(join(workspace, "a.txt"), "v1\n");
		const primeiro = await criar_checkpoint_no_shadow(
			contextoDe("sessao-antiga", 1),
			workspace,
		);
		expect(primeiro).toBeDefined();
		writeFileSync(join(workspace, "a.txt"), "v2\n");
		const segundo = await criar_checkpoint_no_shadow(
			contextoDe("sessao-nova", 2),
			workspace,
		);
		expect(segundo).toBeDefined();

		// E o que faz "voltar depois de trocar de modelo": a sessao nova nao
		// herdou o metadata, mas os dois refs continuam no shadow.
		const lista = await listar_checkpoints_do_shadow(workspace);
		expect(lista.map((entrada) => entrada.runCount)).toEqual([1, 2]);
		expect(lista.map((entrada) => entrada.sessionId)).toEqual([
			"sessao-antiga",
			"sessao-nova",
		]);
		expect(lista[0]?.ref).toBe(primeiro?.ref);
		expect(lista[1]?.ref).toBe(segundo?.ref);
		expect(lista.every((entrada) => entrada.createdAt > 0)).toBe(true);
	});

	it("duas sessoes no mesmo run nao se apagam (modelo novo, run 1)", async () => {
		writeFileSync(join(workspace, "a.txt"), "v1\n");
		const primeiro = await criar_checkpoint_no_shadow(
			contextoDe("sessao-a", 1),
			workspace,
		);
		expect(primeiro).toBeDefined();
		writeFileSync(join(workspace, "a.txt"), "v2\n");
		const segundo = await criar_checkpoint_no_shadow(
			contextoDe("sessao-b", 1),
			workspace,
		);
		expect(segundo).toBeDefined();

		// Mesmo run, sessoes diferentes: chave so por run apagava o primeiro.
		const lista = await listar_checkpoints_do_shadow(workspace);
		expect(lista.map((entrada) => entrada.sessionId)).toEqual([
			"sessao-a",
			"sessao-b",
		]);
		expect(lista.map((entrada) => entrada.ref)).toEqual([
			primeiro?.ref,
			segundo?.ref,
		]);
	});

	it("fecha snapshot mesmo quando o git recusa um arquivo", async () => {
		// Nome reservado do Windows faz o `add` inteiro falhar. Antes disso o
		// turno ficava sem snapshot nenhum; agora o que da para indexar entra e
		// o que ficou de fora vira aviso no log.
		writeFileSync(join(workspace, "normal.txt"), "ok\n");
		const reservado = toNamespacedPath(join(workspace, "CON"));
		try {
			writeFileSync(reservado, "reservado\n");
		} catch {
			return;
		}

		const resultado = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(resultado?.ref).toMatch(/^[0-9a-f]{40}$/);

		rmSync(reservado, { force: true });
		rmSync(join(workspace, "normal.txt"), { force: true });
		expect(await aplicar_snapshot_do_shadow(workspace, resultado!.ref)).toBe(
			true,
		);
		expect(existsSync(join(workspace, "normal.txt"))).toBe(true);
	});

	it("reaproveita o indice entre turnos", async () => {
		// Indice novo a cada turno obrigava o git a rehashar o workspace inteiro:
		// 373s medidos em 202 mil arquivos, e o turno morria no teto de tempo.
		writeFileSync(join(workspace, "a.txt"), "v1\n");
		const primeiro = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(primeiro).toBeDefined();
		const indice = join(diretorio_do_shadow(workspace), "htc-index");
		expect(existsSync(indice)).toBe(true);

		writeFileSync(join(workspace, "b.txt"), "v2\n");
		const segundo = await criar_checkpoint_no_shadow(contexto(2), workspace);
		expect(segundo).toBeDefined();
		expect(segundo?.ref).not.toBe(primeiro?.ref);
		// Mesmo indice: o segundo snapshot enxerga o arquivo novo.
		expect(await aplicar_snapshot_do_shadow(workspace, primeiro!.ref)).toBe(
			true,
		);
		expect(existsSync(join(workspace, "b.txt"))).toBe(false);
		expect(existsSync(join(workspace, "a.txt"))).toBe(true);
	});

	it("recupera de index.lock deixado por processo morto", async () => {
		// O `add` morto pelo teto de tempo deixa o lock; sem esta recuperacao
		// todo snapshot seguinte falhava com "index.lock: File exists".
		writeFileSync(join(workspace, "a.txt"), "v1\n");
		const sombra = diretorio_do_shadow(workspace);
		mkdirSync(sombra, { recursive: true });
		writeFileSync(join(sombra, "htc-index.lock"), "");

		const resultado = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(resultado?.ref).toMatch(/^[0-9a-f]{40}$/);
		expect(existsSync(join(sombra, "htc-index.lock"))).toBe(false);
	});

	it("nao rouba o lock de um aquecimento em andamento", async () => {
		// Aquecimento em background escrevendo no indice: remover o lock aqui
		// corromperia o indice. O turno adia o snapshot e o proximo pega o
		// indice quente.
		writeFileSync(join(workspace, "a.txt"), "v1\n");
		const sombra = diretorio_do_shadow(workspace);
		mkdirSync(sombra, { recursive: true });
		const lock = join(sombra, "htc-index.lock");
		const marca = join(sombra, "htc-index.aquecendo");
		writeFileSync(lock, "");
		writeFileSync(marca, "1234");

		const resultado = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(resultado).toBeUndefined();
		expect(existsSync(lock)).toBe(true);
		expect(existsSync(marca)).toBe(true);

		rmSync(lock, { force: true });
		rmSync(marca, { force: true });
		const depois = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(depois?.ref).toMatch(/^[0-9a-f]{40}$/);
	});

	it("nao grava snapshot quando nada e indexavel", async () => {
		// So node_modules: a arvore sai vazia. Um commit vazio viraria um
		// "restore para o nada" e o `clean -fd` apagaria o workspace.
		mkdirSync(join(workspace, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(workspace, "node_modules", "dep", "index.js"), "x\n");
		const resultado = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(resultado).toBeUndefined();
	});

	it("nao lista snapshot de seguranca do restore como checkpoint", async () => {
		// `aplicar_snapshot_do_shadow` grava um snapshot interno por restore.
		// Se ele entrasse na lista, um "run 1" falso cobriria o run 1 real.
		writeFileSync(join(workspace, "a.txt"), "v1\n");
		const real = await criar_checkpoint_no_shadow(contexto(1), workspace);
		expect(real).toBeDefined();
		await criar_checkpoint_no_shadow(
			contextoDe("restore-1700000000000", 1),
			workspace,
		);

		const lista = await listar_checkpoints_do_shadow(workspace);
		expect(lista.map((entrada) => entrada.sessionId)).toEqual(["sessao-teste"]);
		expect(lista[0]?.ref).toBe(real?.ref);
	});
});
