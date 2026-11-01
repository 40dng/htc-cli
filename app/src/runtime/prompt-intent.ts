// language: TypeScript, file: src/runtime/prompt-intent.ts, runtime: bun/node
//
// O turno do operador decide o que o runtime anexa — nao o contrario.
//
// Antes, todo turno carregava a mesma cauda fixa ("Continue the work — next
// concrete step", "TARGET IN HAND … Close the host with [ALVO OK]", MISSION +
// CONTRACT). Efeito medido em 31/10: o payload virava a ordem do turno, o
// prompt do operador virava comentario, e nao existia forma de mudar de direcao
// ou parar — o texto fixo mandava continuar em cima de qualquer coisa.
//
// Aqui a cauda e derivada do que o operador escreveu:
//   parar    -> nao anexa nada (e o auto-continue nao retoma)
//   conversa -> estado compacto, sem ordem de trabalho
//   correcao -> a mensagem dele substitui o plano do turno
//   acao     -> cauda operacional (artefato / alvo da vez)
//
// O estado da missao continua indo junto — como CONTEXTO, nao como ordem.

export type Intencao = "parar" | "conversa" | "correcao" | "acao";

/**
 * Cauda injetada pelo runtime — em QUALQUER posicao do texto. O operador cola o
 * payload de volta na mensagem quando reclama, e o texto colado contem "shells",
 * "MISSION", "phase"…: sem essa limpeza o classificador lia a propria cauda como
 * mensagem sobre o alvo e anexava tudo de novo (loop de payload).
 */
const MARCADORES_DE_CAUDA = [
	"TARGET IN HAND:",
	"One host this turn.",
	"Close the turn with an artifact",
	"Close the host with [ALVO OK]",
	"If the blocker needs material only the operator can supply",
	"Continue the work",
	"MISSION (live state",
	"MISSION (state only)",
	"\nMISSION\n",
	"Turn type:",
	"Work order:",
	"Resume from the last result",
	"CONTRACT (bench state",
	"latest findings:",
	"latest:",
	"phase exit:",
];

/** Texto do operador sem a cauda injetada pelo runtime (colada ou anexada). */
export function limparCaudaDohost(texto: string): string {
	const bruto = texto ?? "";
	let primeiro = -1;
	for (const marcador of MARCADORES_DE_CAUDA) {
		const achado = bruto.indexOf(marcador);
		if (achado >= 0 && (primeiro < 0 || achado < primeiro)) primeiro = achado;
	}
	return (primeiro >= 0 ? bruto.slice(0, primeiro) : bruto).trim();
}

// "para" como preposicao ("para o alvo X") nao para nada: o verbo de parada so
// conta no inicio da mensagem quando fecha a frase ou vem em locucao fechada.
const PARADA_NO_INICIO =
	/^\s*(?:(?:para|pare)(?:\s+(?:tudo|com\s+isso|de|ai|aí)\b|[.!]?\s*$)|(?:stop|hold|pausa|pausar|cancela|cancelar|aborta|abortar|interrompe|interromper|espera|esperar|aguarda|aguardar|aguarde|chega)\b)/i;

const PARADA_FECHADA =
	/\b(para|pare)\s+(tudo|com\s+isso|de\s+(fazer|rodar|executar|testar|mexer|tentar|insistir))\b|\b(nao|não)\s+(faca|faça|continue|siga|rode|execute|mexa|insista)\b|\b(por\s+enquanto|deixa)\s+(nao|não|quieto|de\s+lado)\b|\b(da\s+uma\s+parada|para\s+a[ií]|calma|respira|segura)\b/i;

/** Mudanca de direcao disfarcada de parada: "para de X e faz Y". */
const CORRECAO_APOS_PARADA =
	/^\s*(para|pare)\s+de\s+.{0,80}\be\b\s+.{0,60}(faz|faca|faça|corrij\w*|arrum\w*|mud\w*|troc\w*|volt\w*|refa\w*|consert\w*|olha|veja)\b/i;

const CORRECAO =
	/\b(corrij\w*|corrig\w*|arrum\w*|consert\w*|mud\w+|troc\w+|refa\w+|revert\w*|volta\s+(a|atras|pro)|em\s+vez\s+de|ao\s+inv[eé]s\s+de|nao\s+[eé]\s+isso|não\s+é\s+isso|errad[oa]|ignore\s+isso|ignora\s+isso|reconsider\w*)\b/i;

const CONVERSA_INICIO =
	/^\s*(o\s+que|oq|oque|que\b|qual|quais|quem|quando|onde|como|em\s+que|cade|cad[eê]|por\s*que|porque|pq|me\s+(explica|fala|conta)|explica\w*|(?:voce|voc[eê]|vc)\s+(fez|mudou|t[aá]|est[aá]|sabe|viu|lembra|consegue|pode|quis|deixou))\b/i;

const CONVERSA_MEIO =
	/\b(o\s+que\s+(vc|voc[eê])\s+(fez|mudou|ta|t[aá])\b|cad[eê]\s+(o|a|as|os)\b|por\s*que\b|\?)+\s*$/i;

function normalizar(texto: string): string {
	return limparCaudaDohost(texto).replace(/\s+/g, " ").trim();
}

/**
 * Classifica o prompt do operador. Ordem de precedencia: correcao apos parada >
 * pergunta (inicio da mensagem manda) > correcao > parada > pergunta no meio >
 * acao (default).
 */
export function classificarPrompt(texto: string): Intencao {
	const t = normalizar(texto);
	if (!t) return "acao";
	if (CONVERSA_CURTA.test(t)) return "conversa";
	if (CORRECAO_APOS_PARADA.test(t)) return "correcao";
	// Pergunta primeiro: "o que vc mudou?" tem "mudou" e nao e ordem de mudar.
	if (CONVERSA_INICIO.test(t)) return "conversa";
	if (CORRECAO.test(t)) return "correcao";
	const curto = t.length <= 240;
	if (PARADA_NO_INICIO.test(t) || (curto && PARADA_FECHADA.test(t))) {
		return "parar";
	}
	// Pergunta escrita no meio de uma frase longa tambem e pergunta — desde que a
	// mensagem nao comece por um verbo de ordem.
	const ordemDeTrabalho =
		/^\s*(faz|fa[cç]a|rode|roda|executa|corre|testa|sobe|abre|olha|analisa|verifica|instala|baixa|leia|le)\b/i;
	if (t.includes("?") && t.length <= 600 && !ordemDeTrabalho.test(t)) {
		return "conversa";
	}
	if (t.endsWith("?")) return "conversa";
	if (CONVERSA_INICIO.test(t) || CONVERSA_MEIO.test(t)) return "conversa";
	return "acao";
}

export type Assunto = "operacao" | "fora";

// Vocabulario de operacao: se a mensagem fala disso, o estado da missao tem
// valor para o turno.
const VOCAB_OPERACAO =
	/\b(alvos?|hosts?|shells?|vetores?|fases?|recon|enum|enumera\w*|exploit\w*|pos-exploracao|achados?|findings?|missao|portas?|scanner|nmap|masscan|ffuf|nuclei|httpx|chisel|ligolo|softether|gsocket|socks|tune(l|is)|webshell|rce|sqli|xss|ssrf|lfi|rfi|credenciais?|creds?|hashes?|ntlm|kerberos|persistencia|beacon|implant|c2|engajamento|operacao)\b/i;

// Assunto de bancada/produto: falar do HTC, do payload da sessao, de modelo,
// build ou config NAO e falar do alvo. Fica como referencia do que NAO puxa
// operacao — o gate ja e fechado por padrao.
const VOCAB_BANCADA =
	/\b(htc|checkpoint\w*|providers\.json|models\.json|deepseek|opencode|gemini|dsh|api ?key|chaves?|modelos?|flags?|build|compilar|compila|typescript|bun|node|vitest|auto-?continue|system prompt|payload da sessao|payload do htc|este payload|doutrina|missao\.json|interface|tui)\b/i;

/** O texto fala de bancada (produto/codigo), nao do alvo. */
export function falaDaBancada(texto: string): boolean {
	return VOCAB_BANCADA.test(normalizar(texto));
}

const ORDEM_DE_CONTINUACAO =
	/^\s*(continua|continuar|prossegue|prosseguir|segue|next|proximo|fecha|finaliza|mais um)\b/i;

/** Saudacao/teste: nao e ordem de trabalho e nao pode acordar o auto-continue. */
const CONVERSA_CURTA =
	/^\s*(oi+|ola|olá|eae|e ai|opa|bom dia|boa tarde|boa noite|testando|teste|ok|okay|blz|beleza|valeu|obrigado|show|tranquilo|tudo bem)\b[\s!.?]*$/i;

/** Verbo de trabalho sobre alvo. Sem ele, vocabulario solto nao puxa a operacao. */
const ORDEM_DE_TRABALHO =
	/^\s*(sobe|subir|explora|explorar|enumera|enumerar|testa|testar|ataca|atacar|pivota|pivotar|pega|obter|abre|abrir|fecha|fechar|corre|rodar|roda|executa|valida|validar|varre|mapeia|mapear|scan)\b/i;

/**
 * O turno e sobre a operacao (alvo/fase/shell) ou e sobre outra coisa
 * (bancada, config, conversa)?
 *
 * Gate fechado por padrao, de proposito: exige prova positiva —
 *   (a) o alvo em curso aparece na mensagem, ou
 *   (b) a mensagem fala de alvo/missao/fila/operacao E tem vocabulario de campo, ou
 *   (c) e uma ordem de trabalho (sobe/testa/explora…) com vocabulario de campo.
 * Vocabulario solto ("shell", "host") NAO basta: foi assim que a cauda voltou em
 * cima do proprio payload colado de volta.
 */
export function assuntoDoTurno(texto: string, alvo?: string): Assunto {
	const t = normalizar(texto);
	if (!t) return "fora";
	const alvoLimpo = (alvo ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
	if (alvoLimpo && t.toLowerCase().includes(alvoLimpo)) return "operacao";
	const falaDaOperacao = /\b(alvos?|missao|fila|operacao|engajamento)\b/i.test(t);
	if (falaDaOperacao && VOCAB_OPERACAO.test(t)) return "operacao";
	if (alvoLimpo && ORDEM_DE_TRABALHO.test(t) && VOCAB_OPERACAO.test(t)) {
		return "operacao";
	}
	if (alvoLimpo && ORDEM_DE_CONTINUACAO.test(t)) return "operacao";
	return "fora";
}

/** O turno pede entrega tecnica (comando rodado, arquivo escrito)? */
export function exigeArtefato(intencao: Intencao): boolean {
	return intencao === "acao" || intencao === "correcao";
}

/**
 * Diretiva curta, derivada da intencao. Uma linha por caso: e o que separa
 * "melhorador do prompt" de "ordem fixa em cima do prompt".
 */
export function diretivaDoTurno(intencao: Intencao): string {
	switch (intencao) {
		case "parar":
			return "";
		case "conversa":
			return (
				"Turn type: the operator is asking, not ordering work. Answer from what is " +
				"already on disk and on the terminal; read-only checks are fine. Do not advance " +
				"the operation and do not open a new work front."
			);
		case "correcao":
			return (
				"Turn type: the operator is correcting course. His message replaces this turn's " +
				"plan; if it conflicts with the phase/queue state below, his message wins — record " +
				"the change (htc missao) instead of continuing the old plan."
			);
		default:
			return (
				"Turn type: operator order to execute. Deliver the artifact he asked for " +
				"(a command that ran, a file written, or a response body)."
			);
	}
}

/** Primeiras linhas do estado da missao: contexto, sem ordem de trabalho. */
export function estadoCompacto(blocoMissao: string): string {
	if (!blocoMissao) return "";
	const linhas = blocoMissao
		.split(/\r?\n/)
		.filter((linha) => /^(target|objective|phase|findings|shells):/.test(linha));
	return linhas.length > 0
		? ["MISSION (state only)", ...linhas].join("\n")
		: "";
}
