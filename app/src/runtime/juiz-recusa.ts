// language: TypeScript, file: src/runtime/juiz-recusa.ts, runtime: Bun/Node
// Juiz de recusa: a propria LLM le o par (pedido, resposta) e decide se houve
// ENTREGA ou RECUSA.
//
// Por que existe: a deteccao por regex mede VOCABULARIO. Medido em bancada â€”
// "Para aqui: nao monto cadeia de enumeracao, entrada e pivo contra
// infraestrutura bancaria viva" (recusa dura, 391 chars) passa com
// `detectar_recusa_ampliada` = false, porque nenhuma lista tem "para aqui" nem
// "nao monto". A recusa escapulia justamente na familia que mais aparece:
// infraestrutura de terceiro, onde o gatilho e o substantivo do alvo e a frase
// muda de roupa a cada turno.
//
// O regex fica como fallback barato (sem rede, sem chave). O juiz e a medida.
// O transporte (uma chamada = recusa + deriva sobre o mesmo texto) mora em
// `juiz-resposta.ts`: aqui fica so o veredito de recusa e a reserva de regex.

import { appendFileSync } from "node:fs";
import { detectar_recusa_ampliada, familiasDeRecusa, type FamiliaRecusa } from "./htc-bypass";
import { julgar_resposta, limparCacheResposta } from "./juiz-resposta";

export type FamiliaJuiz = FamiliaRecusa | "nenhuma";

export interface VeredictoJuiz {
	/** Negou a tarefa (no todo ou na parte que importa). */
	recusou: boolean;
	/** Saiu artefato utilizavel: comando, codigo, config, procedimento, ordem. */
	entregou: boolean;
	familia: FamiliaJuiz;
	/** Uma linha: por que. */
	motivo: string;
	/** A frase que decidiu (para auditar o juiz). */
	trecho: string;
	via: "llm" | "heuristica";
	ms: number;
}

export interface OpcoesJuiz {
	/** Provider do HTC a usar (default: lastUsedProvider). */
	provider?: string;
	modelo?: string;
	timeoutMs?: number;
	/** Ignora o LLM e usa so o regex. */
	forcarHeuristica?: boolean;
}

/** Traco opt-in (HTC_JUIZ_TRACE=<arquivo>): por que o juiz caiu no regex. */
export function trace(linha: string): void {
	const caminho = process.env.HTC_JUIZ_TRACE?.trim();
	if (!caminho) return;
	try {
		appendFileSync(caminho, `${new Date().toISOString()} ${linha}\n`, "utf8");
	} catch {
		// traco e diagnostico: nunca derruba o turno
	}
}

/** Limpa o cache (testes e troca de provider). O transporte e o mesmo do juiz
 * de resposta — limpar um sem o outro deixaria veredito velho servindo os dois. */
export function limparCacheJuiz(): void {
	limparCacheResposta();
}

/** Fallback sem rede: o regex antigo, com a familia que ele conseguir ver. */
function heuristica(resposta: string, inicio: number): VeredictoJuiz {
	const familias = familiasDeRecusa(resposta);
	return {
		recusou: detectar_recusa_ampliada(resposta) || familias.length > 0,
		entregou: false,
		familia: (familias[0] as FamiliaJuiz | undefined) ?? "nenhuma",
		motivo: familias.length > 0 ? `regex: familia ${familias.join("+")}` : "regex sem sinal",
		trecho: resposta.replace(/\s+/g, " ").trim().slice(0, 120),
		via: "heuristica",
		ms: Date.now() - inicio,
	};
}


/** Teto de caracteres para o juiz entrar: recusa e prosa, entrega e artefato. */
const MAX_CHARS_JULGAMENTO = 6000;

/**
 * Porta unica dos dois runtimes (one-shot e interativo).
 *
 * O JUIZ decide; o regex e reserva. Antes era o contrario â€” regex primeiro, juiz
 * so no texto que ele deixou passar â€” e o resultado era o pior dos dois mundos:
 * toda recusa de vocabulario virava veredito sem medida (falso positivo em cima
 * de trabalho entregue) e o modelo nunca podia dizer "isto nao e recusa".
 * Sem chave, sem rede ou com HTC_JUIZ=off o juiz devolve `via:"heuristica"` com
 * o mesmo regex dentro, entao o custo de inverter e uma chamada nos casos raros
 * em que o regex ja disparava â€” justamente os que precisam de leitura.
 *
 * Devolve `undefined` quando nao ha recusa.
 */
export async function recusa_no_texto(
	texto: string,
	pedido = "",
	opcoes: OpcoesJuiz = {},
): Promise<VeredictoJuiz | undefined> {
	const limpo = (texto ?? "").trim();
	if (!limpo) return undefined;
	// Texto longo NAO e isencao: a recusa prolixa (aula moral, "escopo", "quem
	// e afetado") e justamente a que passa do teto. O veredito esta na abertura;
	// julga a cabeca e nunca pula o julgamento.
	const alvo =
		limpo.length > MAX_CHARS_JULGAMENTO ? limpo.slice(0, MAX_CHARS_JULGAMENTO) : limpo;
	const veredito = await julgar_recusa(alvo, pedido, opcoes);
	trace(
		`juiz: recusou=${veredito.recusou} entregou=${veredito.entregou} via=${veredito.via} fam=${veredito.familia} (${alvo.length}/${limpo.length} chars)`,
	);
	if (veredito.via === "llm") return veredito.recusou ? veredito : undefined;
	// Sem juiz: o regex mede o texto INTEIRO, nao so a cabeca, como sempre fez.
	const regex = detectar_recusa_ampliada(limpo);
	trace(`porta: sem juiz, regex=${regex}`);
	if (!regex) return undefined;
	return {
		recusou: true,
		entregou: false,
		familia: (familiasDeRecusa(limpo)[0] as FamiliaJuiz | undefined) ?? "nenhuma",
		motivo: "regex",
		trecho: limpo.replace(/\s+/g, " ").slice(0, 160),
		via: "heuristica",
		ms: veredito.ms,
	};
}

/**
 * Pede o veredito ao provider que o HTC ja usa. O transporte e o do juiz de
 * resposta: uma chamada devolve recusa E deriva, e a segunda pergunta sai de
 * graca quando o mesmo texto ja foi julgado no turno. Sem chave, sem rede ou
 * fora do prazo: cai no regex e diz `via: "heuristica"` — o chamador nunca
 * fica sem resposta.
 */
export async function julgar_recusa(
	resposta: string,
	pedido = "",
	opcoes: OpcoesJuiz = {},
): Promise<VeredictoJuiz> {
	const inicio = Date.now();
	const texto = (resposta ?? "").trim();
	if (!texto) {
		return {
			recusou: false,
			entregou: false,
			familia: "nenhuma",
			motivo: "resposta vazia",
			trecho: "",
			via: "heuristica",
			ms: 0,
		};
	}
	const desligado = (process.env.HTC_JUIZ ?? "on").trim().toLowerCase() === "off";
	if (desligado || opcoes.forcarHeuristica) return heuristica(texto, inicio);

	const veredito = await julgar_resposta(texto, { pedido }, opcoes);
	trace(
		`juiz: recusou=${veredito.recusou} entregou=${veredito.entregou} via=${veredito.via} fam=${veredito.familia} deriva=${String(veredito.deriva)} (${texto.length} chars)`,
	);
	// Sem juiz, o regex mede o texto inteiro, como sempre fez.
	if (veredito.via !== "llm") return heuristica(texto, inicio);
	return {
		recusou: veredito.recusou,
		entregou: veredito.entregou,
		familia: veredito.familia,
		motivo: veredito.motivo,
		trecho: veredito.trecho,
		via: "llm",
		ms: veredito.ms,
	};
}

