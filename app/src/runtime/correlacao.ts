// language: TypeScript, file: src/runtime/correlacao.ts, runtime: bun/node
/**
 * Correlacao — a PARTE MECANICA. O julgamento e do modelo.
 *
 * A tentacao era escrever uma tabela de regras (`wso2 -> CVE-2022-29464`,
 * peso 10, ...) e pontuar o corpus com regex. Isso e um script imitando
 * raciocinio: nao le a evidencia inteira, nao pesquisa CVE nova, nao percebe
 * que dois achados descrevem o mesmo componente com nomes diferentes, e
 * envelhece na primeira semana.
 *
 * O que sobra para o codigo e o que o modelo nao faz bem: varrer o disco,
 * atribuir cada achado ao host certo, deduplicar, e montar um digest legivel
 * que caiba num prompt. O resto — o que se repete, o que isso significa, qual
 * CVE se aplica, qual teste prova — vai para o turno, com websearch.
 *
 * Entrada : ~/.htc/state/missao*.json
 * Saida   : ~/.htc/ops/corpus.md (para o turno) + corpus.json (para diff)
 *
 * Atribuicao e POR ACHADO: um `missao.json` antigo tem 91 achados de hosts
 * diferentes e o campo `alvo` aponta para o ultimo host trabalhado. O host sai
 * do texto da evidencia; o campo do arquivo e so fallback.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AchadoDeLane {
	/** Host atribuido ao achado (extraido da evidencia; fallback: alvo do arquivo). */
	host: string;
	/**
	 * Outros hosts que a MESMA evidencia cita. Sao pistas, nao atribuicao: o
	 * regex escolhe o primeiro por ordem de forma (URL, host:porta, IP, dominio)
	 * e essa ordem nao sabe qual host o achado descreve. Quem decide e o turno
	 * de correlacao, lendo o digest — aqui a lista so impede que o host real
	 * desapareca do corpus.
	 */
	pistas?: string[];
	fonte: string;
	fase: string;
	titulo: string;
	evidencia: string;
	validado: boolean;
	criado: string;
}

export interface Corpus {
	achados: AchadoDeLane[];
	hosts: string[];
	porHost: { host: string; achados: number; validados: number }[];
}

/** Extensoes que parecem TLD mas sao arquivo: `amf.clean.json` nao e host. */
const NAO_E_TLD = new Set([
	"json", "js", "mjs", "cjs", "ts", "tsx", "md", "txt", "log", "html", "htm", "php",
	"asp", "aspx", "jsp", "do", "action", "yaml", "yml", "xml", "conf", "ini", "bak",
	"csv", "zip", "tar", "gz", "exe", "dll", "so", "py", "sh", "bat", "ps1", "png",
	"jpg", "jpeg", "gif", "css", "woff", "woff2", "map", "pem", "crt", "key", "p12",
	"ico", "svg", "pdf", "docx", "xlsx", "sql", "db", "env", "lock", "properties",
	"java", "class", "jar", "war", "amf", "swf", "min", "local", "test", "spec",
]);

/**
 * TLDs que existem. Fora desta lista, `json.stringify` e `amf.clean.json` nao
 * viram host. Hostname interno sem TLD real entra quando aparece em URL ou com
 * porta — o que o texto mediu, nao o que o regex sonhou.
 */
const TLDS = new Set([
	"br", "com", "net", "org", "io", "dev", "pub", "app", "cloud", "co", "us", "uk",
	"pt", "ar", "me", "sh", "xyz", "tech", "info", "gov", "edu", "mil", "online",
	"site", "store", "bank", "finance", "corp", "lan", "internal", "local", "rs",
	"in", "de", "fr", "nl", "ca", "au", "jp", "cn", "ru", "ch", "it", "es", "se",
	"no", "fi", "dk", "pl", "cz", "tr", "mx", "cl", "pe", "uy", "py", "bo", "ec",
	"ve", "ao", "mz", "cv", "gq", "sv", "gt", "hn", "ni", "pa", "do", "cr", "bz",
	"ai", "eu", "tv", "cc", "ws", "fm", "gg", "to", "ly", "id", "sg", "hk", "kr",
]);

const RE_URL = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,24})\b/gi;
const RE_IPV4 = /\b(?!0\.)(?!127\.)(?:\d{1,3}\.){3}\d{1,3}\b/g;
const RE_DOMINIO = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
/** `host:porta` — a forma como hostname interno aparece sem TLD real. */
const RE_HOST_PORTA = /\b([a-z0-9][a-z0-9.-]{2,80}):(\d{2,5})\b/gi;

function ipValido(ip: string): boolean {
	const partes = ip.split(".").map(Number);
	return partes.length === 4 && partes.every((n) => n >= 0 && n <= 255);
}

/**
 * Hosts citados numa evidencia. Ordem de preferencia: URL, `host:porta`, IPv4,
 * dominio com TLD real. Sem julgamento sobre o que o host e — so o que o texto
 * nomeia.
 */
export function hostsDaEvidencia(texto: string): string[] {
	const bruto = texto ?? "";
	const achados = new Set<string>();
	for (const m of bruto.matchAll(RE_URL)) {
		const host = (m[1] ?? "").toLowerCase().replace(/^www\./, "");
		if (host) achados.add(host);
	}
	for (const m of bruto.matchAll(RE_HOST_PORTA)) {
		const host = (m[1] ?? "").toLowerCase().replace(/^www\./, "");
		const tld = host.split(".").pop() ?? "";
		if (!host.includes(".") || NAO_E_TLD.has(tld)) continue;
		// loopback e relay local nao sao alvo: `SOCKS 127.0.0.1:1080`
		if (/^(?:127|0)\./.test(host)) continue;
		achados.add(host);
	}
	for (const m of bruto.matchAll(RE_IPV4)) {
		if (ipValido(m[0])) achados.add(m[0]);
	}
	for (const m of bruto.matchAll(RE_DOMINIO)) {
		const host = m[0].toLowerCase().replace(/^www\./, "");
		const tld = host.split(".").pop() ?? "";
		if (!TLDS.has(tld)) continue;
		achados.add(host);
	}
	return [...achados];
}

/** `https://Host.BR/x` -> `host.br`; vazio quando nao ha host no campo. */
export function normalizarAlvo(alvo: string): string {
	const bruto = (alvo ?? "").trim().toLowerCase();
	if (!bruto) return "";
	const semEsquema = bruto.replace(/^[a-z]+:\/\//, "");
	const host = semEsquema.split("/")[0].split("@").pop() ?? "";
	const semPorta = host.replace(/:\d+$/, "");
	return semPorta.replace(/^www\./, "");
}

function dirEstado(env: NodeJS.ProcessEnv): string {
	return join(env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc"), "state");
}

/**
 * Missoes legiveis: `missao.json`, `missao.<lane>.json` e os snapshots
 * `.bak`/`.corrupt-*`. O backup e historia — contem achados que a missao viva
 * ja rotacionou, e o corpus so vale se pegar tudo. Duplicata e resolvida por
 * (host + titulo) na carga.
 */
export function arquivosDeMissao(env: NodeJS.ProcessEnv = process.env): string[] {
	const dir = dirEstado(env);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((nome) => /^missao(\.[\w-]+)?\.json(\.(bak|corrupt)[\w.-]*)?$/.test(nome))
		.map((nome) => join(dir, nome));
}

export function carregarCorpus(env: NodeJS.ProcessEnv = process.env): Corpus {
	const achados: AchadoDeLane[] = [];
	const vistos = new Map<string, AchadoDeLane>();
	for (const caminho of arquivosDeMissao(env)) {
		let missao: {
			alvo?: string;
			achados?: {
				fase?: string;
				titulo?: string;
				evidencia?: string;
				validado?: boolean;
				criado?: string;
			}[];
		};
		try {
			missao = JSON.parse(readFileSync(caminho, "utf8"));
		} catch {
			continue;
		}
		const fallback = normalizarAlvo(missao.alvo ?? "");
		const fonte = caminho.split(/[\\/]/).pop() ?? caminho;
		for (const a of missao.achados ?? []) {
			const titulo = (a.titulo ?? "").trim();
			const evidencia = (a.evidencia ?? "").trim();
			if (!titulo && !evidencia) continue;
			const hosts = hostsDaEvidencia(`${titulo} ${evidencia}`);
			const host = hosts[0] ?? fallback;
			if (!host) continue;
			const pistas = hosts.slice(1).filter((outro) => outro !== host);
			// Snapshot e missao viva repetem o mesmo achado: vale um, e vale o
			// validado. Sem isso o corpus conta a mesma prova tres vezes.
			const chave = `${host}|${titulo.toLowerCase()}`;
			const anterior = vistos.get(chave);
			if (anterior) {
				if (!anterior.validado && a.validado === true) anterior.validado = true;
				continue;
			}
			const novo: AchadoDeLane = {
				host,
				...(pistas.length > 0 ? { pistas } : {}),
				fonte,
				fase: a.fase ?? "?",
				titulo,
				evidencia,
				validado: a.validado === true,
				criado: a.criado ?? "",
			};
			vistos.set(chave, novo);
			achados.push(novo);
		}
	}
	const porHost = new Map<string, { achados: number; validados: number }>();
	for (const a of achados) {
		const atual = porHost.get(a.host) ?? { achados: 0, validados: 0 };
		atual.achados += 1;
		if (a.validado) atual.validados += 1;
		porHost.set(a.host, atual);
	}
	const hosts = [...porHost.keys()].sort(
		(x, y) => (porHost.get(y)?.achados ?? 0) - (porHost.get(x)?.achados ?? 0) || x.localeCompare(y),
	);
	return {
		achados,
		hosts,
		porHost: hosts.map((host) => ({ host, ...(porHost.get(host) ?? { achados: 0, validados: 0 }) })),
	};
}


function truncar(texto: string, max: number): string {
	const limpo = texto.replace(/\s+/g, " ").trim();
	return limpo.length <= max ? limpo : `${limpo.slice(0, max)}…`;
}

/**
 * Hosts que aparecem em evidencia como FONTE DE FERRAMENTA, nao como alvo:
 * repositorio de codigo, CDN, registry. Medido no corpus real de 31/10 —
 * `raw.githubusercontent.com` entrou como pivo porque uma linha de evidencia
 * citava o repo de onde o binario veio. Pivo e alvo em potencial; fonte de
 * ferramenta nao.
 */
const FONTE_DE_FERRAMENTA = new Set([
	"raw.githubusercontent.com",
	"github.com",
	"gitee.com",
	"gitlab.com",
	"registry.npmjs.org",
	"unpkg.com",
	"cdn.jsdelivr.net",
	"pypi.org",
	"files.pythonhosted.org",
	"crates.io",
	"proxy.golang.org",
]);

/**
 * Hosts citados como PISTA e nunca trabalhados. R1: o alvo e indireto — o
 * fornecedor que aparece de lado na evidencia e alvo de primeira classe, nao
 * anexo. A contagem e quantos achados citam o host; dois ou mais e relacao de
 * confianca medida, nao coincidencia de texto.
 */
export function pivosDoCorpus(corpus: Corpus): Array<{ host: string; achados: number }> {
	const trabalhados = new Set(corpus.hosts);
	const contagem = new Map<string, number>();
	for (const a of corpus.achados) {
		for (const pista of a.pistas ?? []) {
			const host = normalizarAlvo(pista);
			if (!host || trabalhados.has(host) || FONTE_DE_FERRAMENTA.has(host)) continue;
			contagem.set(host, (contagem.get(host) ?? 0) + 1);
		}
	}
	return [...contagem.entries()]
		.map(([host, achados]) => ({ host, achados }))
		.sort((x, y) => y.achados - x.achados || x.host.localeCompare(y.host));
}

/** Digest legivel: um bloco por host, cada achado numa linha. Cabe em prompt. */
export function digestDoCorpus(corpus: Corpus): string {
	const linhas: string[] = [
		`# Corpus — ${corpus.achados.length} achados em ${corpus.hosts.length} hosts`,
		"",
	];
	for (const { host, achados, validados } of corpus.porHost) {
		linhas.push(`## ${host} (${achados} achados, ${validados} validados)`);
		for (const a of corpus.achados.filter((x) => x.host === host)) {
			const marca = a.validado ? "V" : "-";
			const pistas =
				a.pistas && a.pistas.length > 0
					? ` (tambem citados: ${a.pistas.slice(0, 4).join(", ")})`
					: "";
			linhas.push(
				`- [${marca}] ${a.fase}: ${truncar(a.titulo, 160)} — ${truncar(a.evidencia, 400)}${pistas}`,
			);
		}
		linhas.push("");
	}
	// Os pivos so valem se agregados: o mesmo host citado em seis achados e o
	// fornecedor que a bancada ja atravessou sem nomear, e a linha por achado
	// esconde isso.
	const pivos = pivosDoCorpus(corpus);
	if (pivos.length > 0) {
		linhas.push(`## Pivos — ${pivos.length} host(s) citados como pista, nunca trabalhados`);
		for (const pivo of pivos.slice(0, 12)) {
			linhas.push(`- ${pivo.host} — em ${pivo.achados} achado(s)`);
		}
		linhas.push("");
	}
	return linhas.join("\n");
}

/**
 * O turno de correlacao. Nao ha tabela de CVE aqui de proposito: quem sabe qual
 * CVE vale para qual versao e a pesquisa, nao uma constante no repositorio.
 */
export function briefDeCorrelacao(corpus: Corpus): string {
	return [
		"## Correlacao do corpus — raciocinio, nao script",
		"",
		`Voce tem ${corpus.achados.length} achados de ${corpus.hosts.length} hosts ja trabalhados. Leia o digest inteiro antes de responder.`,
		"",
		"O que fazer, nesta ordem:",
		"1. Agrupe por COMPONENTE, nao por texto. `APIkit console` e `ib/amf.clean.json` sao o mesmo gateway; `Server: BaseHTTP/0.6 Python/3.10.12` e um servidor de teste, nao um produto.",
		"2. Conte prevalencia: quantos HOSTS distintos carregam cada componente. Um componente em um host e curiosidade; em cinco e caminho.",
		"3. Para cada componente com prevalencia >= 2, pesquise (fetch_web_content / websearch) a CVE ATUAL da versao medida. Sem versao medida, o passo e descobrir a versao, nao chutar CVE.",
		"4. Ranqueie por (hosts alcancados x exploravel sem credencial). Desempate por: ja existe sessao/token aberto naquele host.",
		"5. Para os 3 primeiros, escreva o teste que PROVA: metodo, caminho, corpo, o que a resposta deve conter. Sem 'talvez', sem spray.",
		"",
		"Antes do ranking: a secao `## Pivos` lista hosts citados como pista em achados e nunca trabalhados. Um pivo com 2+ achados e a relacao de confianca que a bancada ja mediu (R1: quem entra no banco e o fornecedor) — ele entra no ranking como alvo de primeira classe, nao como anexo.",
		"",
		"Regras:",
		"- CVE citada tem que vir da pesquisa desta sessao, com o id e a versao afetada na evidencia. CVE de memoria nao entra.",
		"- Achado e fato medido; candidato e hipotese. Registre o fato com `htc missao achado` e o candidato como nao-validado ate a prova.",
		"- Se o corpus nao sustenta nenhum RCE, diga isso e nomeie o que falta medir. Inventar cadeia e pior que nao ter.",
		"",
		"Grave o resultado em `ops/correlacao.md`: tabela componente -> hosts -> CVE pesquisada -> teste que prova.",
	].join("\n");
}

export function gravarCorpus(
	env: NodeJS.ProcessEnv = process.env,
): { md: string; json: string; corpus: Corpus } {
	const corpus = carregarCorpus(env);
	const raiz = env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc");
	const dir = join(raiz, "ops");
	mkdirSync(dir, { recursive: true });
	const md = join(dir, "corpus.md");
	const json = join(dir, "corpus.json");
	writeFileSync(md, `${digestDoCorpus(corpus)}\n\n${briefDeCorrelacao(corpus)}\n`, "utf8");
	writeFileSync(json, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
	return { md, json, corpus };
}
