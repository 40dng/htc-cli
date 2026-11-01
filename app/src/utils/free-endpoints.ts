// language: TypeScript, file: src/utils/free-endpoints.ts, runtime: bun/node
// Canais free locais do HTC, descobertos em vez de configurados na mao.
//
// Dois upstreams OpenAI-compatíveis rodando em loopback:
//   dsh     — plugin dsh-our-free-model, que abre um forward OpenAI local e grava
//             porta/chave em DSH_HOME/our-free-model/*.json (OpenCode Zen e Kilo
//             por tras, sem conta nem key).
//   gemini  — servidor free-gemini-api (Go), OpenAI-compatible em :8001/v1,
//             modelos gemini-4-argon / argon-high / gemini-3.8-flash; a API key
//             e qualquer string.
//
// Ordem de precedencia: env explicito > dsh > gemini. O primeiro que responder
// `/models` com pelo menos um modelo vence — mudo nao entra.

import { descobrirDsh } from "./dsh";

export type CanalFreeId = "env" | "dsh" | "gemini";

export interface CandidatoFree {
	canal: CanalFreeId;
	base: string;
	key: string;
	origem: string;
}

export interface EndpointFreeVivo extends CandidatoFree {
	modelos: string[];
}

const GEMINI_PADRAO = "http://127.0.0.1:8001/v1";
const GEMINI_PORTAS_PADRAO = [8001, 8000, 8081];
export const MODELO_FREE_PADRAO = "gemini-4-argon";

function normalizar(base: string): string {
	return base.trim().replace(/\/+$/, "");
}

/** Candidatos na ordem em que devem ser tentados. */
export function candidatosFree(
	env: NodeJS.ProcessEnv = process.env,
): CandidatoFree[] {
	const lista: CandidatoFree[] = [];
	const baseEnv = env.HTC_FREE_BASE?.trim();
	if (baseEnv) {
		lista.push({
			canal: "env",
			base: normalizar(baseEnv),
			key: env.HTC_FREE_KEY?.trim() ?? "",
			origem: "HTC_FREE_BASE",
		});
	}
	const dsh = descobrirDsh();
	if (dsh) {
		lista.push({
			canal: "dsh",
			base: normalizar(dsh.base),
			key: dsh.key ?? "",
			origem: dsh.origem,
		});
	}
	const baseGemini =
		env.GEMINI_FREE_BASE?.trim() || env.HTC_GEMINI_BASE?.trim() || GEMINI_PADRAO;
	// Gemini de verdade: o endpoint OpenAI-compativel do Google. O canal era so
	// localhost (proxy que nao esta de pe) e o modelo `gemini-4-argon` nao existe
	// — por isso "os dois mudos". Com chave, o canal passa a falar com o Google.
	const chaveGoogle =
		env.GEMINI_API_KEY?.trim() ||
		env.GOOGLE_API_KEY?.trim() ||
		env.HTC_GEMINI_KEY?.trim() ||
		"";
	if (chaveGoogle) {
		lista.push({
			canal: "gemini",
			base: "https://generativelanguage.googleapis.com/v1beta/openai",
			key: chaveGoogle,
			origem: "google-generative-language (openai-compat)",
		});
	}
	const porta = Number.parseInt(
		new URL(normalizar(baseGemini)).port || "8001",
		10,
	);
	const chave = env.GEMINI_FREE_KEY?.trim() || env.HTC_GEMINI_KEY?.trim() || "free";
	const portas = Number.isFinite(porta)
		? [porta, ...GEMINI_PORTAS_PADRAO.filter((p) => p !== porta)]
		: GEMINI_PORTAS_PADRAO;
	for (const p of portas) {
		lista.push({
			canal: "gemini",
			base: `http://127.0.0.1:${p}/v1`,
			key: chave,
			origem: `free-gemini-api :${p}`,
		});
	}
	return lista;
}

function idsDeModelos(corpo: unknown): string[] {
	const dados = corpo as { data?: unknown; models?: unknown };
	const bruto = Array.isArray(dados?.data)
		? dados.data
		: Array.isArray(dados?.models)
			? dados.models
			: [];
	return bruto
		.map((m) =>
			typeof m === "string"
				? m
				: ((m as { id?: string }).id ?? (m as { name?: string }).name),
		)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** GET {base}/models com teto de tempo; timeout nao e erro, e "mudo". */
export async function listarModelosDoCanal(
	candidato: CandidatoFree,
	timeoutMs = 2500,
): Promise<EndpointFreeVivo | undefined> {
	try {
		const resp = await fetch(`${candidato.base}/models`, {
			headers: candidato.key ? { authorization: `Bearer ${candidato.key}` } : {},
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!resp.ok) return undefined;
		const modelos = idsDeModelos(await resp.json());
		if (modelos.length === 0) return undefined;
		return { ...candidato, modelos };
	} catch {
		return undefined;
	}
}

/** Todos os candidatos que respondem agora (paralelo, ordem preservada). */
export async function sondarCanaisFree(
	env: NodeJS.ProcessEnv = process.env,
	timeoutMs = 2500,
): Promise<EndpointFreeVivo[]> {
	const candidatos = candidatosFree(env);
	const vivos = await Promise.all(
		candidatos.map((candidato) => listarModelosDoCanal(candidato, timeoutMs)),
	);
	// Dedup por base: dsh e gemini podem apontar para a mesma porta.
	const vistos = new Set<string>();
	const saida: EndpointFreeVivo[] = [];
	for (const vivo of vivos) {
		if (!vivo || vistos.has(vivo.base)) continue;
		vistos.add(vivo.base);
		saida.push(vivo);
	}
	return saida;
}

/**
 * Por que cada canal free esta fora do ar — em uma linha cada, sem silencio.
 *
 * `descobrirDsh()` devolve `undefined` quando o plugin nao esta instalado, e o
 * canal simplesmente nao aparece na lista: parece que "nao existe", quando na
 * verdade esta mal instalado. Isto nomeia o motivo.
 */
export function diagnosticoFree(env: NodeJS.ProcessEnv = process.env): string[] {
	const linhas: string[] = [];
	if (env.HTC_FREE_BASE?.trim()) {
		linhas.push(`env: OK ${env.HTC_FREE_BASE.trim()} (HTC_FREE_BASE — canal proprio, nao e dsh nem gemini)`);
	}
	const dsh = descobrirDsh();
	linhas.push(
		dsh
			? `dsh: OK ${dsh.base} (${dsh.origem})`
			: "dsh: AUSENTE — nenhum our-free-model/*.json em DSH_HOME, ~/.dsh, AppData\\Roaming\\dsh, AppData\\Local\\dsh, ~/.config\\dsh (instale o plugin ou remova o canal)",
	);
	const chave =
		env.GEMINI_API_KEY?.trim() ||
		env.GOOGLE_API_KEY?.trim() ||
		env.HTC_GEMINI_KEY?.trim() ||
		"";
	linhas.push(
		chave
			? "gemini: OK chave presente -> https://generativelanguage.googleapis.com/v1beta/openai"
			: "gemini: SEM CHAVE — defina GEMINI_API_KEY; sem ela so tenta 127.0.0.1:8001/8000/8081 (proxy local)",
	);
	return linhas;
}

/** O primeiro canal vivo na ordem de precedencia (env > dsh > gemini). */
export async function escolherCanalFree(
	env: NodeJS.ProcessEnv = process.env,
	timeoutMs = 2500,
): Promise<EndpointFreeVivo | undefined> {
	return (await sondarCanaisFree(env, timeoutMs))[0];
}
