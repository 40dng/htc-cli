/**
 * dsh-our-free-model — descoberta do endpoint local.
 *
 * O plugin grava o estado em `DSH_HOME/our-free-model/` (porta do forward e a
 * chave do painel). Aqui a gente le esse diretorio e monta a base URL OpenAI,
 * sem depender de o operador copiar porta/chave na mao.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface EndpointFree {
	base: string;
	key?: string;
	origem: string;
}

function raizesDsh(): string[] {
	const raizes = [
		process.env.DSH_HOME?.trim(),
		join(homedir(), ".dsh"),
		join(homedir(), "AppData", "Roaming", "dsh"),
		join(homedir(), "AppData", "Local", "dsh"),
		join(homedir(), ".config", "dsh"),
	].filter((v): v is string => !!v);
	return raizes;
}

function extrair(objeto: unknown, profundidade = 0): { porta?: number; chave?: string } {
	if (!objeto || typeof objeto !== "object" || profundidade > 6) return {};
	const saida: { porta?: number; chave?: string } = {};
	for (const [chave, valor] of Object.entries(objeto as Record<string, unknown>)) {
		if (typeof valor === "number" && /port/i.test(chave) && valor >= 1024 && valor <= 65535) {
			saida.porta ??= valor;
		}
		if (typeof valor === "string") {
			if (/key|token/i.test(chave) && valor.length >= 16) saida.chave ??= valor;
			const comoNumero = Number.parseInt(valor, 10);
			if (/port/i.test(chave) && Number.isFinite(comoNumero) && comoNumero >= 1024) {
				saida.porta ??= comoNumero;
			}
		}
		if (typeof valor === "object") {
			const interno = extrair(valor, profundidade + 1);
			saida.porta ??= interno.porta;
			saida.chave ??= interno.chave;
		}
	}
	return saida;
}

export function descobrirDsh(): EndpointFree | undefined {
	for (const raiz of raizesDsh()) {
		const dir = join(raiz, "our-free-model");
		if (!existsSync(dir)) continue;
		let arquivos: string[] = [];
		try {
			arquivos = readdirSync(dir).filter((n) => n.endsWith(".json"));
		} catch {
			continue;
		}
		for (const nome of arquivos) {
			try {
				const bruto = readFileSync(join(dir, nome), "utf8");
				const { porta, chave } = extrair(JSON.parse(bruto));
				if (porta) {
					return {
						base: `http://127.0.0.1:${porta}/v1`,
						key: chave,
						origem: join(dir, nome),
					};
				}
			} catch {
				// arquivo em escrita: tenta o proximo
			}
		}
	}
	return undefined;
}
