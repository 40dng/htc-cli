/**
 * HTC — preferencias locais (single source)
 *
 * ~/.htc/state/prefs.json
 *   free.*    : canais free locais — dsh e gemini (on por padrao)
 *   sidebar.* : widgets da barra lateral (on por padrao)
 *
 * A TUI (/settings), a CLI (`htc providers`) e a sidebar leem daqui.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CanalFree = "dsh" | "gemini";
export type WidgetSidebar = "maquina" | "sessao" | "operacao" | "agentes" | "free";

export interface Prefs {
	free: Record<CanalFree, boolean>;
	sidebar: Record<WidgetSidebar, boolean>;
	sidebarLargura: number;
}

export const WIDGETS_SIDEBAR: WidgetSidebar[] = [
	"maquina",
	"sessao",
	"operacao",
	"agentes",
	"free",
];
export const CANAIS_FREE: CanalFree[] = ["dsh", "gemini"];

const PADRAO: Prefs = {
	// Os dois unicos canais free sao loopback: dsh (our-free-model) e gemini
	// (free-gemini-api). Nascem ligados; quem nao estiver instalado aparece "n/a".
	free: { dsh: true, gemini: true },
	sidebar: { maquina: true, sessao: true, operacao: true, agentes: true, free: true },
	sidebarLargura: 42,
};

function dirEstado(): string {
	const base = process.env.HTC_STATE_DIR?.trim();
	return base ? join(base, "state") : join(homedir(), ".htc", "state");
}

export function caminhoPrefs(): string {
	const dir = dirEstado();
	mkdirSync(dir, { recursive: true });
	return join(dir, "prefs.json");
}

/** So os canais conhecidos entram: chave velha no disco (opencode/oneprovider) nao volta. */
function normalizarFree(bruto: Partial<Record<string, unknown>>): Record<CanalFree, boolean> {
	const saida = { ...PADRAO.free };
	for (const canal of CANAIS_FREE) {
		const valor = bruto[canal];
		if (typeof valor === "boolean") saida[canal] = valor;
	}
	return saida;
}

export function lerPrefs(): Prefs {
	const arquivo = caminhoPrefs();
	let bruto: Partial<Prefs> = {};
	if (existsSync(arquivo)) {
		try {
			bruto = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<Prefs>;
		} catch {
			bruto = {};
		}
	}
	return {
		free: normalizarFree(bruto.free ?? {}),
		sidebar: { ...PADRAO.sidebar, ...(bruto.sidebar ?? {}) },
		sidebarLargura:
			typeof bruto.sidebarLargura === "number" && bruto.sidebarLargura >= 28 && bruto.sidebarLargura <= 64
				? Math.round(bruto.sidebarLargura)
				: PADRAO.sidebarLargura,
	};
}

export function salvarPrefs(prefs: Prefs): Prefs {
	try {
		writeFileSync(caminhoPrefs(), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
	} catch {
		// sem escrita: devolve o que esta em memoria
	}
	return prefs;
}

export function alternarFree(canal: CanalFree): Prefs {
	const prefs = lerPrefs();
	prefs.free[canal] = !prefs.free[canal];
	return salvarPrefs(prefs);
}

export function definirFree(canal: CanalFree, ligado: boolean): Prefs {
	const prefs = lerPrefs();
	prefs.free[canal] = ligado;
	return salvarPrefs(prefs);
}

export function alternarWidget(widget: WidgetSidebar): Prefs {
	const prefs = lerPrefs();
	prefs.sidebar[widget] = !prefs.sidebar[widget];
	return salvarPrefs(prefs);
}

export function freeLigado(canal: CanalFree): boolean {
	return lerPrefs().free[canal] === true;
}

export function widgetLigado(widget: WidgetSidebar): boolean {
	return lerPrefs().sidebar[widget] === true;
}
