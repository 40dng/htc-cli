import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BASE_PADRAO,
	caminhoSlots,
	chaveMascarada,
	definirSlot,
	idDoSlot,
	lerSlot,
	listarSlots,
	MODELO_PADRAO,
	QTD_SLOTS,
} from "./slots";

let raiz = "";
let anterior: string | undefined;

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-slots-"));
	anterior = process.env.CLINE_DIR;
	process.env.CLINE_DIR = raiz;
});

afterEach(() => {
	if (anterior === undefined) delete process.env.CLINE_DIR;
	else process.env.CLINE_DIR = anterior;
	rmSync(raiz, { recursive: true, force: true });
});

describe("slots de credencial", () => {
	it("cada slot tem provider proprio", () => {
		expect(idDoSlot(1)).toBe("go-slot-1");
		expect(idDoSlot(4)).toBe("go-slot-4");
		expect(QTD_SLOTS).toBe(4);
		expect(listarSlots()).toHaveLength(QTD_SLOTS);
	});

	it("slot vazio vem com o default do Go e sem chave", () => {
		const slot = lerSlot(2);
		expect(slot.apiKey).toBe("");
		expect(slot.modelo).toBe(MODELO_PADRAO);
		expect(slot.baseUrl).toBe(BASE_PADRAO);
	});

	it("grava chave e modelo sem tocar nos outros slots", () => {
		definirSlot(2, { apiKey: "oc_sk_dois" });
		definirSlot(2, { modelo: "deepseek-v4-pro" });
		expect(lerSlot(1).apiKey).toBe("");
		expect(lerSlot(2)).toMatchObject({
			apiKey: "oc_sk_dois",
			modelo: "deepseek-v4-pro",
		});
		expect(lerSlot(3).apiKey).toBe("");
	});

	it("persiste no disco sem BOM", () => {
		definirSlot(1, { apiKey: "oc_sk_um" });
		const bruto = readFileSync(caminhoSlots(), "utf8");
		expect(bruto.charCodeAt(0)).not.toBe(0xfeff);
		expect(JSON.parse(bruto).slots["1"].apiKey).toBe("oc_sk_um");
	});

	it("mascara a chave em log", () => {
		expect(chaveMascarada("")).toBe("(sem chave)");
		expect(chaveMascarada("oc_sk_9c00c86d2e43_resto")).toBe("oc_sk_9c00…(24)");
	});
});
