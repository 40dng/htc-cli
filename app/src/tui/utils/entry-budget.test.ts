import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types";
import { MAX_BUFFERED_BYTES, MAX_BUFFERED_LINES } from "../types";
import { cortar_entradas, entrada_tamanho_bytes } from "./entry-budget";

function texto(n: number): ChatEntry {
	return { kind: "assistant_text", text: "a".repeat(n), streaming: false };
}

describe("cortar_entradas", () => {
	it("keeps the newest MAX_BUFFERED_LINES entries", () => {
		const entries = Array.from({ length: MAX_BUFFERED_LINES + 25 }, (_, i) =>
			texto(i),
		);
		const out = cortar_entradas(entries);
		expect(out.length).toBe(MAX_BUFFERED_LINES);
		expect((out[0] as { text: string }).text.length).toBe(25);
	});

	it("drops the oldest entries once the byte budget is exceeded", () => {
		const big = Math.ceil(MAX_BUFFERED_BYTES / 4) + 1024;
		const entries = [texto(big), texto(big), texto(big), texto(big), texto(big)];
		const out = cortar_entradas(entries);
		expect(out.length).toBeLessThan(entries.length);
		expect(out.at(-1)).toBe(entries.at(-1));
	});

	it("keeps at least the last entry even if it alone exceeds the budget", () => {
		const out = cortar_entradas([texto(1), texto(MAX_BUFFERED_BYTES + 1024)]);
		expect(out.length).toBe(1);
		expect((out[0] as { text: string }).text.length).toBe(
			MAX_BUFFERED_BYTES + 1024,
		);
	});

	it("measures only the text-bearing fields", () => {
		expect(entrada_tamanho_bytes(texto(10))).toBe(10);
		expect(entrada_tamanho_bytes({ kind: "done", tokens: 1, cost: 0, elapsed: "1s", iterations: 1 })).toBe(0);
	});
});
