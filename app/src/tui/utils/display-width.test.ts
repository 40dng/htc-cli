import { describe, expect, it } from "vitest";
import { displayWidth, ELLIPSIS, padDisplay, truncateDisplay } from "./display-width";

describe("displayWidth", () => {
	it("conta acento como uma coluna", () => {
		expect(displayWidth("suíte")).toBe(5);
		expect(displayWidth("não")).toBe(3);
	});

	it("conta CJK e emoji como duas colunas", () => {
		expect(displayWidth("日本")).toBe(4);
		expect(displayWidth("✅")).toBe(2);
	});

	it("ignora combinantes e ZWJ", () => {
		expect(displayWidth("e\u0301")).toBe(1);
		expect(displayWidth("👨\u200d👩")).toBe(4);
	});

	it("string vazia nao ocupa coluna", () => {
		expect(displayWidth("")).toBe(0);
	});
});

describe("truncateDisplay", () => {
	it("nao mexe no que cabe", () => {
		expect(truncateDisplay("abc", 5)).toBe("abc");
	});

	it("corta com reticencias respeitando a largura", () => {
		const saida = truncateDisplay("abcdefgh", 5);
		expect(displayWidth(saida)).toBeLessThanOrEqual(5);
		expect(saida.endsWith(ELLIPSIS)).toBe(true);
	});

	it("respeita largura de caractere duplo", () => {
		const saida = truncateDisplay("日本語です", 5);
		expect(displayWidth(saida)).toBeLessThanOrEqual(5);
	});
});

describe("padDisplay", () => {
	it("completa ate a largura em colunas", () => {
		expect(displayWidth(padDisplay("日本", 10))).toBe(10);
		expect(padDisplay("abc", 6)).toBe("abc   ");
	});

	it("nao corta quando ja passou", () => {
		expect(padDisplay("abcdef", 3)).toBe("abcdef");
	});
});
