// language: TypeScript, file: src/tui/themes-custom.ts, runtime: bun/node
// Temas do operador, sem recompilar nada.
//
// Um JSON por tema em:
//   <HTC_STATE_DIR|~/.htc>/state/themes/*.json
// (ou um unico `theme.json` na mesma pasta). Formato: o mesmo ThemeDefinition
// do codigo — id, label, description, variant, background, foreground e os
// blocos opcionais accents / syntax / diff / ui.
//
//   {
//     "id": "meu-tema",
//     "label": "Meu Tema",
//     "variant": "dark",
//     "background": "#101014",
//     "foreground": "#e6e6ea",
//     "accents": { "act": "#ff3366", "plan": "#ffcc66" },
//     "ui": { "tableBorder": "#444444", "tableHeader": "#ff3366" }
//   }
//
// Qualquer chave invalida e ignorada (com aviso), o tema continua carregando:
// um arquivo malformado nao pode derrubar a TUI.

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TemaCustom {
	id: string;
	label: string;
	description: string;
	variant: "dark" | "light" | "auto";
	background: string | null;
	foreground: string | null;
	accents?: Record<string, string>;
	syntax?: Record<string, string>;
	diff?: Record<string, string>;
	ui?: Record<string, string>;
}

export const CHAVES_ACCENTS = ["act", "plan", "success", "error"] as const;
export const CHAVES_UI = [
	"text",
	"strong",
	"muted",
	"border",
	"heading",
	"link",
	"bullet",
	"code",
	"tableBorder",
	"tableHeader",
	"warn",
	"info",
	"error",
	"success",
	"user",
	"agent",
	"tool",
	"path",
] as const;
export const CHAVES_SYNTAX = [
	"keyword",
	"operator",
	"type",
	"functionName",
	"variable",
	"string",
	"number",
	"comment",
	"punctuation",
	"property",
	"constant",
	"tag",
	"attribute",
	"escape",
	"markdownCode",
	"markdownMuted",
	"markdownItalic",
	"markdownDefault",
] as const;
export const CHAVES_DIFF = [
	"addedBg",
	"removedBg",
	"addedLineNumberBg",
	"removedLineNumberBg",
	"addedSignColor",
	"removedSignColor",
	"lineNumberFg",
] as const;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

function cor(valor: unknown): string | undefined {
	if (typeof valor !== "string") return undefined;
	const bruto = valor.trim();
	if (HEX6.test(bruto)) return bruto.toLowerCase();
	if (HEX3.test(bruto)) {
		return `#${bruto[1]}${bruto[1]}${bruto[2]}${bruto[2]}${bruto[3]}${bruto[3]}`.toLowerCase();
	}
	return undefined;
}

function bloco(
	valor: unknown,
	chaves: readonly string[],
	avisos: string[],
	origem: string,
): Record<string, string> | undefined {
	if (!valor || typeof valor !== "object" || Array.isArray(valor)) return undefined;
	const saida: Record<string, string> = {};
	for (const chave of chaves) {
		const bruto = (valor as Record<string, unknown>)[chave];
		if (bruto === undefined) continue;
		const normalizada = cor(bruto);
		if (!normalizada) {
			avisos.push(`${origem}: ${chave} nao e cor hex (#rrggbb) — ignorado`);
			continue;
		}
		saida[chave] = normalizada;
	}
	return Object.keys(saida).length > 0 ? saida : undefined;
}

function slug(valor: string): string {
	return valor
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Pasta de temas do operador (criada por quem escreve o tema). */
export function diretorioDeTemas(env: NodeJS.ProcessEnv = process.env): string {
	const raiz = env.HTC_STATE_DIR?.trim();
	return raiz
		? join(raiz, "state", "themes")
		: join(homedir(), ".htc", "state", "themes");
}

function interpretar(
	bruto: unknown,
	origem: string,
	avisos: string[],
): TemaCustom | undefined {
	if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
		avisos.push(`${origem}: nao e um objeto de tema`);
		return undefined;
	}
	const dados = bruto as Record<string, unknown>;
	const id = typeof dados.id === "string" && dados.id.trim() ? slug(dados.id) : "";
	if (!id) {
		avisos.push(`${origem}: sem "id" — ignorado`);
		return undefined;
	}
	const variant =
		dados.variant === "light" || dados.variant === "auto" || dados.variant === "dark"
			? dados.variant
			: "dark";
	const tema: TemaCustom = {
		id,
		label:
			typeof dados.label === "string" && dados.label.trim()
				? dados.label.trim()
				: id,
		description:
			typeof dados.description === "string" && dados.description.trim()
				? dados.description.trim()
				: "Tema do operador",
		variant,
		background:
			dados.background === null || dados.background === undefined
				? null
				: (cor(dados.background) ?? null),
		foreground:
			dados.foreground === null || dados.foreground === undefined
				? null
				: (cor(dados.foreground) ?? null),
	};
	const accents = bloco(dados.accents, CHAVES_ACCENTS, avisos, origem);
	const syntax = bloco(dados.syntax, CHAVES_SYNTAX, avisos, origem);
	const diff = bloco(dados.diff, CHAVES_DIFF, avisos, origem);
	const ui = bloco(dados.ui, CHAVES_UI, avisos, origem);
	if (accents) tema.accents = accents;
	if (syntax) tema.syntax = syntax;
	if (diff) tema.diff = diff;
	if (ui) tema.ui = ui;
	return tema;
}

interface CacheTemas {
	assinatura: string;
	temas: TemaCustom[];
	avisos: string[];
}

let cache: CacheTemas | undefined;

function assinaturaDaPasta(dir: string): string {
	try {
		const itens = readdirSync(dir).filter((nome) => nome.toLowerCase().endsWith(".json"));
		return itens
			.sort()
			.map((nome) => {
				try {
					const info = statSync(join(dir, nome));
					return `${nome}:${info.mtimeMs}:${info.size}`;
				} catch {
					return `${nome}:?`;
				}
			})
			.join("|");
	} catch {
		return "";
	}
}

/**
 * Le os temas do operador. Cache invalidado quando a pasta muda (mtime/size de
 * cada arquivo), entao editar o JSON e reabrir a TUI ja pega a versao nova.
 */
export function lerTemasCustom(dir: string = diretorioDeTemas()): {
	temas: TemaCustom[];
	avisos: string[];
} {
	const assinatura = assinaturaDaPasta(dir);
	if (cache && cache.assinatura === assinatura) {
		return { temas: cache.temas, avisos: cache.avisos };
	}
	const avisos: string[] = [];
	const temas: TemaCustom[] = [];
	if (dir && existsSync(dir)) {
		for (const nome of readdirSync(dir)) {
			if (!nome.toLowerCase().endsWith(".json")) continue;
			const caminho = join(dir, nome);
			let dados: unknown;
			try {
				dados = JSON.parse(readFileSync(caminho, "utf8"));
			} catch (erro) {
				avisos.push(`${nome}: JSON invalido (${String(erro)})`);
				continue;
			}
			// Aceita um tema por arquivo ou { "themes": [...] }.
			const lista =
				dados && typeof dados === "object" && !Array.isArray(dados) && "themes" in dados
					? (dados as { themes: unknown }).themes
					: [dados];
			if (!Array.isArray(lista)) {
				avisos.push(`${nome}: "themes" precisa ser uma lista`);
				continue;
			}
			for (const item of lista) {
				const tema = interpretar(item, nome, avisos);
				if (tema) temas.push(tema);
			}
		}
	}
	cache = { assinatura, temas, avisos };
	return { temas, avisos };
}

/** Limpa o cache (testes e recarga a quente). */
export function recarregarTemasCustom(): void {
	cache = undefined;
}

/** Remove um tema do operador. Id embutido e protegido (nao esta na pasta). */
export function apagarTemaCustom(id: string, dir: string = diretorioDeTemas()): boolean {
	const alvo = join(dir, `${id}.json`);
	if (!existsSync(alvo)) return false;
	try {
		rmSync(alvo, { force: true });
		recarregarTemasCustom();
		return true;
	} catch {
		return false;
	}
}

/**
 * Exporta o tema para um arquivo compartilhavel (`<id>.theme.json`) na pasta
 * pedida (default: cwd). O conteudo e o JSON cru do tema, entao quem receber so
 * precisa jogar em `~/.htc/state/themes/` — ou usar a importacao do /theme.
 */
export function exportarTemaCustom(
	id: string,
	destino: string = process.cwd(),
	dir: string = diretorioDeTemas(),
): string | undefined {
	const origem = join(dir, `${id}.json`);
	if (!existsSync(origem)) return undefined;
	try {
		const caminho = join(destino, `${id}.theme.json`);
		copyFileSync(origem, caminho);
		return caminho;
	} catch {
		return undefined;
	}
}

/**
 * Importa `*.theme.json` de uma pasta para a pasta de temas. Ids que colidem com
 * tema existente ganham sufixo (nunca sobrescreve o que ja esta em uso).
 */
export function importarTemasCustom(
	origem: string = process.cwd(),
	dir: string = diretorioDeTemas(),
): { importados: string[]; avisos: string[] } {
	const avisos: string[] = [];
	const importados: string[] = [];
	let arquivos: string[] = [];
	try {
		arquivos = readdirSync(origem).filter((nome) =>
			nome.toLowerCase().endsWith(".theme.json"),
		);
	} catch (erro) {
		return { importados, avisos: [`${origem}: ${String(erro)}`] };
	}
	if (arquivos.length === 0) return { importados, avisos: ["nenhum *.theme.json na pasta"] };
	try {
		mkdirSync(dir, { recursive: true });
	} catch (erro) {
		return { importados, avisos: [`${dir}: ${String(erro)}`] };
	}
	const usados = new Set(lerTemasCustom(dir).temas.map((tema) => tema.id));
	for (const nome of arquivos) {
		const caminho = join(origem, nome);
		let tema: TemaCustom | undefined;
		try {
			const bruto = JSON.parse(readFileSync(caminho, "utf8")) as unknown;
			tema = interpretar(bruto, nome, avisos);
		} catch (erro) {
			avisos.push(`${nome}: ${String(erro)}`);
			continue;
		}
		if (!tema) continue;
		const id = usados.has(tema.id) ? idLivre(dir, `${tema.id}-import`, usados) : tema.id;
		usados.add(id);
		try {
			writeFileSync(
				join(dir, `${id}.json`),
				`${JSON.stringify({ ...tema, id }, null, 2)}\n`,
				"utf8",
			);
			importados.push(id);
		} catch (erro) {
			avisos.push(`${nome}: ${String(erro)}`);
		}
	}
	recarregarTemasCustom();
	return { importados, avisos };
}


function idLivre(dir: string, base: string, usados: Set<string>): string {
	let id = base;
	let n = 2;
	while (usados.has(id) || existsSync(join(dir, `${id}.json`))) {
		id = `${base}-${n}`;
		n += 1;
	}
	return id;
}

/**
 * Cria um tema do operador a partir de um modelo (normalmente o tema ATIVO, para
 * o operador editar em cima do que ja gosta). O arquivo nasce com o formato
 * completo, entao nao ha o que adivinhar: abre, troca hex, reabre o HTC.
 */
export function criarTemaCustom(input: {
	base: Omit<TemaCustom, "id" | "label" | "description"> & {
		label?: string;
		description?: string;
	};
	dir?: string;
}): { id: string; caminho: string } | undefined {
	const dir = input.dir ?? diretorioDeTemas();
	try {
		mkdirSync(dir, { recursive: true });
		const usados = new Set(lerTemasCustom(dir).temas.map((t) => t.id));
		const id = idLivre(dir, "custom", usados);
		const arquivo = {
			id,
			label: input.base.label?.trim() || "Meu tema",
			description:
				input.base.description?.trim() ||
				"Edite este arquivo e reabra o HTC para ver",
			variant: input.base.variant,
			background: input.base.background,
			foreground: input.base.foreground,
			...(input.base.accents ? { accents: input.base.accents } : {}),
			...(input.base.syntax ? { syntax: input.base.syntax } : {}),
			...(input.base.diff ? { diff: input.base.diff } : {}),
			...(input.base.ui ? { ui: input.base.ui } : {}),
		};
		const caminho = join(dir, `${id}.json`);
		writeFileSync(caminho, `${JSON.stringify(arquivo, null, 2)}\n`, "utf8");
		recarregarTemasCustom();
		return { id, caminho };
	} catch {
		return undefined;
	}
}

