import { describe, expect, it } from "vitest";
import { getTerminalTheme, themePalette } from "./palette";

describe("getTerminalTheme", () => {
	it("detects light terminals from the default background", () => {
		expect(getTerminalTheme("#ffffff")).toBe("light");
		expect(getTerminalTheme("#fdf6e3")).toBe("light");
	});

	it("detects dark terminals from the default background", () => {
		expect(getTerminalTheme("#000000")).toBe("dark");
		expect(getTerminalTheme("#002b36")).toBe("dark");
	});

	it("uses the foreground as a fallback when background is unavailable", () => {
		expect(getTerminalTheme(null, "#1a1a1a")).toBe("light");
		expect(getTerminalTheme(null, "#f0f0f0")).toBe("dark");
	});

	it("defaults to the existing dark theme when detection is unavailable", () => {
		expect(getTerminalTheme(null, null)).toBe("dark");
	});
});

describe("theme-aware palette helpers", () => {
	it("uses the brand accent colors for dark terminals", () => {
		// Marca HTC (vermelho japones CB1B45). Este teste acompanha a marca:
		// trocar a cor do README/logo exige atualizar os tres valores abaixo.
		expect(themePalette.dark.act).toBe("#CB1B45");
		expect(themePalette.dark.plan).toBe("#E4597A");
		expect(themePalette.dark.success).toBe("#4CC38A");
	});

	it("uses darker accents on light terminals", () => {
		expect(themePalette.light.act).toBe("#8E1330");
		expect(themePalette.light.plan).toBe("#B03050");
		expect(themePalette.light.success).toBe("#0F7A4F");
	});
});
