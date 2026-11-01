import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatosFree, sondarCanaisFree } from "./free-endpoints";

let raiz = "";
let servidor: { port: number; stop: (force?: boolean) => void } | undefined;

beforeEach(() => {
	raiz = mkdtempSync(join(tmpdir(), "htc-free-"));
	process.env.DSH_HOME = join(raiz, "dsh-vazio");
});

afterEach(() => {
	servidor?.stop(true);
	servidor = undefined;
	delete process.env.DSH_HOME;
	delete process.env.GEMINI_FREE_BASE;
	delete process.env.HTC_FREE_BASE;
	rmSync(raiz, { recursive: true, force: true });
});

describe("candidatosFree", () => {
	it("sem dsh e sem env, sobra o gemini em 8001", () => {
		const candidatos = candidatosFree({ DSH_HOME: process.env.DSH_HOME });
		expect(candidatos.every((c) => c.canal === "gemini")).toBe(true);
		expect(candidatos[0].base).toBe("http://127.0.0.1:8001/v1");
	});

	it("HTC_FREE_BASE tem precedencia e vira canal env", () => {
		const candidatos = candidatosFree({
			DSH_HOME: process.env.DSH_HOME,
			HTC_FREE_BASE: "http://127.0.0.1:9999/v1/",
			HTC_FREE_KEY: "abc",
		});
		expect(candidatos[0]).toMatchObject({
			canal: "env",
			base: "http://127.0.0.1:9999/v1",
			key: "abc",
		});
	});

	it("gemini aceita base alternativa", () => {
		const candidatos = candidatosFree({
			DSH_HOME: process.env.DSH_HOME,
			GEMINI_FREE_BASE: "http://127.0.0.1:8123/v1",
		});
		expect(candidatos[0].base).toBe("http://127.0.0.1:8123/v1");
		expect(candidatos[0].key).toBe("free");
	});
});

describe("sondarCanaisFree", () => {
	it("acha o servidor vivo e lista os modelos", async () => {
		const s = Bun.serve({
			port: 0,
			fetch(req) {
				if (new URL(req.url).pathname.endsWith("/models")) {
					return Response.json({ data: [{ id: "argon-high" }, { id: "gemini-3.8-flash" }] });
				}
				return new Response("no", { status: 404 });
			},
		});
		servidor = s as never;
		process.env.GEMINI_FREE_BASE = `http://127.0.0.1:${s.port}/v1`;
		const vivos = await sondarCanaisFree(process.env, 1200);
		expect(vivos.length).toBeGreaterThan(0);
		expect(vivos[0].canal).toBe("gemini");
		expect(vivos[0].modelos).toContain("argon-high");
	});

	it("servidor mudo nao entra na lista", async () => {
		process.env.GEMINI_FREE_BASE = "http://127.0.0.1:1/v1";
		const vivos = await sondarCanaisFree(process.env, 400);
		expect(vivos).toEqual([]);
	});
});
