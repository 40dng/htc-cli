import type { Intencao } from "./prompt-intent";

/**
 * Marcadores terminais: o agente escreve um deles quando a missao acabou de verdade. */
export const MARCADORES_TERMINAIS = [
	"[FIM]",
	"[DONE]",
	"[TAREFA CONCLUIDA]",
	"[MISSION COMPLETE]",
	"[MISSAO CONCLUIDA]",
];

/** Teto padrao de continuacoes automaticas por execucao. */
export const MAX_AUTO_CONTINUES_PADRAO = 0; // 0 = sem teto (infinito)

/**
 * Teto de turnos seguidos SEM progresso antes de o loop parar sozinho.
 *
 * Existe por causa do loop observado em 31/10: a missao estava bloqueada (faltava credencial),
 * o agente respondia "sem mudanca" a cada retomada, e o auto-continue reenviava para sempre
 * porque nada mudava. Progresso aqui = assinatura do estado da missao mudou, ou o turno gerou
 * resposta longa (trabalho real). Tres turnos curtos com o mesmo estado = estagnacao.
 */
export const MAX_TURNOS_SEM_ESTADO = 3;

/** Tamanho de resposta que conta como trabalho real, mesmo sem mudar o estado. */
export const TEXTO_LONGO = 400;

/** Atualiza o contador de turnos sem progresso comparando a assinatura do estado. */
export function contaTurnosSemMudanca(
	anterior: string,
	atual: string,
	contador: number,
	tamanhoTexto: number,
): number {
	if (anterior !== atual || tamanhoTexto >= TEXTO_LONGO) return 0;
	return contador + 1;
}

/** true quando o loop deve parar por estagnacao (nada mudou por N turnos). */
export function estagnou(contador: number, limite = MAX_TURNOS_SEM_ESTADO): boolean {
	return contador >= limite;
}

/**
 * Marcadores EXPLICITOS de parada por decisao humana.
 * Regra dura: terminar com "?" NAO e pedido de decisao — o agente decide e segue.
 * Só para quando escreve um destes marcadores, ou [FIM].
 */
export const MARCADORES_PARADA_HUMANA = [
	"[PERGUNTA]",
	"[DECISAO NECESSARIA]",
	"[AGUARDO OPERADOR]",
	"[BLOQUEADO]",
];

/**
 * Prompt reenviado pelo runtime entre turnos. Curto, imperativo, sem meta.
 *
 * Fala do TRABALHO DA RODADA, nunca "da fila". A versao anterior dizia "retome
 * EXATAMENTE o proximo passo tecnico da fila" e era ela que, em turno cujo pedido
 * nao tinha nada a ver com a fila, virava ordem de seguir o alvo: o modelo largava
 * o pedido do operador e ia trabalhar a fila. A fila entra como ESTADO quando o
 * turno era de fila (`[pedido do operador]` ausente) — nao como ordem fixa.
 */
export const PROMPT_CONTINUACAO =
	"Continue. Nao escreva board, resumo, plano nem promessa, e NAO faca pergunta: retome EXATAMENTE " +
	"o trabalho que o pedido acima abriu e execute (tool calls) agora. Se o pedido acima era sobre " +
	"outra coisa que nao a fila, e ELE que continua — a fila nao substitui o pedido. Quando a " +
	"missao inteira estiver concluida, escreva [FIM] sozinho na ultima linha.";

/**
 * Eixos de retomada. Cada retomada muda o ANGULO do pedido, nao so o texto.
 *
 * Medido em 31/10: o loop reenviava o mesmo paragrafo duas vezes e o modelo
 * respondia a repeticao, nao ao pedido — a recusa vinha identica. O eixo entra
 * no fim do prompt e obriga o turno a atacar por outro caminho.
 */
export const EIXOS_DE_CONTINUACAO = [
	"Retome o ultimo comando exatamente de onde parou e rode o proximo passo dele.",
	"Nao repita o ultimo passo: mude o caminho ate o objetivo e execute o primeiro comando do novo caminho.",
	"Leia o artefato que ja existe no disco e siga do ultimo fato medido, sem recoletar o que ja esta gravado.",
	"Troque o instrumento: se a ferramenta atual e o que falha, use a equivalente da bancada e rode agora.",
];

/**
 * Prompt de retomada do turno N. Sempre comeca por `PROMPT_CONTINUACAO` — a
 * deteccao de "isto e uma continuacao" em `sendWithAutoContinue` depende do
 * prefixo — e nunca sai igual ao anterior, porque o eixo muda junto.
 *
 * `pedidoDoOperador`: a mensagem que ABRIU a rodada. Quando ela existe, vai
 * citada no prompt — e o que impede a retomada de trocar o pedido pela fila.
 * Sem ela (caminho de agente/fila), o estado da missao entra como antes.
 */
export function montarPromptContinuacao(
	iteracao: number,
	missao = "",
	pedidoDoOperador = "",
): string {
	const n = Math.max(1, Math.trunc(iteracao));
	const eixo = EIXOS_DE_CONTINUACAO[(n - 1) % EIXOS_DE_CONTINUACAO.length];
	const partes = [`${PROMPT_CONTINUACAO}`, `[retomada ${n}] ${eixo}`];
	const pedido = pedidoDoOperador.trim();
	if (pedido) {
		// Recorte: a retomada precisa do ASSUNTO do pedido, nao do payload dele.
		// 600 caracteres reenviavam quase o pedido inteiro a cada volta — e
		// retomada que repete o pedido recebe resposta ao eco, nao continuacao.
		// 240 basta para o assunto sobreviver a compactacao de contexto.
		const recorte = pedido.length > 240 ? `${pedido.slice(0, 240)}…` : pedido;
		partes.push(
			`[pedido do operador — referencia do assunto, nao o pedido para reescrever]\n${recorte}`,
		);
	}
	if (missao.trim()) partes.push(missao.trim());
	return partes.join("\n\n");
}

export interface AutoContinueConfig {
	/** Liga/desliga o loop. Default: true em yolo/zen. */
	enabled?: boolean;
	/** Teto de continuacoes. Default: MAX_AUTO_CONTINUES_PADRAO. */
	max?: number;
	/** Marcadores extras alem dos padrao. */
	markers?: string[];
	/**
	 * Parar quando o turno termina em pergunta aberta.
	 * Default FALSE: em autonomia, "?" no fim nao e pedido de decisao — o agente
	 * decide, executa e so para em marcador explicito ou [FIM].
	 */
	stopOnQuestion?: boolean;
	/**
	 * Intencao do prompt do operador que abriu o turno.
	 *
	 * `parar` e `conversa` encerram o loop: retomar automaticamente em cima de um
	 * pedido de parada (ou de uma pergunta) e exatamente o que impedia o operador
	 * de mudar de direcao — o texto fixo mandava continuar de qualquer jeito.
	 */
	intencaoOperador?: Intencao;
	/**
	 * Assunto do turno que abriu a rodada. Fora da operacao, o loop so continua se
	 * o turno realmente produziu trabalho (tool call) — "oi" nao pode virar fila.
	 */
	assuntoDoTurno?: "operacao" | "fora";
	/**
	 * O turno chamou ferramenta / entregou trabalho?
	 *
	 * Tri-estado: `true` = houve tool call, `false` = medido e nao houve (nao
	 * retomar), `undefined` = o chamador nao mediu. Texto longo NAO conta como
	 * trabalho — foi assim que o loop emendava "Continue." em cima de resposta a
	 * pergunta que nao tinha nada a ver com a fila.
	 */
	houveTrabalho?: boolean;
}

function normaliza(texto: string): string {
	return (texto ?? "").trim();
}

/** true quando o agente declarou explicitamente que a missao terminou. */
export function temMarcadorTerminal(
	texto: string,
	markers: string[] = [],
): boolean {
	const alvo = normaliza(texto).toUpperCase();
	if (!alvo) {
		return false;
	}
	for (const m of [...MARCADORES_TERMINAIS, ...markers]) {
		if (m && alvo.includes(m.toUpperCase())) {
			return true;
		}
	}
	return false;
}

/**
 * true quando o agente esta pedindo decisao humana (pergunta no fim do turno).
 * Evita loop em cima de uma pergunta legitima do operador.
 */
export function pedeDecisaoHumana(texto: string): boolean {
	const linhas = normaliza(texto)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (linhas.length === 0) {
		return false;
	}
	// Olha as duas ultimas linhas: pergunta aberta = point of no return humano.
	const rabo = linhas.slice(-2).join(" ");
	if (!rabo.includes("?")) {
		return false;
	}
	// Pergunta de retorica/CTA nao conta; so frases curtas de decisao.
	return rabo.length <= 400;
}

export type MotivoParada =
	| "terminal"
	| "pergunta"
	| "teto"
	| "desligado"
	| "vazio"
	| "operador"
	| "conversa"
	| "sem-trabalho";

export interface DecisaoContinue {
	continuar: boolean;
	motivo?: MotivoParada;
}

/**
 * Teto de continuacoes.
 *
 * `0`, negativo, ausente ou `HTC_AUTO_CONTINUE=inf` = SEM TETO. O loop so para
 * por marcador de conclusao, pergunta explicita (opt-in) ou resposta vazia.
 */
export function tetoDeContinuacoes(cfg: AutoContinueConfig = {}): number {
	const bruto = cfg.max;
	const env = process.env.HTC_AUTO_CONTINUE_MAX?.trim().toLowerCase();
	const envInf = !env || env === "inf" || env === "infinito" || env === "0";
	const valor = Number.isFinite(bruto)
		? Number(bruto)
		: envInf
			? MAX_AUTO_CONTINUES_PADRAO
			: Number(env);
	if (!Number.isFinite(valor) || valor <= 0) return Number.POSITIVE_INFINITY;
	return valor;
}

/**
 * Decide se o runtime deve reenviar o prompt de continuacao.
 *
 * @param texto        ultima resposta do agente (result.text)
 * @param iteracao     quantas continuacoes ja foram feitas (0 = apos o 1o turno)
 * @param cfg          configuracao
 */
export function decidirContinuacao(
	texto: string,
	iteracao: number,
	cfg: AutoContinueConfig = {},
): DecisaoContinue {
	const max = tetoDeContinuacoes(cfg);
	if (cfg.enabled === false) {
		return { continuar: false, motivo: "desligado" };
	}
	// O turno foi aberto por um pedido de parada ou por uma pergunta: o operador
	// esta conduzindo, nao a fila. Retomar aqui e o que ele chama de "fixa".
	if (cfg.intencaoOperador === "parar") {
		return { continuar: false, motivo: "operador" };
	}
	if (cfg.intencaoOperador === "conversa") {
		return { continuar: false, motivo: "conversa" };
	}
	// Turno fora da operacao sem trabalho nenhum (saudacao, pergunta respondida
	// no texto): nao existe "proximo passo da fila" para retomar.
	if (cfg.assuntoDoTurno === "fora" && cfg.houveTrabalho !== true) {
		return { continuar: false, motivo: "sem-trabalho" };
	}
	// Sem entrega, nao ha o que retomar — qualquer que seja o assunto.
	//
	// Antes `houveTrabalho` tambem era verdadeiro para resposta com 400+
	// caracteres. Resultado medido: o operador perguntava uma coisa fora da
	// operacao, recebia uma resposta longa, e o runtime emendava "Continue.
	// retome o proximo passo tecnico da fila" — o "fica enviando pra continuar
	// mesmo sem ter nada a ver" que ele reportou. Texto nao e trabalho; tool
	// call e.
	//
	// Tri-estado: `undefined` = o chamador nao mediu (contrato antigo, mantido
	// para chamadas sem contexto de turno); `false` = mediu e nao houve tool
	// call, e ai nao existe proximo passo para retomar.
	if (cfg.houveTrabalho === false) {
		return { continuar: false, motivo: "sem-trabalho" };
	}
	if (iteracao >= max) {
		return { continuar: false, motivo: "teto" };
	}
	if (temMarcadorTerminal(texto, cfg.markers)) {
		return { continuar: false, motivo: "terminal" };
	}
	// Parada humana SO por marcador explicito (nunca por "?" no fim).
	const alvo = normaliza(texto).toUpperCase();
	if (MARCADORES_PARADA_HUMANA.some((m) => alvo.includes(m))) {
		return { continuar: false, motivo: "pergunta" };
	}
	// stopOnQuestion=true e opt-in (modo assistido), nunca default em autonomia.
	if (cfg.stopOnQuestion === true && pedeDecisaoHumana(texto)) {
		return { continuar: false, motivo: "pergunta" };
	}
	if (!normaliza(texto)) {
		return { continuar: false, motivo: "vazio" };
	}
	return { continuar: true };
}

/** Log curto e padronizado do loop (o operador ve no stdout). */
export function descreverContinuacao(iteracao: number, max: number): string {
	const teto = Number.isFinite(max) ? String(max) : "inf";
	return `[auto-continue] turno ${iteracao}/${teto} — retomando a fila`;
}
