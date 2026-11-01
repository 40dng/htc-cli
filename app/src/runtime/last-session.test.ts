import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	caminhoUltimaSessao,
	lerUltimaSessao,
	marcarUltimaSessao,
} from "./last-session";

let raiz = "";
let anterior: string | undefined;

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-last-"));
	mkdirSync(join(raiz, "state"), { recursive: true });
	anterior = process.env.HTC_STATE_DIR;
	process.env.HTC_STATE_DIR = raiz;
});

afterEach(() => {
	if (anterior === undefined) delete process.env.HTC_STATE_DIR;
	else process.env.HTC_STATE_DIR = anterior;
	rmSync(raiz, { recursive: true, force: true });
});

describe("ultima sessao", () => {
	it("grava e le o que o atualizador precisa", () => {
		marcarUltimaSessao({
			sessionId: "abc123",
			cwd: "C:\\lab",
			provider: "htc-free",
			model: "argon-high",
		});
		const lido = lerUltimaSessao();
		expect(lido?.sessionId).toBe("abc123");
		expect(lido?.provider).toBe("htc-free");
		expect(lido?.model).toBe("argon-high");
		expect(lido?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("arquivo ausente ou invalido devolve undefined", () => {
		expect(lerUltimaSessao()).toBeUndefined();
		writeFileSync(caminhoUltimaSessao(), "{ quebrado", "utf8");
		expect(lerUltimaSessao()).toBeUndefined();
		writeFileSync(caminhoUltimaSessao(), JSON.stringify({ sessionId: "  " }), "utf8");
		expect(lerUltimaSessao()).toBeUndefined();
	});
});
