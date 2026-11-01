import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criar_batimento, escrever_heartbeat, ler_heartbeat } from "./heartbeat";

const dirs: string[] = [];

function dirTemporario(): string {
	const dir = mkdtempSync(join(tmpdir(), "htc-hb-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("heartbeat", () => {
	it("round-trips state and reports a small age", () => {
		const caminho = join(dirTemporario(), "hb.json");
		escrever_heartbeat(caminho, {
			v: 1,
			pid: 123,
			seq: 1,
			atualizado_ms: Date.now(),
			fase: "tool_start",
			ferramenta: "run_commands",
			risco: "high",
		});
		const leitura = ler_heartbeat(caminho);
		expect(leitura?.estado.fase).toBe("tool_start");
		expect(leitura?.estado.ferramenta).toBe("run_commands");
		expect(leitura?.idade_ms).toBeGreaterThanOrEqual(0);
		expect(leitura?.idade_ms).toBeLessThan(2_000);
	});

	it("returns undefined once the beat is stopped (file removed)", () => {
		const caminho = join(dirTemporario(), "hb.json");
		const batimento = criar_batimento({ caminho, intervalo_ms: 10_000 });
		expect(ler_heartbeat(caminho)).toBeDefined();
		batimento.parar();
		expect(ler_heartbeat(caminho)).toBeUndefined();
	});

	it("reports an old age for a stale file", () => {
		const caminho = join(dirTemporario(), "hb.json");
		escrever_heartbeat(caminho, {
			v: 1,
			pid: 1,
			seq: 1,
			atualizado_ms: Date.now() - 60_000,
			fase: "tool_start",
		});
		expect(ler_heartbeat(caminho)?.idade_ms).toBeGreaterThanOrEqual(59_000);
	});
});
