// language: TypeScript, file: src/runtime/payload.ts, runtime: bun/node
// MOTOR DE PAYLOAD — impressao do alvo → classe → restricao → oraculo.
//
// O defeito que isto corrige: o modelo escolhia payload por preferencia. Contra
// um Tomcat ele mandava `cmd.php`; contra um IIS, `shell.jsp`. O artefato estava
// "pronto" e nao servia, e o turno morria com o operador achando que o alvo
// estava fechado.
//
// A regra aqui e a mesma de qualquer parser: o alvo decide. Uma linha medida —
// header `Server`, `X-Powered-By`, nome do cookie, rodape da pagina de erro,
// extensao na URL — seleciona a classe. Sem essa linha, nao ha classe: ha uma
// instrucao de medir.
//
// Cada classe carrega o que o payload ingenuo esquece:
//   limites  — extensao aceita, magic bytes, tamanho, privilegio, sandbox
//   oraculo  — como se prova que executou (sem isso o artefato e decoracao)
//   rastro   — o que fica no alvo e como sai
//
// Nada aqui inventa versao: o que nao foi medido entra como `<parametro>`.

export interface Impressao {
	servidor?: string;
	linguagem?: string;
	framework?: string;
	parser?: string;
	versao?: string;
	waf?: string;
	so?: string;
}

type CampoImpressao = keyof Impressao;

interface Requisito {
	campo: CampoImpressao;
	valores: readonly string[];
}

export interface ClassePayload {
	id: string;
	familia: "upload" | "lfi" | "rfi" | "deser" | "ssti" | "sqli" | "ssrf" | "manager";
	requer: readonly Requisito[];
	entrega: string;
	forma: string;
	limites: readonly string[];
	oraculo: string;
	rastro: string;
}

const RX_SERVIDOR: ReadonlyArray<readonly [string, RegExp]> = [
	["tomcat", /\btomcat(?:\/|\s)?(\d[\w.]*)?/i],
	["jetty", /\bjetty(?:\/|\s)?(\d[\w.]*)?/i],
	["wildfly", /\b(wildfly|jboss)(?:\/|\s)?(\d[\w.]*)?/i],
	["iis", /\biis(?:\/|\s)?(\d[\w.]*)?/i],
	["nginx", /\bnginx(?:\/|\s)?(\d[\w.]*)?/i],
	["apache", /\bapache(?:\/|\s)?(\d[\w.]*)?/i],
	["lighttpd", /\blighttpd(?:\/|\s)?(\d[\w.]*)?/i],
	["caddy", /\bcaddy\b/i],
	["express", /\bexpress(?:\/|\s)?(\d[\w.]*)?/i],
	["kestrel", /\bkestrel\b/i],
];

const RX_LINGUAGEM: ReadonlyArray<readonly [string, RegExp]> = [
	["java", /\b(java|jdk|jre|jsp|servlet|spring ?boot|spring)\b/i],
	["dotnet", /\b(asp\.?net|\.net|dotnet|aspx|ashx|c#)\b/i],
	["php", /\b(php|laravel|symfony|wordpress|drupal|joomla)\b/i],
	["node", /\b(node(?:\.js)?|express|next\.js|nuxt)\b/i],
	["python", /\b(python|django|flask|fastapi|werkzeug)\b/i],
	["ruby", /\b(ruby|rails|puma|passenger)\b/i],
];

const RX_FRAMEWORK: ReadonlyArray<readonly [string, RegExp]> = [
	["spring", /\bspring(?: ?boot)?\b/i],
	["laravel", /\blaravel\b/i],
	["next", /\bnext\.js\b/i],
	["django", /\bdjango\b/i],
	["rails", /\brails\b/i],
	["express", /\bexpress\b/i],
	["wordpress", /\bwordpress\b/i],
];

const RX_PARSER: ReadonlyArray<readonly [string, RegExp]> = [
	["multipart", /\b(multipart|upload|anexo|arquivo enviado|form-data)\b/i],
	["lfi", /\b(lfi|local file inclusion|path traversal|traversal|include)\b/i],
	["rfi", /\b(rfi|remote file inclusion|allow_url_include)\b/i],
	["deser", /\b(deserial|unserialize|ysoserial|gadget)\b/i],
	["ssti", /\b(ssti|template injection|jinja|twig|freemarker|handlebars)\b/i],
	["sqli", /\b(sqli|sql injection|union select|xp_cmdshell|into outfile)\b/i],
	["ssrf", /\b(ssrf|metadata|169\.254\.169\.254|imds)\b/i],
	["manager", /\b(manager|jmx|jolokia|actuator|console)\b/i],
	["xml", /\b(xxe|xml external|saxparser|documentbuilder)\b/i],
];

const RX_WAF: ReadonlyArray<readonly [string, RegExp]> = [
	["cloudflare", /\b(cloudflare|cf-ray)\b/i],
	["akamai", /\b(akamai|akamai-ghost)\b/i],
	["imperva", /\b(imperva|incapsula)\b/i],
	["f5", /\b(big-?ip|f5)\b/i],
	["modsecurity", /\b(mod_?security|owasp crs)\b/i],
	["aws", /\b(aws ?waf|awselb)\b/i],
];

function primeiro(
	tabela: ReadonlyArray<readonly [string, RegExp]>,
	texto: string,
): string | undefined {
	for (const [nome, padrao] of tabela) {
		if (padrao.test(texto)) return nome;
	}
	return undefined;
}

/** Versao so quando o texto a declara junto do produto (`nginx/1.24.0`). */
function versao_do_texto(texto: string): string | undefined {
	const achado = texto.match(
		/\b(?:nginx|apache|tomcat|jetty|iis|php|express|spring|laravel|node|jetty)[\/ ](\d+(?:\.\d+){1,3})/i,
	);
	return achado?.[1];
}

/**
 * Le a impressao do texto do turno e dos achados ja gravados. E deliberadamente
 * conservador: nome de produto com fronteira de palavra, nunca "parece Java".
 */
export function impressao_do_texto(texto: string): Impressao {
	const bruto = texto ?? "";
	const saida: Impressao = {};
	const servidor = primeiro(RX_SERVIDOR, bruto);
	if (servidor) saida.servidor = servidor;
	const linguagem = primeiro(RX_LINGUAGEM, bruto);
	if (linguagem) saida.linguagem = linguagem;
	const framework = primeiro(RX_FRAMEWORK, bruto);
	if (framework) saida.framework = framework;
	const parser = primeiro(RX_PARSER, bruto);
	if (parser) saida.parser = parser;
	const waf = primeiro(RX_WAF, bruto);
	if (waf) saida.waf = waf;
	const versao = versao_do_texto(bruto);
	if (versao) saida.versao = versao;
	if (/\b(windows|iis|win32|win64)\b/i.test(bruto)) saida.so = "windows";
	else if (/\b(linux|ubuntu|debian|centos|rhel|alpine)\b/i.test(bruto)) saida.so = "linux";
	// Container decide a linguagem quando o texto nao diz: Tomcat/Jetty/WildFly
	// so servem Java, IIS/Kestrel so servem .NET. E inferencia medida, nao chute
	// — e sem ela `jsp-upload` nunca casa e o modelo cai no manager por engano.
	if (!saida.linguagem) {
		if (servidor === "tomcat" || servidor === "jetty" || servidor === "wildfly") {
			saida.linguagem = "java";
		} else if (servidor === "iis" || servidor === "kestrel") {
			saida.linguagem = "dotnet";
		}
	}
	return saida;
}

export function impressao_vazia(impressao: Impressao): boolean {
	return Object.values(impressao).every((valor) => !valor);
}

export function descrever_impressao(impressao: Impressao): string {
	const partes = Object.entries(impressao)
		.filter(([, valor]) => Boolean(valor))
		.map(([campo, valor]) => `${campo}=${valor}`);
	return partes.length > 0 ? partes.join(" · ") : "not measured";
}

export const CLASSES: readonly ClassePayload[] = [
	{
		id: "php-upload",
		familia: "upload",
		requer: [{ campo: "linguagem", valores: ["php"] }],
		entrega: "execution as the web user, one request at a time",
		forma: "a PHP file written through the upload handler, then requested by path",
		limites: [
			"extension the handler accepts: read the form's whitelist before naming the file",
			"if getimagesize() runs, prefix GIF89a and put the tag after it — the header must stay valid",
			"size under upload_max_filesize and post_max_size; check phpinfo or the 413 body",
			"no closing tag — trailing whitespace after it is emitted and breaks later headers",
			"the target directory must be under the docroot; a 200 that shows the source means it did not execute",
		],
		oraculo:
			"GET the file with ?c=id and paste the uid line — a 200 with the source is a failure, not a win",
		rastro: "random 8-hex filename; deletion path recorded before the second request",
	},
	{
		id: "php-lfi-include",
		familia: "lfi",
		requer: [
			{ campo: "linguagem", valores: ["php"] },
			{ campo: "parser", valores: ["lfi"] },
		],
		entrega: "read of local files, or execution if a writable include exists",
		forma:
			"traversal to the log or to /proc/self/environ, or inclusion of an uploaded file",
		limites: [
			"open_basedir and the traversal depth are measured, not assumed: count the ../ until 200",
			"log poisoning needs the poisoned request in the same file the include reads, before rotation",
			"User-Agent is the cheapest carrier; keep it under the log line limit",
			"/proc/self/environ only when the process is readable by the web user",
		],
		oraculo: "a unique marker string comes back in the response body",
		rastro: "one marker per attempt; the marker names the request that wrote it",
	},
	{
		id: "jsp-upload",
		familia: "upload",
		requer: [
			{ campo: "linguagem", valores: ["java"] },
			{ campo: "servidor", valores: ["tomcat", "jetty", "wildfly"] },
		],
		entrega: "execution in the servlet container, full JVM on the classpath",
		forma: "a .jsp written to a deployed context, compiled on first request",
		limites: [
			"the context must be exploded, or the container must redeploy on write",
			"compile errors come back as a 500 with the stack — read it, it names the line",
			"the page import directive goes before any class use",
			"a write into a directory the container does not serve is an inert file",
		],
		oraculo: "GET the .jsp and paste the marker plus the runtime version it prints",
		rastro: "random context-safe name; remove the file and the compiled class under work/",
	},
	{
		id: "tomcat-manager",
		familia: "manager",
		requer: [{ campo: "servidor", valores: ["tomcat"] }],
		entrega: "WAR deployment, persistent execution",
		forma: "manager-script deploy from a URL, or a WAR written into webapps/",
		limites: [
			"role needed: manager-script for /text deploy, manager-gui only for the console",
			"deploy needs the WAR reachable from the target's filesystem or from a URL it can fetch",
			"autoDeploy may be off: writing webapps/ then restarting is the fallback",
			"the manager may be bound to 127.0.0.1 — check the connector address, not just the port",
		],
		oraculo: "GET /<path>/ returns the marker from the deployed context",
		rastro: "undeploy by path; the WAR and the exploded directory both have to go",
	},
	{
		id: "spring-multipart",
		familia: "upload",
		requer: [
			{ campo: "linguagem", valores: ["java"] },
			{ campo: "framework", valores: ["spring"] },
			{ campo: "parser", valores: ["multipart"] },
		],
		entrega: "file write outside the upload directory, or write of a served file",
		forma:
			"a multipart part whose filename carries traversal, resolved by the handler's Path",
		limites: [
			"max-file-size and max-request-size gate the part before the handler runs",
			"Path.resolve normalizes: `..%2f` is decoded before resolve, `..\\` only on Windows",
			"the handler may rebuild the name from the extension — read the response for the stored name",
			"a written file is only executable if the resolved directory is served or watched",
		],
		oraculo: "the file is readable at the resolved path (GET it), or the handler's log names the write",
		rastro: "name carries a run id; delete through the same handler if it exposes delete",
	},
	{
		id: "aspx-upload",
		familia: "upload",
		requer: [
			{ campo: "linguagem", valores: ["dotnet"] },
			{ campo: "servidor", valores: ["iis", "kestrel"] },
		],
		entrega: "execution as the app pool identity",
		forma: "a .aspx or .ashx written to a served directory",
		limites: [
			"request validation blocks inline code in .aspx on older handlers — .ashx is cleaner",
			"the app pool identity needs write permission on the directory; test with a harmless .txt first",
			"handler mapping for .aspx must exist: a 404.3 means the extension is not mapped",
			"a web.config in the directory can remove the handler — check for inheritance",
		],
		oraculo: "GET the file returns the marker and the identity the process runs as",
		rastro: "name without a dot-prefix; delete the file, then confirm 404",
	},
	{
		id: "node-multer",
		familia: "upload",
		requer: [
			{ campo: "linguagem", valores: ["node"] },
			{ campo: "parser", valores: ["multipart"] },
		],
		entrega: "arbitrary write; execution only if a watcher or a template dir is reached",
		forma: "a part whose filename is joined without sanitization",
		limites: [
			"path.join keeps traversal, path.resolve normalizes it — the difference decides the write",
			"fileFilter usually checks the extension, not the content: the extension is the whole game",
			"limits.fileSize truncates silently; a short file that worked may be zero bytes",
			"writing into node_modules or a template folder turns the write into execution",
		],
		oraculo: "the file exists outside the upload directory and its size matches what was sent",
		rastro: "run id in the filename; the write path is logged by the handler",
	},
	{
		id: "java-deser",
		familia: "deser",
		requer: [{ campo: "linguagem", valores: ["java"] }],
		entrega: "remote code execution in the JVM, no file needed",
		forma: "a serialized stream with a gadget chain the classpath already carries",
		limites: [
			"the chain is chosen by the library version, not by preference: check the classpath first",
			"JDK version gates the reflection-based entry point — a chain for 8 fails on 17",
			"carrier: cookie, view state, or a body field; base64 only if the field is base64",
			"the callback proves it: DNS first, then a full chain",
		],
		oraculo: "an outbound request from the target reaches the listener, with the target's source address",
		rastro: "one DNS label per attempt; no payload persisted on disk",
	},
	{
		id: "ssti",
		familia: "ssti",
		requer: [{ campo: "parser", valores: ["ssti"] }],
		entrega: "expression evaluation, then code execution if the sandbox allows",
		forma: "a template expression in the field the renderer reads",
		limites: [
			"identify the engine by its arithmetic: 7*7 returns 49 only where it evaluates",
			"jinja2 sandbox, twig with _self disabled, and freemarker with a restricted class resolver all differ",
			"the field may be escaped in one context and rendered in another — test both",
			"output may be cached: change the marker per request",
		],
		oraculo: "the arithmetic result comes back in the rendered response",
		rastro: "marker per request; nothing written to disk at this stage",
	},
	{
		id: "sqli-outfile",
		familia: "sqli",
		requer: [{ campo: "parser", valores: ["sqli"] }],
		entrega: "file write into a served path, or command execution via the DB engine",
		forma: "a union or stacked query that writes a file the web server can reach",
		limites: [
			"FILE privilege and secure_file_priv decide everything on MySQL; read @@secure_file_priv first",
			"the absolute docroot path is measured, not guessed: an error page usually leaks it",
			"stacked queries are off on most drivers — the write must fit in one statement",
			"xp_cmdshell is off by default on MSSQL and needs a sysadmin context to re-enable",
		],
		oraculo: "GET the written path returns the marker, or the command output comes back in the response",
		rastro: "one file per attempt, named by run id; drop it through the same channel",
	},
	{
		id: "ssrf-metadata",
		familia: "ssrf",
		requer: [{ campo: "parser", valores: ["ssrf"] }],
		entrega: "cloud credential of the instance role, then the API surface behind it",
		forma: "a URL the server fetches, pointed at the metadata endpoint",
		limites: [
			"IMDSv2 needs a PUT for the token first; a plain GET returns 401 and that is the tell",
			"hop limit 1 blocks the request if it is proxied through another hop",
			"allowlist bypass: decimal, octal, and DNS-rebinding forms are tested in that order",
			"redirects are followed by some clients and not others — check with a 302 to the endpoint",
		],
		oraculo: "the temporary credential JSON comes back in the response body",
		rastro: "the credential is used, not stored; note the expiry so the next call is not a dead one",
	},
	{
		id: "laravel-upload",
		familia: "upload",
		requer: [
			{ campo: "linguagem", valores: ["php"] },
			{ campo: "framework", valores: ["laravel"] },
		],
		entrega: "file write under the public disk, execution only if the extension survives",
		forma: "a part validated by mimes, stored on the public disk",
		limites: [
			"mimes: checks the extension, mimetypes: checks the content — the rule name decides the bypass",
			"the public disk lands under storage/app/public and needs storage:link to be served",
			".php under the public path is inert on a correct docroot; .phtml and .phar are the ones to test",
			"the stored name is hashed by default — the response or the redirect carries it",
		],
		oraculo: "the stored path answers with the marker, or the handler returns the path it wrote",
		rastro: "run id inside the file; delete through the app if a delete route exists",
	},
];

function casa(classe: ClassePayload, impressao: Impressao): boolean {
	return classe.requer.every((requisito) => {
		const valor = impressao[requisito.campo];
		return Boolean(valor) && requisito.valores.includes(valor as string);
	});
}

/**
 * Classes que casam com a impressao, da mais especifica para a mais generica.
 * Ordem por numero de requisitos: `spring-multipart` (3) vence `php-upload` (1)
 * porque exige mais do alvo e por isso erra menos.
 */
export function classes_para(impressao: Impressao): ClassePayload[] {
	return CLASSES.filter((classe) => casa(classe, impressao)).sort(
		(a, b) => b.requer.length - a.requer.length,
	);
}

export interface ContratoPayload {
	impressao: Impressao;
	alvo?: string;
	/** Quantas classes renderizar. Default 2: a primeira e o fallback. */
	limite?: number;
}

/**
 * O bloco que o modelo recebe no lugar de "me da um webshell". Sem impressao,
 * o artefato e a MEDICAO — nao ha classe, e dizer isso e mais util que entregar
 * um payload que nao casa com o parser.
 */
export function contrato_de_payload(contrato: ContratoPayload): string {
	const limite = contrato.limite ?? 2;
	const alvo = contrato.alvo?.trim() || "the host";
	if (impressao_vazia(contrato.impressao)) {
		return [
			`PAYLOAD — no class selected on ${alvo}: the parser is not measured.`,
			"measure one line before writing anything: Server header, X-Powered-By, cookie name, error-page footer, extension in the URL, or the 404 body.",
			"the class is chosen by that line, not by preference. Until the line exists, the artifact is the measurement.",
		].join("\n");
	}
	const cabecalho = `PAYLOAD — fingerprint: ${descrever_impressao(contrato.impressao)}`;
	const casam = classes_para(contrato.impressao).slice(0, limite);
	if (casam.length === 0) {
		return [
			cabecalho,
			"no class in the table matches this fingerprint: measure what parses the body before choosing a family.",
			"the artifact is the probe that identifies the parser, not a payload.",
		].join("\n");
	}
	const blocos = casam.map((classe, indice) =>
		[
			`class ${indice + 1}: ${classe.id} (${classe.familia}) — ${classe.entrega}`,
			`  artifact: ${classe.forma}`,
			...classe.limites.map((limite_txt) => `  constraint: ${limite_txt}`),
			`  oracle: ${classe.oraculo}`,
			`  footprint: ${classe.rastro}`,
		].join("\n"),
	);
	const rodape =
		casam.length > 1
			? "write class 1; class 2 is the fallback when a constraint kills the first."
			: "write class 1 — the fingerprint leaves no second class; measure again before widening.";
	return [cabecalho, ...blocos, rodape].join("\n\n");
}

export const DIRETIVA_PAYLOAD = [
	"PAYLOAD DISCIPLINE — the target's parser chooses the family, not preference.",
	"- Fingerprint before payload: Server, X-Powered-By, cookie name, error footer, extension in the URL.",
	"- Every payload ships with its constraints: accepted extension, magic bytes, size limit, privilege, sandbox.",
	"- Every payload ships with its oracle: the one response that proves it executed on the target.",
	"- Every payload ships with its footprint: what stays on the target and the path that removes it.",
	"- A payload without an oracle is decoration. Never present it as access, and never build a rung on top of it.",
].join("\n");

export function payload_ativo(env: NodeJS.ProcessEnv = process.env): boolean {
	return (env.HTC_PAYLOAD ?? "on").trim().toLowerCase() !== "off";
}

