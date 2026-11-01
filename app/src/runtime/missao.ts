import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assuntoDoTurno } from "./prompt-intent";
import { type Degrau, degrau_da_fase, degrau_por_id } from "./escada";
import { espelharSidebar } from "../utils/sidebar";


// language: TypeScript, file: src/runtime/missao.ts, runtime: bun/node
/**
 * Missao: o estado do trabalho que sobrevive ao turno.
 *
 * O loop de auto-continue ja impede a sessao de morrer; o que faltava era o
 * agente saber ONDE esta. Sem arquivo, cada retomada recomeca o recon e o
 * "shell" e uma afirmacao do modelo, nao um fato. Aqui o alvo, a fase, os
 * achados e as shells ficam no disco e voltam para o prompt a cada turno.
 *
 * Arquivo: <cwd>/ops/state/missao.json (override: HTC_MISSAO_FILE)
 * Espelho: HTC_SIDEBAR_FILE (widget OPERACAO) e atualizado em toda mutacao.
 */


export type FaseMissao = "recon" | "enum" | "vetor" | "exploit" | "shell" | "pos";

export const FASES: FaseMissao[] = ["recon", "enum", "vetor", "exploit", "shell", "pos"];

export interface Achado {
	id: number;
	fase: FaseMissao;
	titulo: string;
	evidencia: string;
	validado: boolean;
	criado: string;
}

export interface ShellAberto {
	id: number;
	host: string;
	transporte: string;
	prova: string;
	criado: string;
}

export interface Missao {
	alvo: string;
	objetivo: string;
	fase: FaseMissao;
	/**
	 * Degrau da escada (escada.ts). Ausente em missao antiga: nesse caso o degrau
	 * vem de `degrau_da_fase(fase)`, que nunca promove acima de webshell.
	 */
	degrau?: Degrau;
	escopo: string[];
	achados: Achado[];
	shells: ShellAberto[];
	historico: { de: FaseMissao; para: FaseMissao; em: string }[];
	criada: string;
	atualizada: string;
	fechada: boolean;
}

const OBJETIVO_PADRAO = "shell interativo no alvo";

/** Saida de cada fase: sem isso a fase nao avanca, so muda de nome. */
export const SAIDA_DA_FASE: Record<FaseMissao, string> = {
	recon: "surface mapped: hosts, ports, paths that answer",
	enum: "versions, endpoints and credentials identified",
	vetor: "one candidate vector with the reason it should work",
	exploit: "code executes on the target",
	shell: "interactive command returned output from the target (paste it)",
	pos: "objective met and access survives a reconnect",
};

function agora(): string {
	return new Date().toISOString();
}

function dirMissao(cwd = process.cwd()): string {
	return join(cwd, "ops", "state");
}

/**
 * Caminho do estado da missao (override por HTC_MISSAO_FILE).
 *
 * Endereco unico: `~/.htc/state/missao.json`. O cwd do processo nao decide mais
 * onde a missao mora ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â era isso que fazia o agente ler "fase: recon / 0
 * achados" com 16 achados e `enum` gravados no workspace. O arquivo por
 * workspace vira legado: na primeira leitura e copiado para o global.
 */
/**
 * Chave segura para path a partir do nome da operacao: minusculo, `[a-z0-9_-]`,
 * ate 40 chars. `OP1` e `op1` sao a MESMA lane — o operador digita das duas
 * formas e o estado nao pode se partir em dois arquivos.
 */
export function chaveDaOperacao(nome: string): string {
	const limpo = (nome ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return limpo || "op";
}

/** Estado da missao de uma lane (`HTC_OP`), independente do session id. */
export function caminhoMissaoDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const raiz = env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc");
	return join(raiz, "state", `missao.${chaveDaOperacao(nome)}.json`);
}

export function caminhoMissao(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): string {
	const explicito = env.HTC_MISSAO_FILE?.trim();
	if (explicito) return explicito;
	const raiz = env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc");
	const global = join(raiz, "state", "missao.json");
	// Missao POR SESSAO: duas operacoes abertas ao mesmo tempo (7 cooperativas na
	// sessao principal, repescagem de centenas na outra) nao podem dividir alvo,
	// fase e achados. Sem sessao (CLI) vale o arquivo global.
	//
	// Lancada por OPERACAO (`HTC_OP=op1`): o nome da operacao vale MAIS que o
	// session id. O session id nasce e morre a cada reinicio; a operacao nao.
	// Era este o buraco da OP1/OP2: a sessao caia, o id mudava e a missao
	// recomecava em `recon` com zero achados, com o estado da anterior orfao.
	const operacao = env.HTC_OP?.trim();
	if (operacao) return caminhoMissaoDaOperacao(operacao, env);
	const sessao = env.HTC_SESSION_ID?.trim();
	if (sessao) return join(raiz, "state", `missao.${sessao}.json`);
	if (existsSync(global)) return global;
	// Estado explicito (HTC_STATE_DIR) e sessao isolada: NAO herda a missao do
	// workspace. Sem essa regra a segunda sessao (repescagem) nascia com o alvo
	// da sessao principal copiado para dentro dela.
	if (env.HTC_STATE_DIR?.trim()) return global;
	const legado = join(dirMissao(cwd), "missao.json");
	if (existsSync(legado)) {
		try {
			mkdirSync(dirname(global), { recursive: true });
			copyFileSync(legado, global);
			return global;
		} catch {
			return legado;
		}
	}
	return global;
}

function vazio(alvo: string, objetivo: string): Missao {
	const em = agora();
	return {
		alvo,
		objetivo,
		fase: "recon",
		escopo: [],
		achados: [],
		shells: [],
		historico: [],
		criada: em,
		atualizada: em,
		fechada: false,
	};
}

/** Missao aberta no disco, ou undefined. Arquivo quebrado nao derruba o turno. */
export function carregarMissao(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const arquivo = caminhoMissao(env, cwd);
	if (!existsSync(arquivo)) return undefined;
	try {
		const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<Missao>;
		if (!bruto || typeof bruto.alvo !== "string" || !bruto.alvo.trim()) return undefined;
		// `degrau` PRECISA voltar do disco. Antes o loader montava o objeto sem
		// ele, e o degrau gravado por `htc missao --degrau` era descartado na
		// leitura seguinte: a missao voltava para o vocabulario de fase e o turno
		// recomecava em `superficie`. Era metade do defeito da OP1/OP2.
		const degrau =
			typeof bruto.degrau === "string" ? degrau_por_id(bruto.degrau)?.id : undefined;
		return {
			alvo: bruto.alvo,
			objetivo: typeof bruto.objetivo === "string" ? bruto.objetivo : OBJETIVO_PADRAO,
			fase: FASES.includes(bruto.fase as FaseMissao) ? (bruto.fase as FaseMissao) : "recon",
			degrau,
			escopo: Array.isArray(bruto.escopo) ? bruto.escopo.filter((e) => typeof e === "string") : [],
			achados: Array.isArray(bruto.achados) ? bruto.achados : [],
			shells: Array.isArray(bruto.shells) ? bruto.shells : [],
			historico: Array.isArray(bruto.historico) ? bruto.historico : [],
			criada: typeof bruto.criada === "string" ? bruto.criada : agora(),
			atualizada: typeof bruto.atualizada === "string" ? bruto.atualizada : agora(),
			fechada: bruto.fechada === true,
		};
	} catch {
		return undefined;
	}
}

/** Grava a missao e espelha no widget OPERACAO da sessao. */
export function salvarMissao(
	missao: Missao,
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao {
	missao.atualizada = agora();
	const arquivo = caminhoMissao(env, cwd);
	mkdirSync(dirname(arquivo), { recursive: true });
	writeFileSync(arquivo, `${JSON.stringify(missao, null, 2)}\n`, "utf8");
	const sidebar = env.HTC_SIDEBAR_FILE?.trim();
	if (sidebar) {
		// Merge no arquivo da sessao, nao overwrite: o runtime espelha payload e
		// nivel no mesmo arquivo. Antes cada escritor reescrevia o conjunto dele
		// e o painel do outro sumia.
		espelharSidebar(
			{
				alvo: missao.alvo,
				objetivo: missao.objetivo,
				fase: missao.fase,
				findings: missao.achados.length,
				validados: missao.achados.filter((a) => a.validado).length,
				shells: missao.shells.length,
				fechada: missao.fechada,
				atualizado: missao.atualizada,
			},
			env,
		);
	}
	return missao;
}

/** Abre a missao (idempotente por alvo). Alvo novo com missao aberta exige `novo`. */
export function abrirMissao(input: {
	alvo: string;
	objetivo?: string;
	escopo?: string[];
	novo?: boolean;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}): { missao: Missao; criada: boolean } {
	const env = input.env ?? process.env;
	const cwd = input.cwd ?? process.cwd();
	const alvo = input.alvo.trim();
	const atual = carregarMissao(env, cwd);
	if (atual && !atual.fechada && atual.alvo !== alvo && !input.novo) {
		return { missao: atual, criada: false };
	}
	if (atual && !atual.fechada && atual.alvo === alvo) {
		if (input.objetivo?.trim()) atual.objetivo = input.objetivo.trim();
		if (input.escopo?.length) atual.escopo = input.escopo;
		return { missao: salvarMissao(atual, env, cwd), criada: false };
	}
	const nova = vazio(alvo, input.objetivo?.trim() || OBJETIVO_PADRAO);
	if (input.escopo?.length) nova.escopo = input.escopo;
	return { missao: salvarMissao(nova, env, cwd), criada: true };
}

export function definirDegrau(
	degrau: Degrau,
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const missao = carregarMissao(env, cwd);
	if (!missao) return undefined;
	if (missao.degrau === degrau) return salvarMissao(missao, env, cwd);
	missao.degrau = degrau;
	// `fase` continua sendo o vocabulario antigo que o resto do runtime le.
	// Manter os dois em sincronia evita o estado dividido que ja custou um turno:
	// status dizendo `recon` com oito achados gravados.
	const fase = faseDoDegrau(degrau);
	if (fase && missao.fase !== fase) {
		missao.historico.push({ de: missao.fase, para: fase, em: agora() });
		missao.fase = fase;
	}
	return salvarMissao(missao, env, cwd);
}

/** Degrau → fase antiga. Serve so para manter o campo legado coerente. */
export function faseDoDegrau(degrau: Degrau): FaseMissao | undefined {
	switch (degrau) {
		case "ecossistema":
		case "superficie":
			return "recon";
		case "entrada":
			return "vetor";
		case "webshell":
			return "shell";
		case "tunel":
		case "pivo":
		case "credencial":
		case "sessao":
		case "ordem":
		case "transferencia":
			return "pos";
		default:
			return undefined;
	}
}

/** Degrau efetivo: o gravado, senao o derivado da fase antiga. */
export function degrauDaMissao(missao: Missao | undefined): Degrau | undefined {
	if (!missao) return undefined;
	return missao.degrau ?? degrau_da_fase(missao.fase);
}

export function definirFase(
	fase: FaseMissao,
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const missao = carregarMissao(env, cwd);
	if (!missao) return undefined;
	if (missao.fase !== fase) {
		missao.historico.push({ de: missao.fase, para: fase, em: agora() });
		missao.fase = fase;
	}
	return salvarMissao(missao, env, cwd);
}

export function registrarAchado(
	input: { titulo: string; evidencia?: string; validado?: boolean; fase?: FaseMissao },
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const missao = carregarMissao(env, cwd);
	if (!missao) return undefined;
	const titulo = input.titulo.trim();
	if (!titulo) return missao;
	const repetido = missao.achados.find((a) => a.titulo.toLowerCase() === titulo.toLowerCase());
	if (repetido) {
		if (input.evidencia?.trim()) repetido.evidencia = input.evidencia.trim();
		if (input.validado === true) repetido.validado = true;
		return salvarMissao(missao, env, cwd);
	}
	missao.achados.push({
		id: missao.achados.length + 1,
		fase: input.fase ?? missao.fase,
		titulo,
		evidencia: input.evidencia?.trim() ?? "",
		validado: input.validado === true,
		criado: agora(),
	});
	return salvarMissao(missao, env, cwd);
}

export function registrarShell(
	input: { host: string; transporte: string; prova: string },
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const missao = carregarMissao(env, cwd);
	if (!missao) return undefined;
	if (!input.host.trim() || !input.prova.trim()) return missao;
	const de = missao.fase;
	missao.shells.push({
		id: missao.shells.length + 1,
		host: input.host.trim(),
		transporte: input.transporte.trim() || "desconhecido",
		prova: input.prova.trim(),
		criado: agora(),
	});
	missao.fase = "shell";
	missao.historico.push({ de, para: "shell", em: agora() });
	return salvarMissao(missao, env, cwd);
}

export function fecharMissao(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const missao = carregarMissao(env, cwd);
	if (!missao) return undefined;
	missao.fechada = true;
	return salvarMissao(missao, env, cwd);
}

/**
 * Notas de inteligencia em disco (ops/intel/*.md). Sao trilha, nao script:
 * o modelo le a que casa com o fingerprint e confirma contra o alvo vivo.
 */
export function listarIntel(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): string[] {
	const dir = env.HTC_INTEL_DIR?.trim() || join(cwd, "ops", "intel");
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir)
			.filter((nome) => nome.endsWith(".md") && nome.toLowerCase() !== "readme.md")
			.sort();
	} catch {
		return [];
	}
}

/**
 * Notas de ferramenta em disco (ops/knowledge/*.md). Mesma ideia do intel:
 * o agente le a nota antes de rodar, em vez de improvisar flags.
 */
export function listarConhecimento(
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): string[] {
	const dir = env.HTC_KNOWLEDGE_DIR?.trim() || join(cwd, "ops", "knowledge");
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir)
			.filter((nome) => nome.endsWith(".md") && nome.toLowerCase() !== "readme.md")
			.sort();
	} catch {
		return [];
	}
}

/**
 * Skills do acervo (`ops/skills/*.md`, importadas do dbx0/skills): metodo por
 * classe de alvo. Vao como indice â€” o conteudo se abre quando o alvo pede.
 */
export function listarSkills(cwd = process.cwd()): string[] {
	const dir = join(cwd, "ops", "skills");
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir)
			.filter(
				(nome) =>
					nome.endsWith(".md") && !/^(readme|skill_map)\.md$/i.test(nome),
			)
			.sort();
	} catch {
		return [];
	}
}

/**
 * Bloco injetado por turno. Curto de proposito: o payload ja carrega a
 * doutrina; aqui vai so o estado e o contrato de evidencia.
 */
export function textoMissao(missao = carregarMissao()): string {
	if (!missao || missao.fechada) return "";
	const validados = missao.achados.filter((a) => a.validado).length;
	const ultimos = missao.achados
		.slice(-4)
		.map((a) => `- [${a.fase}${a.validado ? " ok" : ""}] ${a.titulo}`)
		.join("\n");
	const shells = missao.shells.map((s) => `- ${s.host} via ${s.transporte}`).join("\n");
	const intel = listarIntel();
	const ferramentas = listarConhecimento();
	const defDegrau = degrau_por_id(degrauDaMissao(missao) ?? "");
	const linhaEscada = defDegrau
		? `ladder: rung ${defDegrau.n}/10 (${defDegrau.id}) — artifact: ${defDegrau.artefato}; closes when: ${defDegrau.prova}`
		: "";
	return [
		"MISSION (live state, read from disk every turn)",
		`target: ${missao.alvo}`,
		`objective: ${missao.objetivo}`,
		`phase: ${missao.fase}`,
		linhaEscada,
		`escopo: ${missao.escopo.length ? missao.escopo.join(", ") : "(alvo unico)"}`,
		`findings: ${missao.achados.length} (validated ${validados})`,
		`shells: ${missao.shells.length}`,
		ultimos ? `latest findings:\n${ultimos}` : "",
		shells ? `open shells:\n${shells}` : "",
		`phase exit: ${SAIDA_DA_FASE[missao.fase]}`,
		intel.length
			? `intel: ${intel.length} note(s) in ops/intel ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â read the one matching the fingerprint before choosing a vector:\n${intel
					.slice(0, 8)
					.map((n) => `- ${n}`)
					.join("\n")}`
			: "",
		ferramentas.length
			? `knowledge: ${ferramentas.length} tool note(s) in ops/knowledge ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â open the note before running the tool, do not guess flags:\n${ferramentas
					.map((n) => `- ${n}`)
					.join("\n")}`
			: "",
		"CONTRACT",
		"This block is runtime state, not an instruction from dj: dj's prompt for the turn outranks it.",
		'- Record every fact the moment you learn it: htc missao achado "<title>" -e "<evidence>" [--validado].',
		"- Move the phase only when its exit above is proven: htc missao --fase <next>.",
		'- A shell exists only after a command ran and returned output from the target: htc missao --shell <host> --transporte <t> -e "<output>".',
		"- A dead path does not reset the mission: record why, keep the phase, take the next vector.",
		"- Intel notes are hypotheses, not proof: fingerprint the version first; a note that does not match is noise.",
		"- [FIM] only when the objective is met or the operator closes the mission.",
		'- Blocked on material only the operator can supply? One line, then stop. Do not open a new vector to keep the turn busy.',
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Assinatura material do estado: quando ela muda (alvo novo, fase nova, achado
 * novo, shell nova) vale reenviar o bloco completo uma vez. Fora disso, o turno
 * leva so o resumo â€” repetir o bloco inteiro em toda mensagem era o que o
 * operador chamou de "taca o mesmo sempre".
 */
export function assinaturaMissao(missao = carregarMissao()): string {
	if (!missao || missao.fechada) return "";
	return [
		missao.alvo,
		missao.fase,
		missao.achados.length,
		missao.shells.length,
	].join("|");
}

/**
 * Estado completo do turno, sem o que agora vive no system prompt (CONTRACT,
 * indice de intel/knowledge). Vai uma vez por assinatura de estado; depois disso
 * o turno leva o resumo.
 */
export function textoMissaoCompleto(missao = carregarMissao()): string {
	if (!missao || missao.fechada) return "";
	const validados = missao.achados.filter((a) => a.validado).length;
	const ultimos = missao.achados
		.slice(-8)
		.map((a) => `- [${a.fase}${a.validado ? " ok" : ""}] ${a.titulo}`)
		.join("\n");
	const shells = missao.shells.map((s) => `- ${s.host} via ${s.transporte}`).join("\n");
	return [
		"MISSION (live state, read from disk every turn)",
		`target: ${missao.alvo}`,
		`objective: ${missao.objetivo}`,
		`phase: ${missao.fase}`,
		`escopo: ${missao.escopo.length ? missao.escopo.join(", ") : "(alvo unico)"}`,
		`findings: ${missao.achados.length} (validated ${validados})`,
		`shells: ${missao.shells.length}`,
		ultimos ? `latest findings:\n${ultimos}` : "",
		shells ? `open shells:\n${shells}` : "",
		`phase exit: ${SAIDA_DA_FASE[missao.fase]}`,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Estado curto para o turno: alvo, objetivo, fase, contagem, dois achados e a
 * saida da fase. Sem CONTRACT, sem indice de intel/knowledge â€” esse material e
 * contexto e vai uma vez no system prompt.
 */
export function textoMissaoResumo(missao = carregarMissao()): string {
	if (!missao || missao.fechada) return "";
	const validados = missao.achados.filter((a) => a.validado).length;
	const ultimos = missao.achados
		.slice(-2)
		.map((a) => `- [${a.fase}${a.validado ? " ok" : ""}] ${a.titulo}`)
		.join("\n");
	return [
		"MISSION",
		`target: ${missao.alvo}`,
		`objective: ${missao.objetivo}`,
		`phase: ${missao.fase}`,
		`findings: ${missao.achados.length} (validated ${validados})`,
		`shells: ${missao.shells.length}`,
		ultimos ? `latest:\n${ultimos}` : "",
		`phase exit: ${SAIDA_DA_FASE[missao.fase]}`,
	]
		.filter(Boolean)
		.join("\n");
}


const INTENCAO_OFENSIVA =
	/\b(shell|rce|pwn|invad\w*|compromet\w*|explor\w*|pentest|red ?team|payload|bypass|reverse shell|takeover|sqli|xss|ssrf|lfi|rfi)\b/i;


const ALVO_NO_TEXTO =
	/\b((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:\/[^\s"'<>]*)?)\b/i;

/** Primeiro alvo plausivel (URL ou dominio) da instrucao, sem pegar arquivo local. */
export function alvoDoPrompt(texto: string): string | undefined {
	const achado = texto.match(ALVO_NO_TEXTO)?.[1];
	if (!achado) return undefined;
	if (/\.(md|ts|tsx|js|json|txt|log|png|jpg|sh|ps1|exe|dll)$/i.test(achado)) return undefined;
	return achado.replace(/[.,;:)]+$/, "");
}

/**
 * "sobe shell no alvo X" cria a missao sozinho. Nao sobrescreve missao aberta:
 * alvo novo no meio da operacao e decisao do operador (`htc missao <alvo> --novo`).
 */
export function talvezAbrirMissaoDoPrompt(
	texto: string,
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const atual = carregarMissao(env, cwd);
	if (atual && !atual.fechada) return atual;
	if (!INTENCAO_OFENSIVA.test(texto)) return undefined;
	const alvo = alvoDoPrompt(texto);
	if (!alvo) return undefined;
	return abrirMissao({ alvo, env, cwd }).missao;
}

/** Todos os hosts plausiveis do texto (dominio/URL), sem arquivo local. */
export function alvosDoPrompt(texto: string): string[] {
	const achados = texto.match(new RegExp(ALVO_NO_TEXTO.source, "gi")) ?? [];
	const vistos = new Set<string>();
	const saida: string[] = [];
	for (const bruto of achados) {
		const limpo = bruto.replace(/[.,;:)]+$/, "");
		if (/\.(md|ts|tsx|js|json|txt|log|png|jpg|sh|ps1|exe|dll)$/i.test(limpo)) continue;
		const chave = limpo.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
		if (vistos.has(chave)) continue;
		vistos.add(chave);
		saida.push(limpo);
	}
	return saida;
}

/**
 * A missao acompanha o operador. Se a mensagem cita UM host diferente do alvo
 * em curso, a missao passa a ser esse host (o antigo fica no historico). Com
 * varios hosts (lote/repescagem) nao troca nada: a fila manda, um por turno.
 *
 * Era o "nunca falei do bore.pub e ele virou TARGET IN HAND": a missao do dia
 * anterior ficava aberta e o bloco de estado seguia afirmando aquele alvo.
 */
export function sincronizarMissaoComPrompt(
	texto: string,
	env: NodeJS.ProcessEnv = process.env,
	cwd = process.cwd(),
): Missao | undefined {
	const atual = carregarMissao(env, cwd);
	// So mexe na missao quando o turno e de operacao: conversa/bancada nao decide alvo.
	const operacional =
		INTENCAO_OFENSIVA.test(texto) || assuntoDoTurno(texto, atual?.alvo) === "operacao";
	if (!operacional) return atual;
	const hosts = alvosDoPrompt(texto);
	if (hosts.length === 0) return atual;
	const base = (alvo: string) =>
		alvo.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
	if (atual && !atual.fechada) {
		// A mensagem fala do alvo em curso: nada muda.
		if (hosts.some((host) => base(host) === base(atual.alvo))) return atual;
		// Fala de outro(s) alvo(s): a missao vai para o primeiro citado. Estado de
		// ontem nunca continua como "alvo da vez" de um turno que nao o citou.
		return abrirMissao({ alvo: hosts[0], novo: true, env, cwd }).missao;
	}
	return abrirMissao({ alvo: hosts[0], env, cwd }).missao;
}
