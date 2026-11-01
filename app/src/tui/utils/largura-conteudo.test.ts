import { describe, expect, it } from "vitest";
import { GUTTER_CONTEUDO, larguraConteudo, SIDEBAR_LARGURA, sidebarVisivel } from "./largura-conteudo";

describe("sidebarVisivel", () => {
	it("liga so em terminal largo", () => {
		expect(sidebarVisivel(100, {})).toBe(false);
		expect(sidebarVisivel(120, {})).toBe(true);
	});

	it("HTC_SIDEBAR manda", () => {
		expect(sidebarVisivel(80, { HTC_SIDEBAR: "1" })).toBe(true);
		expect(sidebarVisivel(200, { HTC_SIDEBAR: "0" })).toBe(false);
	});
});

describe("larguraConteudo", () => {
	it("desconta a sidebar quando ela aparece", () => {
		expect(larguraConteudo(120, {})).toBe(120 - SIDEBAR_LARGURA - GUTTER_CONTEUDO);
	});

	it("sem sidebar, so o gutter", () => {
		expect(larguraConteudo(100, {})).toBe(100 - GUTTER_CONTEUDO);
	});

	it("nunca desce abaixo do minimo", () => {
		expect(larguraConteudo(10, { HTC_SIDEBAR: "1" })).toBeGreaterThanOrEqual(24);
	});
});
