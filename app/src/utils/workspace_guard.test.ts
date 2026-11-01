// language: TypeScript, file: src/utils/workspace_guard.test.ts, runtime: Bun, runner: bun:test
import { afterEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import {
	aviso_de_workspace_largo,
	eh_raiz_de_volume,
	eh_workspace_largo,
	indexacao_do_workspace_bloqueada,
	override_de_workspace_largo,
	VARIAVEL_DE_OVERRIDE,
} from "./workspace_guard";

const HOME = homedir();

afterEach(() => {
	delete process.env[VARIAVEL_DE_OVERRIDE];
});

describe("eh_raiz_de_volume", () => {
	it("detecta a raiz do volume atual", () => {
		expect(eh_raiz_de_volume(parse(HOME).root)).toBe(true);
	});

	it("nao confunde projeto com raiz", () => {
		expect(eh_raiz_de_volume(join(HOME, "projeto"))).toBe(false);
	});
});

describe("eh_workspace_largo", () => {
	it("marca o home como amplo", () => {
		expect(eh_workspace_largo(HOME)).toBe(true);
	});

	it("marca a raiz do volume como ampla", () => {
		expect(eh_workspace_largo(parse(HOME).root)).toBe(true);
	});

	it("marca um ancestral do home como amplo", () => {
		const pai = resolve(HOME, "..");
		expect(eh_workspace_largo(pai)).toBe(true);
	});

	it("nao marca um projeto dentro do home", () => {
		expect(eh_workspace_largo(join(HOME, "projetos", "cliente"))).toBe(false);
	});

	it("nao marca o diretorio atual do repo", () => {
		expect(eh_workspace_largo(process.cwd())).toBe(false);
	});
});

describe("indexacao_do_workspace_bloqueada", () => {
	it("bloqueia o home", () => {
		expect(indexacao_do_workspace_bloqueada(HOME, {})).toBe(true);
	});

	it("libera o home com override explicito", () => {
		expect(
			indexacao_do_workspace_bloqueada(HOME, { [VARIAVEL_DE_OVERRIDE]: "1" }),
		).toBe(false);
	});

	it("nao bloqueia projeto normal", () => {
		expect(
			indexacao_do_workspace_bloqueada(join(HOME, "projetos", "x"), {}),
		).toBe(false);
	});
});

describe("override_de_workspace_largo", () => {
	it("aceita 1/true/yes e recusa o resto", () => {
		expect(override_de_workspace_largo({ [VARIAVEL_DE_OVERRIDE]: "1" })).toBe(true);
		expect(override_de_workspace_largo({ [VARIAVEL_DE_OVERRIDE]: "TRUE" })).toBe(true);
		expect(override_de_workspace_largo({ [VARIAVEL_DE_OVERRIDE]: "yes" })).toBe(true);
		expect(override_de_workspace_largo({ [VARIAVEL_DE_OVERRIDE]: "0" })).toBe(false);
		expect(override_de_workspace_largo({})).toBe(false);
	});
});

describe("aviso_de_workspace_largo", () => {
	it("cita o caminho e a variavel de override", () => {
		const aviso = aviso_de_workspace_largo(HOME);
		expect(aviso).toContain(HOME);
		expect(aviso).toContain(VARIAVEL_DE_OVERRIDE);
	});
});
