// language: TypeScript, file: src/utils/free-boot.ts, runtime: bun/node
/**
 * HTC — sobe os canais free junto com o HTC.
 *
 * Os dois canais locais sao processos externos (dsh-our-free-model e
 * free-gemini-api). Antes o operador precisava subir cada um na mao antes de
 * abrir o HTC; aqui o boot faz isso, na ordem, e so espera pelo que ele mesmo
 * iniciou.
 *
 * Regras:
 *   - canal desligado em prefs.free nao e tocado;
 *   - canal que ja responde `/models` nao e reiniciado (nunca duplica processo);
 *   - comando vem de HTC_DSH_CMD / HTC_GEMINI_CMD, senao de
 *     `state/free-cmd.json`, senao do PATH (`free-gemini-api`, `dsh`);
 *   - sem comando, o canal fica `sem-comando` — nada de mentir que subiu.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type CandidatoFree,
	type EndpointFreeVivo,
	candidatosFree,
	listarModelosDoCanal,
} from "./free-endpoints";
import { lerPrefs } from "./prefs";

export type CanalBoot = "dsh" | "gemini";

export interface ResultadoBoot {
	canal: CanalBoot;
	estado: "desligado" | "ja-vivo" | "subiu" | "sem-comando" | "falhou";
	base?: string;
	comando?: string;
	erro?: string;
}

const CANAIS: CanalBoot[] = ["dsh", "gemini"];

/** Binarios procurados no PATH, na ordem. */
const BINARIOS: Record<CanalBoot, string[]> = {
	dsh: ["dsh.cmd", "dsh.exe", "dsh.bat"],
	gemini: [
		"free-gemini-api.exe",
		"free-gemini-api.cmd",
		"gemini-free.exe",
		"free-gemini.exe",
	],
};

const VARIAVEL: Record<CanalBoot, string> = {
	dsh: "HTC_DSH_CMD",
	gemini: "HTC_GEMINI_CMD",
};

const SONDA_MS = 900;
const ESPERA_MS = 7000;
const PASSO_MS = 250;

let emVoo: Promise<ResultadoBoot[]> | undefined;

function dirEstado(): string {
	const base = process.env.HTC_STATE_DIR?.trim();
	return base ? join(base, "state") : join(homedir(), ".htc", "state");
}

function arquivoComandos(): string {
	return join(dirEstado(), "free-cmd.json");
}

/** Comando configurado no disco (`state/free-cmd.json`), se houver. */
function comandoPersistido(canal: CanalBoot): string {
	const arquivo = arquivoComandos();
	if (!existsSync(arquivo)) return "";
	try {
		const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as Record<string, unknown>;
		const valor = bruto[canal];
		return typeof valor === "string" ? valor.trim() : "";
	} catch {
		return "";
	}
}

/** Binario conhecido andando no PATH. */
function comandoNoPath(canal: CanalBoot): string {
	const caminhos = (process.env.PATH ?? "").split(";").filter(Boolean);
	for (const nome of BINARIOS[canal]) {
		for (const dir of caminhos) {
			const candidato = join(dir.replace(/^"|"$/g, ""), nome);
			if (existsSync(candidato)) return `"${candidato}"`;
		}
	}
	return "";
}

/** env > free-cmd.json > PATH. Vazio significa "nao sei subir este canal". */
export function comandoDoCanal(canal: CanalBoot): string {
	return (
		process.env[VARIAVEL[canal]]?.trim() ||
		comandoPersistido(canal) ||
		comandoNoPath(canal)
	);
}

function candidatosDoCanal(canal: CanalBoot): CandidatoFree[] {
	return candidatosFree().filter((c) => c.canal === canal);
}

/** Endpoint do canal que responde agora, se houver. */
async function vivo(
	canal: CanalBoot,
	timeoutMs = SONDA_MS,
): Promise<EndpointFreeVivo | undefined> {
	for (const candidato of candidatosDoCanal(canal)) {
		const achado = await listarModelosDoCanal(candidato, timeoutMs);
		if (achado) return achado;
	}
	return undefined;
}

function abrirLog(canal: CanalBoot): string {
	const dir = dirEstado();
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		// sem diretorio: o redirect falha e o spawn cai no erro abaixo
	}
	return join(dir, `free-${canal}.log`);
}

async function esperarSubir(canal: CanalBoot): Promise<CandidatoFree | undefined> {
	const limite = Date.now() + ESPERA_MS;
	while (Date.now() < limite) {
		const achado = await vivo(canal, SONDA_MS);
		if (achado) return achado;
		await new Promise((resolve) => setTimeout(resolve, PASSO_MS));
	}
	return undefined;
}

async function subirCanal(canal: CanalBoot): Promise<ResultadoBoot> {
	if (!lerPrefs().free[canal]) {
		return { canal, estado: "desligado" };
	}
	const ja = await vivo(canal);
	if (ja) return { canal, estado: "ja-vivo", base: ja.base };

	const comando = comandoDoCanal(canal);
	if (!comando) return { canal, estado: "sem-comando" };

	// O log vai por redirect do shell, nao por fd: passar o fd para o filho
	// prende o processo pai no Windows (o HTC nao sairia ao fim do run).
	const log = abrirLog(canal);
	try {
		const filho = spawn(`${comando} >> "${log}" 2>&1`, [], {
			shell: true,
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		filho.on("error", () => {
			// erro de spawn aparece no resultado abaixo (o endpoint nunca responde)
		});
		filho.unref();
	} catch (erro) {
		const msg = erro instanceof Error ? erro.message : String(erro);
		return { canal, estado: "falhou", comando, erro: msg };
	}

	const subiu = await esperarSubir(canal);
	if (subiu) return { canal, estado: "subiu", base: subiu.base, comando };
	return {
		canal,
		estado: "falhou",
		comando,
		erro: `nao respondeu /models em ${ESPERA_MS}ms`,
	};
}

/**
 * Sobe os canais free ligados. Idempotente: chamadas concorrentes (boot da CLI,
 * primeira render da sidebar) compartilham a mesma promessa.
 */
export function subirCanaisFree(): Promise<ResultadoBoot[]> {
	if (emVoo) return emVoo;
	emVoo = Promise.all(CANAIS.map((canal) => subirCanal(canal))).catch(() =>
		CANAIS.map((canal) => ({ canal, estado: "falhou" as const, erro: "falha inesperada" })),
	);
	return emVoo;
}

/** Solta o cache — proximo `subirCanaisFree` sonda de novo (usado em teste). */
export function esquecerBootFree(): void {
	emVoo = undefined;
}
