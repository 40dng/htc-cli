// language: TypeScript, file: src/runtime/task-id.test.ts, runtime: Bun
import { describe, expect, it } from "vitest";
import {
	decodificar_id,
	gerar_id_tarefa,
	prefixo_de,
	tipo_do_prefixo,
	type TipoTarefa,
} from "./task-id";

const TIPOS: TipoTarefa[] = [
	"local_bash",
	"local_agent",
	"remote_agent",
	"in_process_teammate",
	"local_workflow",
	"monitor_mcp",
	"dream",
];

describe("id de tarefa", () => {
	it("cada tipo tem prefixo proprio e o mapa fecha nos dois sentidos", () => {
		const vistos = new Set<string>();
		for (const t of TIPOS) {
			const p = prefixo_de(t);
			expect(p).toHaveLength(1);
			expect(vistos.has(p)).toBe(false);
			vistos.add(p);
			expect(tipo_do_prefixo(p)).toBe(t);
		}
	});

	it("id tem 9 chars: prefixo + 8 do alfabeto", () => {
		const id = gerar_id_tarefa("local_agent");
		expect(id).toHaveLength(9);
		expect(id[0]).toBe("a");
		expect(id.slice(1)).toMatch(/^[0-9a-z]{8}$/);
	});

	it("dois ids do mesmo tipo nao coincidem", () => {
		const a = gerar_id_tarefa("local_bash");
		const b = gerar_id_tarefa("local_bash");
		expect(a).not.toBe(b);
	});

	it("decodifica de volta o tipo", () => {
		const id = gerar_id_tarefa("in_process_teammate");
		const d = decodificar_id(id);
		expect(d?.tipo).toBe("in_process_teammate");
		expect(d?.corpo).toHaveLength(8);
	});

	it("formato invalido devolve undefined em vez de lancar", () => {
		expect(decodificar_id("")).toBeUndefined();
		expect(decodificar_id("a123")).toBeUndefined();
		expect(decodificar_id("z00000000")).toBeUndefined();
		expect(decodificar_id("a1234567!")).toBeUndefined();
	});

	it("aceita fonte deterministica de bytes", () => {
		const id = gerar_id_tarefa("dream", (n) => new Uint8Array(n).fill(1));
		expect(id).toBe("d" + "1".repeat(8));
	});
});
