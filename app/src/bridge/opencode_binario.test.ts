import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	caminhos_opencode,
	erro_de_binario,
	pacote_de_plataforma,
	resolver_binario_opencode,
} from "./opencode_binario";

const EXE = process.platform === "win32" ? "opencode.exe" : "opencode";
const NPM_GLOBAL = join(
	homedir(),
	"AppData",
	"Roaming",
	"npm",
	"node_modules",
	"opencode-ai",
);

describe("binario do opencode", () => {
	test("pacote de plataforma segue o nome publicado pelo opencode-ai", () => {
		const so =
			process.platform === "win32"
				? "windows"
				: process.platform === "darwin"
					? "darwin"
					: "linux";
		const arq = process.arch === "arm64" ? "arm64" : "x64";
		expect(pacote_de_plataforma()).toBe(`opencode-${so}-${arq}`);
	});

	test("cobre o layout novo (subpacote de plataforma) e o antigo", () => {
		const caminhos = caminhos_opencode();
		const plataforma = pacote_de_plataforma();
		// Regressao que quebrou o `rae opencode`: o exe saiu do pacote raiz.
		expect(caminhos).toContain(join(NPM_GLOBAL, "node_modules", plataforma, "bin", EXE));
		expect(caminhos).toContain(
			join(NPM_GLOBAL, "node_modules", `${plataforma}-baseline`, "bin", EXE),
		);
		expect(caminhos).toContain(join(NPM_GLOBAL, "bin", EXE));
		expect(caminhos).toContain(join(homedir(), ".opencode", "bin", EXE));
	});

	test("HTC_OPENCODE_BIN e autoritativo, mesmo sem o arquivo existir", () => {
		const alvo = join(homedir(), "nao-existe-em-disco", EXE);
		expect(resolver_binario_opencode({ HTC_OPENCODE_BIN: alvo })).toBe(alvo);
	});

	test("sem candidato no disco devolve o nome puro (busca no PATH)", () => {
		const resolvido = resolver_binario_opencode({});
		expect(typeof resolvido).toBe("string");
		expect(resolvido.length).toBeGreaterThan(0);
	});

	test("ENOENT vira a lista de caminhos procurados", () => {
		const erro = Object.assign(new Error(`spawn ${EXE} ENOENT`), { code: "ENOENT" });
		const texto = erro_de_binario(erro);
		expect(texto).toContain("nao encontrado");
		expect(texto).toContain("HTC_OPENCODE_BIN");
		expect(texto).toContain(pacote_de_plataforma());
	});

	test("erro que nao e ENOENT passa intacto", () => {
		expect(erro_de_binario(new Error("acesso negado"))).toBe("acesso negado");
	});
});
