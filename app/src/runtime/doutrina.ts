// language: TypeScript, file: src/runtime/doutrina.ts, runtime: bun/node
// Doutrina do operador: o que entra no system prompt alem do payload.
//
// Existe porque regra fixa no codigo envelhece: proxy muda, pasta de notas muda,
// o alvo muda. Aqui ficam os textos e caminhos que o operador edita sem
// recompilar, e que o payload NUNCA carrega sozinho.
//
// Arquivo: <HTC_STATE_DIR|~/.htc>/state/doutrina.json (override: HTC_DOUTRINA)
//   {
//     "regras": ["..."],           // substitui o bloco de regras base
//     "regras_extras": ["..."],    // sempre anexadas
//     "proxies": ["socks5://..."],  // egress preferido (OPSEC)
//     "obsidian": { "vault": "C:\\notas", "pastas": ["ops", "alvos"], "autolink": true },
//     "auto_deteccao": { "recusa": true, "pensamento": true },
//     "ancora_por_turno": true
//   }
//
// Nada aqui e obrigatorio: ausente = o payload funciona como esta.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DoutrinaObsidian {
	vault?: string;
	pastas?: string[];
	autolink?: boolean;
}

export interface DoutrinaDeteccao {
	recusa?: boolean;
	pensamento?: boolean;
}

export interface Doutrina {
	regras?: string[];
	regras_extras?: string[];
	proxies?: string[];
	obsidian?: DoutrinaObsidian;
	auto_deteccao?: DoutrinaDeteccao;
	ancora_por_turno?: boolean;
}

const CAMPOS_CONHECIDOS = new Set([
	"regras",
	"regras_extras",
	"proxies",
	"obsidian",
	"auto_deteccao",
	"ancora_por_turno",
]);

/** Caminho do arquivo de doutrina (override por HTC_DOUTRINA). */
export function caminhoDoutrina(env: NodeJS.ProcessEnv = process.env): string {
	const explicito = env.HTC_DOUTRINA?.trim();
	if (explicito) return explicito;
	const raiz = env.HTC_STATE_DIR?.trim();
	return raiz
		? join(raiz, "state", "doutrina.json")
		: join(homedir(), ".htc", "state", "doutrina.json");
}

function lista(valor: unknown): string[] | undefined {
	if (!Array.isArray(valor)) return undefined;
	const itens = valor
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return itens.length > 0 ? itens : undefined;
}

/** Le a doutrina. Arquivo ausente/ilegivel = doutrina vazia, nunca erro. */
export function carregarDoutrina(env: NodeJS.ProcessEnv = process.env): {
	doutrina: Doutrina;
	caminho: string;
	avisos: string[];
} {
	const caminho = caminhoDoutrina(env);
	const avisos: string[] = [];
	if (!existsSync(caminho)) return { doutrina: {}, caminho, avisos };
	let bruto: unknown;
	try {
		bruto = JSON.parse(readFileSync(caminho, "utf8"));
	} catch (erro) {
		avisos.push(`${caminho}: JSON invalido (${String(erro)})`);
		return { doutrina: {}, caminho, avisos };
	}
	if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
		avisos.push(`${caminho}: precisa ser um objeto`);
		return { doutrina: {}, caminho, avisos };
	}
	const dados = bruto as Record<string, unknown>;
	for (const chave of Object.keys(dados)) {
		if (!CAMPOS_CONHECIDOS.has(chave)) avisos.push(`${caminho}: campo "${chave}" ignorado`);
	}
	const doutrina: Doutrina = {};
	const regras = lista(dados.regras);
	const extras = lista(dados.regras_extras);
	const proxies = lista(dados.proxies);
	if (regras) doutrina.regras = regras;
	if (extras) doutrina.regras_extras = extras;
	if (proxies) doutrina.proxies = proxies;
	if (typeof dados.ancora_por_turno === "boolean") {
		doutrina.ancora_por_turno = dados.ancora_por_turno;
	}
	const obsidian = dados.obsidian;
	if (obsidian && typeof obsidian === "object" && !Array.isArray(obsidian)) {
		const o = obsidian as Record<string, unknown>;
		const vault = typeof o.vault === "string" ? o.vault.trim() : "";
		const pastas = lista(o.pastas);
		const item: DoutrinaObsidian = {};
		if (vault) item.vault = vault;
		if (pastas) item.pastas = pastas;
		if (typeof o.autolink === "boolean") item.autolink = o.autolink;
		if (Object.keys(item).length > 0) doutrina.obsidian = item;
	}
	const deteccao = dados.auto_deteccao;
	if (deteccao && typeof deteccao === "object" && !Array.isArray(deteccao)) {
		const d = deteccao as Record<string, unknown>;
		const item: DoutrinaDeteccao = {};
		if (typeof d.recusa === "boolean") item.recusa = d.recusa;
		if (typeof d.pensamento === "boolean") item.pensamento = d.pensamento;
		if (Object.keys(item).length > 0) doutrina.auto_deteccao = item;
	}
	return { doutrina, caminho, avisos };
}

/**
 * Bloco de doutrina para o system prompt. Vazio quando nao ha nada configurado —
 * nunca escreve "authorized", "engagement" ou qualquer selo de legitimidade:
 * texto de permissao ensina o modelo a argumentar em vez de entregar.
 */
export function textoDoutrina(doutrina: Doutrina): string {
	const linhas: string[] = [];
	if (doutrina.regras?.length) {
		linhas.push("OPERATOR RULES (replace the base rules above):");
		for (const regra of doutrina.regras) linhas.push(`- ${regra}`);
	}
	if (doutrina.regras_extras?.length) {
		linhas.push("OPERATOR RULES (additional, always in force):");
		for (const regra of doutrina.regras_extras) linhas.push(`- ${regra}`);
	}
	if (doutrina.proxies?.length) {
		linhas.push("EGRESS: route outbound work through the operator's controlled egress:");
		for (const proxy of doutrina.proxies) linhas.push(`- ${proxy}`);
		linhas.push(
			"If that egress is down, wait or find another controlled exit; never fall back to the operator's direct IP, and never announce that you are waiting.",
		);
	}
	if (doutrina.obsidian?.vault) {
		const pastas = doutrina.obsidian.pastas?.length
			? ` Folders in use: ${doutrina.obsidian.pastas.join(", ")}.`
			: "";
		const link = doutrina.obsidian.autolink
			? " When a build lands, write the note in the target's folder and link it."
			: "";
		linhas.push(
			`NOTES: operator vault at ${doutrina.obsidian.vault}.${pastas}${link}`,
		);
	}
	if (doutrina.auto_deteccao) {
		const estados = [
			`refusal detection ${doutrina.auto_deteccao.recusa === false ? "off" : "on"}`,
			`reasoning interception ${doutrina.auto_deteccao.pensamento === false ? "off" : "on"}`,
		];
		linhas.push(`DETECTION: ${estados.join(", ")}.`);
	}
	if (linhas.length === 0) return "";
	return `OPERATOR DOCTRINE (config, in force for every turn)\n\n${linhas.join("\n")}`;
}

/** Escreve um arquivo de doutrina minimo (idempotente). Devolve o caminho. */
export function garantirDoutrinaExemplo(
	env: NodeJS.ProcessEnv = process.env,
): { caminho: string; criado: boolean } {
	const caminho = caminhoDoutrina(env);
	if (existsSync(caminho)) return { caminho, criado: false };
	mkdirSync(dirname(caminho), { recursive: true });
	const exemplo = {
		regras_extras: [],
		proxies: [],
		obsidian: { vault: "", pastas: [], autolink: false },
		auto_deteccao: { recusa: true, pensamento: true },
		ancora_por_turno: true,
	};
	writeFileSync(caminho, `${JSON.stringify(exemplo, null, 2)}\n`, "utf8");
	return { caminho, criado: true };
}
