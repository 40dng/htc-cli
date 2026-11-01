// language: TypeScript, file: src/utils/providers-sanidade.ts, runtime: bun/node
//
// Por que este arquivo existe (medido em 2026-10-31):
//
// `ProviderSettingsManager.saveProviderSettings(parcial)` do core NAO faz merge
// com a entrada que ja esta no disco: ele substitui `providers[id].settings`
// pelo objeto recebido e, por padrao, joga esse id em `lastUsedProvider`.
//
// Consequencia pratica: qualquer chamador que grave um settings parcial
// (`{provider, model, reasoning}`) apaga `apiKey`, `baseUrl`, `protocol`,
// `client`, `headers` e `auth` daquele provider. Foi isso que deixou o
// opencode-go sem chave e o HTC caindo no provedor default do core
// (`opencode` / `opencode/claude-fable-5-1`) na sessao de 31/10.
//
// Regra daqui pra frente: NUNCA chamar `saveProviderSettings` direto com um
// objeto montado na hora. Usar `salvarProviderPreservando`, que completa o
// objeto com os campos sensiveis que ja estavam gravados antes de gravar.

import {
	copyFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ProviderSettings, ProviderSettingsManager } from "@cline/core";

/**
 * Campos que identificam/acessam o provider. Se o objeto novo nao trouxer,
 * herda do que ja estava no disco. `model`/`reasoning` ficam de fora de
 * proposito: sao a escolha do operador e devem valer.
 */
const CAMPOS_PRESERVADOS = [
	"auth",
	"apiKey",
	"baseUrl",
	"protocol",
	"client",
	"headers",
	"aws",
	"azure",
	"region",
	"oauthAccountId",
] as const;

type Gerenciador = Pick<
	ProviderSettingsManager,
	"getProviderSettings" | "saveProviderSettings"
>;

/** Completa o settings novo com os campos sensiveis que existiam antes. */
export function preservarSegredos(
	anterior: ProviderSettings | undefined,
	novo: ProviderSettings,
): ProviderSettings {
	const saida: Record<string, unknown> = {
		...(novo as unknown as Record<string, unknown>),
	};
	if (anterior) {
		const velho = anterior as unknown as Record<string, unknown>;
		for (const campo of CAMPOS_PRESERVADOS) {
			if (saida[campo] === undefined && velho[campo] !== undefined) {
				saida[campo] = velho[campo];
			}
		}
	}
	return saida as unknown as ProviderSettings;
}

/**
 * Grava a escolha de provider/modelo **sem** perder credencial.
 * Le a entrada atual, completa o que faltar e so entao chama o core.
 */
export function salvarProviderPreservando(
	manager: Gerenciador,
	novo: ProviderSettings,
	opcoes?: { setLastUsed?: boolean },
): ProviderSettings {
	let anterior: ProviderSettings | undefined;
	try {
		anterior = manager.getProviderSettings(novo.provider);
	} catch {
		anterior = undefined;
	}
	const final = preservarSegredos(anterior, novo);
	// Chamada com um argumento so quando nao ha opcoes: mantem o contrato
	// drop-in em relacao a `saveProviderSettings(settings)`.
	if (opcoes) manager.saveProviderSettings(final, opcoes);
	else manager.saveProviderSettings(final);
	return final;
}

/**
 * `<raiz>/data/settings/providers.json` — layout do core.
 * A raiz vem do `setClineDir()` efetivo (`--config`, `prepararEstadoHtc()`),
 * porque ele guarda o diretorio em variavel de modulo e NAO em `CLINE_DIR`.
 */
export function caminhoProviders(raiz?: string): string {
	const base =
		raiz?.trim() || process.env.CLINE_DIR?.trim() || join(homedir(), ".htc");
	return join(base, "data", "settings", "providers.json");
}

interface EntradaProvider {
	settings?: Record<string, unknown>;
	updatedAt?: string;
	tokenSource?: string;
}

interface EstadoProviders {
	version?: number;
	lastUsedProvider?: string;
	modes?: Record<string, unknown>;
	providers?: Record<string, EntradaProvider>;
}

function lerEstado(caminho: string): EstadoProviders | undefined {
	try {
		// PowerShell 5.1 `Set-Content -Encoding UTF8` grava BOM e o `JSON.parse`
		// morre com "Unexpected token" — ja quebrou o HTC uma vez (31/10).
		const bruto = JSON.parse(readFileSync(caminho, "utf8").replace(/^\uFEFF/, "")) as unknown;
		if (!bruto || typeof bruto !== "object") return undefined;
		return bruto as EstadoProviders;
	} catch {
		return undefined;
	}
}

/** Backups conhecidos do arquivo, do mais novo para o mais antigo. */
function backupsDe(caminho: string): { caminho: string; estado: EstadoProviders }[] {
	const dir = dirname(caminho);
	const prefixo = `${basename(caminho)}.bak`;
	const achados: { caminho: string; estado: EstadoProviders }[] = [];
	try {
		const nomes = readdirSync(dir)
			.filter((nome) => nome.startsWith(prefixo))
			.map((nome) => join(dir, nome))
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
		for (const nome of nomes) {
			const estado = lerEstado(nome);
			if (estado?.providers) achados.push({ caminho: nome, estado });
		}
	} catch {
		// diretorio ilegivel: sem backup, sem reparo
	}
	return achados;
}

function temCredencial(entrada: EntradaProvider | undefined): boolean {
	const s = entrada?.settings ?? {};
	const auth = s.auth as { accessToken?: unknown } | undefined;
	return Boolean(
		(typeof s.apiKey === "string" && s.apiKey.trim()) ||
			(typeof auth?.accessToken === "string" && auth.accessToken.trim()) ||
			(typeof s.baseUrl === "string" && s.baseUrl.trim()),
	);
}

interface CatalogoModels {
	providers?: Record<
		string,
		{
			provider?: {
				baseUrl?: unknown;
				protocol?: unknown;
				client?: unknown;
			};
		}
	>;
}

/** Catalogo (`models.json`) do diretorio de settings, ou do ~/.cline legado. */
function lerCatalogo(dirSettings: string): CatalogoModels | undefined {
	const tentativas = [
		join(dirSettings, "models.json"),
		join(homedir(), ".cline", "data", "settings", "models.json"),
	];
	for (const caminho of tentativas) {
		try {
			const bruto = JSON.parse(readFileSync(caminho, "utf8")) as unknown;
			if (bruto && typeof bruto === "object") return bruto as CatalogoModels;
		} catch {
			// proximo candidato
		}
	}
	return undefined;
}

/**
 * Auto-reparo do `providers.json` antes do core ler: repoe campos sensiveis
 * ausentes a partir do backup mais recente que os tenha (e `baseUrl`/
 * `protocol`/`client` tambem do catalogo `models.json`) e, se o
 * `lastUsedProvider` aponta para um provider sem credencial, escolhe um que
 * tenha. Nunca cria provider que nao exista no arquivo atual, nunca apaga
 * provider, nunca sobrescreve backup. Devolve a lista de correcoes aplicadas
 * (vazia quando nada mudou).
 */
export function repararProvidersDoDisco(caminho = caminhoProviders()): string[] {
	const correcoes: string[] = [];
	const estado = lerEstado(caminho);
	if (!estado?.providers) return correcoes;

	const backups = backupsDe(caminho);
	const catalogo = lerCatalogo(dirname(caminho));

	for (const [id, entrada] of Object.entries(estado.providers)) {
		if (!entrada?.settings) continue;
		for (const campo of CAMPOS_PRESERVADOS) {
			if (entrada.settings[campo] !== undefined) continue;
			const origem = backups.find(
				(b) => b.estado.providers?.[id]?.settings?.[campo] !== undefined,
			);
			if (origem) {
				entrada.settings[campo] = origem.estado.providers?.[id]?.settings?.[campo];
				correcoes.push(
					`${id}.${campo} restaurado de ${basename(origem.caminho)}`,
				);
				continue;
			}
			const doCatalogo = catalogo?.providers?.[id]?.provider?.[
				campo as "baseUrl" | "protocol" | "client"
			];
			if (doCatalogo !== undefined) {
				entrada.settings[campo] = doCatalogo;
				correcoes.push(`${id}.${campo} restaurado do models.json`);
			}
		}
	}

	const usado = estado.lastUsedProvider?.trim();
	if (usado && !temCredencial(estado.providers[usado])) {
		const candidatos = Object.keys(estado.providers).filter((id) =>
			temCredencial(estado.providers?.[id]),
		);
		const escolhido =
			candidatos.find((id) => id === "opencode-go") ??
			candidatos.find((id) => id === "opencode") ??
			candidatos[0];
		if (escolhido) {
			estado.lastUsedProvider = escolhido;
			correcoes.push(`lastUsedProvider ${usado} -> ${escolhido}`);
		}
	}

	if (correcoes.length === 0) return correcoes;
	try {
		const seguro = `${caminho}.bak-restaurado`;
		if (!existsSync(seguro)) copyFileSync(caminho, seguro);
		estado.version ??= 1;
		estado.modes ??= {};
		writeFileSync(caminho, `${JSON.stringify(estado, null, 2)}\n`, "utf8");
	} catch {
		// sem escrita: a sessao segue com o que o core conseguiu ler
	}
	return correcoes;
}
