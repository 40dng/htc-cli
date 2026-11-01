import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getThemeDefinition,
	listThemes,
	normalizeThemeId,
	resolveTheme,
} from "./themes";
import { lerTemasCustom, recarregarTemasCustom } from "./themes-custom";

let raiz = "";
let anterior = "";

const DETECTADO = { background: "#000000", foreground: "#ffffff" };

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-tema-"));
	anterior = process.env.HTC_STATE_DIR ?? "";
	process.env.HTC_STATE_DIR = raiz;
	mkdirSync(join(raiz, "state", "themes"), { recursive: true });
	recarregarTemasCustom();
});

afterEach(() => {
	if (anterior) process.env.HTC_STATE_DIR = anterior;
	else delete process.env.HTC_STATE_DIR;
	recarregarTemasCustom();
	rmSync(raiz, { recursive: true, force: true });
});

describe("temas do operador", () => {
	it("carrega JSON da pasta de temas", () => {
		writeFileSync(
			join(raiz, "state", "themes", "meu.json"),
			JSON.stringify({
				id: "meu-tema",
				label: "Meu Tema",
				variant: "dark",
				background: "#101014",
				foreground: "#e6e6ea",
			}),
			{ encoding: "utf8", flag: "w" },
		);
		const { temas, avisos } = lerTemasCustom(join(raiz, "state", "themes"));
		expect(avisos).toEqual([]);
		expect(temas).toHaveLength(1);
		expect(temas[0].id).toBe("meu-tema");
	});

	it("ignora cor invalida mas mantem o tema", () => {
		const dir = join(raiz, "state", "themes");
		writeFileSync(
			join(dir, "x.json"),
			JSON.stringify({
				id: "x",
				variant: "dark",
				accents: { act: "vermelho", plan: "#f0c" },
			}),
		);
		const { temas, avisos } = lerTemasCustom(dir);
		expect(temas[0].accents).toEqual({ plan: "#ff00cc" });
		expect(avisos.join(" ")).toContain("act");
	});

	it("aceita lista dentro de um arquivo", () => {
		const dir = join(raiz, "state", "themes");
		writeFileSync(
			join(dir, "pack.json"),
			JSON.stringify({
				themes: [
					{ id: "um", variant: "dark" },
					{ id: "dois", variant: "light" },
				],
			}),
		);
		expect(lerTemasCustom(dir).temas.map((t) => t.id)).toEqual(["um", "dois"]);
	});

	it("JSON quebrado nao derruba nada", () => {
		const dir = join(raiz, "state", "themes");
		writeFileSync(join(dir, "ruim.json"), "{ nao e json");
		const { temas, avisos } = lerTemasCustom(dir);
		expect(temas).toEqual([]);
		expect(avisos[0]).toContain("ruim.json");
	});

	it("entra na lista e resolve por id", () => {
		const dir = join(raiz, "state", "themes");
		writeFileSync(
			join(dir, "operador.json"),
			JSON.stringify({ id: "operador", variant: "dark", background: "#050505" }),
		);
		recarregarTemasCustom();
		const ids = listThemes().map((t) => t.id);
		expect(ids).toContain("operador");
		expect(normalizeThemeId("operador")).toBe("operador");
		expect(getThemeDefinition("operador")?.id).toBe("operador");
	});

	it("nao sobrescreve id embutido", () => {
		const dir = join(raiz, "state", "themes");
		writeFileSync(
			join(dir, "fake.json"),
			JSON.stringify({ id: "htc", label: "Sequestrado", variant: "dark" }),
		);
		recarregarTemasCustom();
		const htc = listThemes().filter((t) => t.id === "htc");
		expect(htc).toHaveLength(1);
		expect(htc[0].label).not.toBe("Sequestrado");
	});

	it("id desconhecido cai no tema padrao", () => {
		expect(normalizeThemeId("nao-existe")).toBe("htc");
	});
});

describe("camada de UI do tema", () => {
	it("da cor propria a link, negrito, grade e rotulos", () => {
		const tema = resolveTheme("htc", DETECTADO);
		expect(tema.ui.link).not.toBe(tema.ui.strong);
		expect(tema.ui.tableBorder).not.toBe(tema.ui.tableHeader);
		expect(tema.ui.tableHeader).toBe(tema.accents.act);
		expect(tema.ui.code).toBe(tema.syntax.markdownCode);
		expect(tema.ui.agent).toBe(tema.syntax.keyword);
		expect(tema.ui.tool).toBe(tema.syntax.type);
	});

	it("aceita override de ui vindo do tema do operador", () => {
		const dir = join(raiz, "state", "themes");
		writeFileSync(
			join(dir, "op.json"),
			JSON.stringify({
				id: "op",
				variant: "dark",
				background: "#0b0b0b",
				ui: { tableBorder: "#445566", link: "#00ffaa" },
			}),
		);
		recarregarTemasCustom();
		const tema = resolveTheme("op", DETECTADO);
		expect(tema.ui.tableBorder).toBe("#445566");
		expect(tema.ui.link).toBe("#00ffaa");
		// O que nao foi declarado continua derivado.
		expect(tema.ui.tableHeader).toBe(tema.accents.act);
	});
});
