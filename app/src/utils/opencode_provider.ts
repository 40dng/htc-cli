// language: TypeScript, file: src/utils/opencode_provider.ts, runtime: Bun, alvo: provider opencode (OpenCode Zen)
import { createServer } from "node:net";
import { readFileSync } from "node:fs";

// O provider `opencode` do @cline/llms nao usa baseUrl/apiKey: ele sobe um
// servidor opencode local (ai-sdk-provider-opencode-sdk) e manda o modelo como
// par providerID/modelID. Sem o prefixo do provedor o corpo da request vai sem
// `model` e o servidor cai no modelo default dele, que nao e o Zen — era isso
// que quebrava a conexao com a API. Aqui normalizamos o id e fixamos uma porta
// dedicada para o CLI nao reutilizar um servidor opencode alheio (4096).

/** Provider id do OpenCode Zen dentro do servidor opencode. */
export const PROVEDOR_DO_ZEN = "opencode";

/** Porta dedicada do servidor opencode do CLI (evita a 4096 do usuario). */
export const PORTA_PADRAO_OPENCODE = 4098;

/** Modelo Zen usado quando nada foi configurado. Verificado em /zen/v1/models. */
export const MODELO_ZEN_PADRAO = "claude-sonnet-4-6";

/**
 * Credencial anonima do Zen. O opencode calcula
 * `p = Boolean(OPENCODE_API_KEY || conexaoAtiva || body.apiKey)` e:
 *   - se `p` for falso -> injeta `apiKey="public"` E desabilita todo modelo com
 *     `cost.input > 0` (so sobra free);
 *   - se `p` for verdadeiro -> retorna cedo, SEM filtro, com todos os modelos
 *     habilitados, mandando o valor resolvido como bearer.
 * Como o teste e veracidade pura, a string `public` conta como credencial: pula
 * o filtro (todos os modelos selecionaveis) e o upstream recebe o pseudo-key
 * anonimo, sem cobranca e sem registro de console.
 */
export const CHAVE_ANONIMA_DO_ZEN = "public";

export function eh_provedor_opencode(providerId: string | undefined): boolean {
	return providerId?.trim().toLowerCase() === PROVEDOR_DO_ZEN;
}

/**
 * Garante o formato `opencode/<modelo>` exigido pelo provider. Sem prefixo o
 * servidor opencode nao recebe `model` e ignora o Zen.
 */
export function normalizar_modelo_opencode(modelId: string | undefined): string {
	const limpo = modelId?.trim();
	if (!limpo) {
		return `${PROVEDOR_DO_ZEN}/${MODELO_ZEN_PADRAO}`;
	}
	if (limpo.includes("/")) {
		return limpo;
	}
	return `${PROVEDOR_DO_ZEN}/${limpo}`;
}

function porta_valida(valor: number | undefined): number | undefined {
	if (valor === undefined) return undefined;
	if (!Number.isInteger(valor) || valor < 1 || valor > 65535) return undefined;
	return valor;
}

/**
 * Procura uma porta TCP livre a partir de `inicial`. O servidor opencode e POR
 * INSTANCIA: duas CLIs rodando ao mesmo tempo no mesmo modelo apontavam para a
 * mesma porta fixa (4098) e compartilhavam/colidiam o servidor local, o que
 * derrubava uma das sessoes. Escolher uma porta livre por processo resolve isso.
 * `preferida` (env explicito do usuario) e tentada primeiro, mas se estiver
 * ocupada a proxima livre e usada, para nunca roubar/conflitar com outra CLI.
 */
export function escolher_porta_livre(
	preferida: number,
	tentativas = 64,
): Promise<number | undefined> {
	return new Promise((resolve) => {
		let tentada = 0;
		const tentar = (porta: number) => {
			if (tentada >= tentativas || porta > PRIMEIRA_PORTA_EFEMERA) {
				resolve(undefined);
				return;
			}
			tentada += 1;
			const servidor = createServer();
			servidor.unref();
			servidor.once("error", () => {
				servidor.close();
				tentar(porta + 1);
			});
			servidor.listen(porta, "127.0.0.1", () => {
				servidor.close(() => resolve(porta));
			});
		};
		tentar(preferida);
	});
}

/** Limite superior da faixa dedicada; acima disso preferimos pular para :0. */
const PRIMEIRA_PORTA_EFEMERA = 49152;

/** Amplitude do desvio por processo a partir da porta padrao (evita corrida). */
const FAIXA_DE_DESVIO_POR_PROCESSO = 1000;

/**
 * Publica a porta dedicada no ambiente lido pelo provider (HTC_OPENCODE_PORT,
 * honrada pelo patch em scripts/aplicar_patch_opencode.ts) e fixa a credencial
 * do Zen em `OPENCODE_API_KEY`.
 *
 * A porta: um env explicito (`HTC_OPENCODE_PORT`) tem prioridade; sem ele, o CLI
 * escolhe uma porta LIVRE por instancia (nao mais a constante 4098), para que
 * varias CLIs rodem em paralelo no mesmo modelo sem colidir no servidor local.
 *
 * A credencial: o provider `opencode` do @cline/llms ignora o apiKey das provider
 * settings, entao sincronizamos aqui para a settings virar fonte unica:
 *   - chave real preenchida -> usa a chave (modelos pagos, cobra);
 *   - chave vazia           -> usa `public`: todos os modelos selecionaveis
 *                              e o upstream trata como anonimo (sem cobranca).
 */
export async function preparar_ambiente_do_opencode(
	env: Record<string, string | undefined> = process.env,
	apiKey?: string,
): Promise<number> {
	if (apiKey !== undefined) {
		const chave = apiKey.trim();
		env.OPENCODE_API_KEY = chave || CHAVE_ANONIMA_DO_ZEN;
	}

	const explicita = porta_valida(
		Number.parseInt(env.HTC_OPENCODE_PORT?.trim() || "", 10) || undefined,
	);
	if (explicita !== undefined) {
		env.HTC_OPENCODE_PORT = String(explicita);
		return explicita;
	}

	// Semente por processo: instancias concorrentes nao disputam a MESMA porta de
	// partida. Sem isso, duas CLIs que sobem juntas poderiam sondar 4098 no mesmo
	// instante e uma perder a corrida para a outra.
	const semente =
		PORTA_PADRAO_OPENCODE + (process.pid % FAIXA_DE_DESVIO_POR_PROCESSO);
	const livre =
		(await escolher_porta_livre(semente)) ??
		(await escolher_porta_livre(PORTA_PADRAO_OPENCODE)) ??
		(await escolher_porta_livre(0));
	const porta = livre ?? PORTA_PADRAO_OPENCODE;
	env.HTC_OPENCODE_PORT = String(porta);
	return porta;
}

/** HTC_OPENCODE_PROXY: proxy unico. HTC_OPENCODE_PROXY_POOL: arquivo com 1 por linha. */
export const VARIAVEL_DE_PROXY = "HTC_OPENCODE_PROXY";
export const VARIAVEL_DE_POOL_DE_PROXY = "HTC_OPENCODE_PROXY_POOL";

/** Hosts que NUNCA podem passar pelo proxy: o CLI fala com o servidor local. */
const HOSTS_LOCAIS = ["127.0.0.1", "localhost", "::1"];

function juntar_sem_repetir(atual: string | undefined, extras: string[]): string {
	const vistos = new Set(
		(atual ?? "")
			.split(",")
			.map((parte) => parte.trim())
			.filter(Boolean),
	);
	for (const extra of extras) {
		vistos.add(extra);
	}
	return [...vistos].join(",");
}

/**
 * Escolhe o proxy de saida do servidor opencode. Um proxy explicito vence o pool;
 * no pool a escolha e aleatoria para variar o IP entre sessoes.
 */
export function escolher_proxy_do_opencode(
	env: Record<string, string | undefined> = process.env,
	lerArquivo: (caminho: string) => string = (caminho) =>
		readFileSync(caminho, "utf8"),
): string | undefined {
	const direto = env[VARIAVEL_DE_PROXY]?.trim();
	if (direto) {
		return direto;
	}
	const caminhoDoPool = env[VARIAVEL_DE_POOL_DE_PROXY]?.trim();
	if (!caminhoDoPool) {
		return undefined;
	}
	try {
		const linhas = lerArquivo(caminhoDoPool)
			.split(/\r?\n/)
			.map((linha) => linha.trim())
			.filter((linha) => linha && !linha.startsWith("#"));
		if (linhas.length === 0) {
			return undefined;
		}
		return linhas[Math.floor(Math.random() * linhas.length)];
	} catch {
		return undefined;
	}
}

/**
 * Aplica o proxy no ambiente herdado pelo servidor opencode. O runtime dele
 * (Bun) le `https_proxy/HTTPS_PROXY` e `http_proxy/HTTP_PROXY`; `no_proxy/NO_PROXY`
 * precisa cobrir o loopback, senao o proprio CLI -> servidor local passaria pelo
 * proxy.
 */
export function aplicar_proxy_no_ambiente(
	proxy: string | undefined,
	env: Record<string, string | undefined> = process.env,
): boolean {
	if (!proxy) {
		return false;
	}
	env.HTTPS_PROXY = proxy;
	env.HTTP_PROXY = proxy;
	env.NO_PROXY = juntar_sem_repetir(env.NO_PROXY, HOSTS_LOCAIS);
	return true;
}
