// language: TypeScript, file: src/runtime/contexto.test.ts, runtime: bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CONTRATO_EMBUTIDO,
	caixa_para_system,
	caixa_para_turno,
	contexto_ativo,
	extrair_bloco,
	injetar_caixa_no_system,
	montar_caixa,
	resumo_da_caixa,
} from "./contexto";

const OPERACAO = `# manual

<!-- htc:contrato:inicio -->
CONTRATO — objetivo: transferencia a partir de entidade com RSFN.
Ladder: ecossistema -> superficie -> entrada -> webshell.
<!-- htc:contrato:fim -->

texto de referencia que NAO e contrato
`;

const ARQUIVOS = `# mapa

<!-- htc:mapa:inicio -->
MAPA — Windows codigo, Kali execucao, VPS saida.
<!-- htc:mapa:fim -->
`;

describe("caixa de contexto", () => {
	let raiz = "";
	let dossies = "";
	let anterior: Record<string, string | undefined> = {};

	beforeEach(() => {
		raiz = mkdtempSync(join(tmpdir(), "htc-ctx-"));
		dossies = join(raiz, "dossies");
		mkdirSync(dossies, { recursive: true });
		writeFileSync(join(dossies, "OPERACAO.md"), OPERACAO, "utf8");
		writeFileSync(join(dossies, "ARQUIVOS.md"), ARQUIVOS, "utf8");
		anterior = {
			HTC_STATE_DIR: process.env.HTC_STATE_DIR,
			HTC_DOSSIES: process.env.HTC_DOSSIES,
			HTC_CONTEXTO: process.env.HTC_CONTEXTO,
			HTC_SESSION_ID: process.env.HTC_SESSION_ID,
		};
		process.env.HTC_STATE_DIR = join(raiz, "state");
		process.env.HTC_DOSSIES = dossies;
		delete process.env.HTC_CONTEXTO;
		delete process.env.HTC_SESSION_ID;
	});

	afterEach(() => {
		for (const [chave, valor] of Object.entries(anterior)) {
			if (valor === undefined) delete process.env[chave];
			else process.env[chave] = valor;
		}
		rmSync(raiz, { recursive: true, force: true });
	});

	it("recorta o bloco entre marcadores e ignora o resto", () => {
		expect(extrair_bloco(OPERACAO, "<!-- htc:contrato:inicio -->", "<!-- htc:contrato:fim -->"))
			.toContain("objetivo: transferencia");
		expect(extrair_bloco(OPERACAO, "<!-- htc:contrato:inicio -->", "<!-- htc:contrato:fim -->"))
			.not.toContain("texto de referencia");
		expect(extrair_bloco(OPERACAO, "<!-- nada -->", "<!-- fim -->")).toBeUndefined();
	});

	it("monta a caixa com contrato e mapa medidos, e hash estavel", () => {
		const a = montar_caixa();
		const b = montar_caixa();
		expect(a.texto).toContain("objetivo: transferencia");
		expect(a.texto).toContain("Kali execucao");
		expect(a.texto).toContain("THE LADDER");
		expect(a.texto).toContain("PAYLOAD DISCIPLINE");
		expect(a.texto).toContain("OPERATIONAL SECURITY");
		expect(a.texto).toContain("AUTONOMOUS MODE");
		expect(a.marca).toMatch(/^\[CTX:[0-9a-f]{8}\]$/);
		expect(a.hash).toBe(b.hash);
		expect(a.marca).toBe(b.marca);
		expect(a.caminho.endsWith(`${a.hash}.md`)).toBe(true);
	});

	it("sem dossie no disco cai no contrato embutido em vez de sair vazia", () => {
		process.env.HTC_DOSSIES = join(raiz, "nao-existe");
		const caixa = montar_caixa();
		expect(caixa.texto).toContain("built-in fallback");
		expect(caixa.texto).toContain(CONTRATO_EMBUTIDO.split("\n")[1]);
		expect(caixa.fontes.find((f) => f.nome === "contract")?.origem).toBe("built-in");
	});

	it("com a caixa no system, o turno leva so a marca", () => {
		const sistema = caixa_para_system();
		expect(sistema).toContain("objetivo: transferencia");
		expect(sistema).toContain("=== END CONSTANTS ===");

		const turno = caixa_para_turno();
		expect(turno).toMatch(/^\[CTX:[0-9a-f]{8}\] constants in system/);
		expect(turno.length).toBeLessThan(200);
	});

	it("sem injecao no system, o turno leva a caixa inteira", () => {
		const turno = caixa_para_turno();
		expect(turno).toContain("=== END CONSTANTS ===");
	});

	it("constante que muda vira aviso com o caminho para reler", () => {
		caixa_para_system();
		writeFileSync(
			join(dossies, "OPERACAO.md"),
			OPERACAO.replace("objetivo: transferencia", "objetivo: transferencia via STR"),
			"utf8",
		);
		const turno = caixa_para_turno();
		expect(turno).toContain("CONSTANTS CHANGED");
		expect(turno).toContain("reread");
		expect(turno).toContain("=== END CONSTANTS ===");
	});

	it("depois da injecao, o turno nunca volta a carregar a caixa inteira", () => {
		caixa_para_system();
		expect(caixa_para_turno()).toMatch(/constants in system/);
		process.env.HTC_SESSION_ID = "outra-sessao";
		expect(caixa_para_turno()).toMatch(/constants in system/);
	});

	it("injetar no system e idempotente e respeita HTC_CONTEXTO=off", () => {
		const injetado = injetar_caixa_no_system("PROMPT DO HARNESS");
		expect(injetado).toContain("PROMPT DO HARNESS");
		expect(injetado).toContain("=== CONTRACT");
		expect(injetar_caixa_no_system(injetado)).toBe(injetado);

		process.env.HTC_CONTEXTO = "off";
		expect(contexto_ativo()).toBe(false);
		expect(injetar_caixa_no_system("PROMPT DO HARNESS")).toBe("PROMPT DO HARNESS");
	});

	it("o resumo mostra hash, fontes e o arquivo em disco", () => {
		const resumo = resumo_da_caixa();
		expect(resumo).toContain("[CTX:");
		expect(resumo).toContain("contract=OPERACAO.md");
		expect(resumo).toContain("map=ARQUIVOS.md");
		expect(resumo).toContain("arquivo:");
	});
});
