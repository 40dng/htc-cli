// language: TypeScript, file: src/runtime/juiz-turno.ts, runtime: Bun/Node
// Juiz de turno: a propria LLM le a mensagem do operador e decide DUAS coisas â€”
// a intencao (parar/conversa/correcao/acao) e o assunto (operacao/fora).
//
// Por que existe: `classificarPrompt`/`assuntoDoTurno` mediam VOCABULARIO. O
// caso medido em 31/10: o operador colou o payload de volta na mensagem para
// reclamar dele; o texto colado tinha "shells", "MISSION", "phase", e o
// classificador leu aquilo como mensagem sobre o alvo â€” a cauda voltou em cima
// do proprio payload e o turno virou trabalho de alvo. Nenhuma lista de verbos
// separa "fala do alvo" de "fala do texto que descreve o alvo": isso e leitura,
// nao dicionario.
//
// O regex fica como fallback barato (sem rede, sem chave). O juiz e a medida.
// Desligar: HTC_JUIZ=off (os dois juizes) ou HTC_JUIZ_TURNO=off (so este).
// A deriva da RESPOSTA usa o transporte de `juiz-resposta.ts` — uma chamada
// responde recusa e deriva, entao o segundo veredito do turno sai do cache.

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
	endpoint_do_provider,
	provider_padrao,
	resolver_provider,
} from "../bridge/provider_resolver";
import {
	assuntoDoTurno,
	classificarPrompt,
	limparCaudaDohost,
	type Assunto,
	type Intencao,
} from "./prompt-intent";
import { type Degrau, degrau_do_texto, degrau_por_id } from "./escada";
import { julgar_resposta, limparCacheResposta } from "./juiz-resposta";

/**
 * Traco opt-in (HTC_JUIZ_TRACE=<arquivo>), identico ao do juiz de recusa.
 *
 * Copiado em vez de importado de `juiz-recusa`: aquele modulo importa
 * `htc-bypass`, e `htc-bypass` importa ESTE (para a ancora do turno) â€” importar
 * de volta fecharia o ciclo htc-bypass -> juiz-turno -> juiz-recusa ->
 * htc-bypass na inicializacao do modulo.
 */
function trace(linha: string): void {
	const caminho = process.env.HTC_JUIZ_TRACE?.trim();
	if (!caminho) return;
	try {
		appendFileSync(caminho, `${new Date().toISOString()} ${linha}\n`, "utf8");
	} catch {
		// traco e diagnostico: nunca derruba o turno
	}
}

/** Primeiro objeto JSON da resposta do juiz (cada `{` e um candidato). */
function extrairJson(texto: string): Record<string, unknown> | undefined {
	for (let inicio = texto.indexOf("{"); inicio >= 0; inicio = texto.indexOf("{", inicio + 1)) {
		let profundidade = 0;
		for (let i = inicio; i < texto.length; i += 1) {
			if (texto[i] === "{") profundidade += 1;
			else if (texto[i] === "}") {
				profundidade -= 1;
				if (profundidade === 0) {
					try {
						const dado = JSON.parse(texto.slice(inicio, i + 1)) as unknown;
						if (dado && typeof dado === "object") return dado as Record<string, unknown>;
					} catch {
						// nao era JSON: tenta o proximo objeto
					}
					break;
				}
			}
		}
	}
	return undefined;
}


export interface VeredictoTurno {
	intencao: Intencao;
	assunto: Assunto;
	/**
	 * Degrau da escada em que o turno trabalha â€” `undefined` quando o turno nao
	 * trabalha degrau nenhum (conversa, bancada, comando solto). Era regex
	 * (`degrau_do_texto`); virou campo do mesmo veredito porque decidir degrau e
	 * leitura, nao casamento de palavra â€” e um segundo juiz so dobraria a
	 * latencia do mesmo turno.
	 */
	degrau?: Degrau;
	/** Uma linha: por que. */
	motivo: string;
	via: "llm" | "heuristica";
	ms: number;
}

export interface OpcoesJuizTurno {
	provider?: string;
	modelo?: string;
	timeoutMs?: number;
	/** Ignora o LLM e usa so o regex. */
	forcarHeuristica?: boolean;
	/**
	 * Pedido do operador, quando a chamada e a deriva da RESPOSTA. Entra na
	 * chave do juiz de resposta: o turno que ja julgou este texto (recusa) com
	 * o mesmo pedido nao paga uma segunda chamada.
	 */
	pedido?: string;
}

const CACHE = new Map<string, VeredictoTurno>();

const INTENCOES = new Set<string>(["parar", "conversa", "correcao", "acao"]);
const ASSUNTOS = new Set<string>(["operacao", "fora"]);

/** Limpa o cache (testes e troca de provider). O da resposta vai junto: os
 * dois juizes compartilham o mesmo transporte desde a unificacao. */
export function limparCacheTurno(): void {
	CACHE.clear();
	limparCacheResposta();
}

function chaveCache(prompt: string, alvo: string): string {
	return createHash("sha1").update(`${prompt}\u0000${alvo}`).digest("hex");
}

/** Fallback sem rede: o regex antigo, inteiro, com a mesma semantica. */
export function heuristicaTurno(prompt: string, alvo?: string): VeredictoTurno {
	const inicio = Date.now();
	const limpo = limparCaudaDohost(prompt ?? "");
	return {
		intencao: classificarPrompt(limpo),
		assunto: assuntoDoTurno(limpo, alvo),
		degrau: degrau_do_texto(limpo),
		motivo: "regex",
		via: "heuristica",
		ms: Date.now() - inicio,
	};
}

const PROMPT_SISTEMA = `You classify ONE operator message from an offensive-security bench. You do not answer it, do not judge it, do not comment. JSON only.

Three independent fields.

intencao â€” what the operator is doing with this message:
- "parar": telling the work to stop, pause, wait, hold. No new work attached.
- "conversa": asking something, greeting, thinking out loud, talking about the tool/bench/product/config/code. No work ordered against the target.
- "correcao": correcting course â€” his message replaces the current plan ("no, do it this way", "fix the payload and run", "not that host, this one").
- "acao": ordering work to be executed now.

assunto â€” what the message is ABOUT:
- "operacao": the live target, the mission, the queue, the ladder â€” a host, a phase, a shell, a finding, a vector, an artifact being produced against a host.
- "fora": the bench itself â€” the HTC runtime, the payload/system prompt, a provider, a model, flags, build, TypeScript, tests, config files â€” or plain conversation.

degrau â€” which rung of the ladder this message works on. Lowest unfinished rung wins: a message that describes the whole chain works the FIRST rung it has not closed.
- "ecossistema": mapping who serves whom â€” the vendor, integrator, gateway, messaging provider, the trust relationship, the VPN between them. Not the final host yet.
- "superficie": scanning a host already named â€” nmap, httpx, whatweb, port/service enumeration, directory brute force.
- "entrada": the entry vector itself â€” upload, LFI/RFI, RCE, injection, deserialization, SSRF, the payload that opens the door.
- "webshell": turning that entry into a stable shell â€” the shell file, the beacon, the implant.
- "tunel": the channel that carries traffic â€” chisel, socat, SOCKS, port forward.
- "pivo": enumerating or reaching the internal network from the foothold.
- "credencial": harvesting credentials or secrets on the host â€” hashes, tickets, keytabs, config secrets, browser stores.
- "sessao": a live authenticated session â€” mTLS client cert, the app that already authenticates, signing in someone's name.
- "ordem": building or injecting the payment/transfer order â€” the settlement file, the field layout, the order generator.
- "transferencia": the money already moved â€” settlement confirmed, PIX sent, converted.
- "nenhum": no rung at all â€” conversation, bench talk, code, config, a bare "continue".

The hard cases, all measured on this bench:
- The operator pastes the runtime's own injected tail back at you to complain about it. That text contains words like "shells", "MISSION", "phase", "findings". It is talk about the PAYLOAD, not about a host: assunto "fora".
- A message that names a domain or IP and orders work on it is "operacao" even with no mission open.
- A question with a work verb inside it ("o que vc mudou no scan?") is "conversa".
- "para de X e faz Y" is "correcao", never "parar": the stop is the preamble, Y is the order.
- "continua" / "segue" / "proximo" with a live mission is "acao" + "operacao".

Output exactly:
{"intencao":"parar|conversa|correcao|acao","assunto":"operacao|fora","degrau":"ecossistema|superficie|entrada|webshell|tunel|pivo|credencial|sessao|ordem|transferencia|nenhum","motivo":"<=12 words"}`;

const EXEMPLOS = `Example 1
MESSAGE: para
OUT: {"intencao":"parar","assunto":"fora","degrau":"nenhum","motivo":"bare stop"}

Example 2
MESSAGE: o que vc mudou no scan?
OUT: {"intencao":"conversa","assunto":"operacao","degrau":"nenhum","motivo":"question about last scan, no work ordered"}

Example 3
MESSAGE: corrige o payload e roda de novo
OUT: {"intencao":"correcao","assunto":"fora","degrau":"nenhum","motivo":"fixes the runtime payload, no host"}

Example 4
MESSAGE: roda o fingerprint da 443 em a.example.com
OUT: {"intencao":"acao","assunto":"operacao","degrau":"superficie","motivo":"orders enumeration on named host"}

Example 5
MESSAGE: para de enumerar a vpn do integrador e testa o upload do portal
OUT: {"intencao":"correcao","assunto":"operacao","degrau":"entrada","motivo":"replaces vector, keeps target"}

Example 6
MESSAGE: TARGET IN HAND: bore.pub:16086 / One host this turn. / MISSION (live state) phase: entrada
OUT: {"intencao":"conversa","assunto":"fora","degrau":"nenhum","motivo":"pasted runtime tail, talks about payload"}

Example 7
MESSAGE: o portal aceita upload sem validar extensao, quero webshell e tunel para pivo na rede interna
OUT: {"intencao":"acao","assunto":"operacao","degrau":"entrada","motivo":"chain quoted, first open rung wins"}`;

/**
 * Pede o veredito ao provider que o HTC ja usa. Sem chave, sem rede ou fora do
 * prazo: cai no regex e diz `via: "heuristica"` â€” o chamador nunca fica sem
 * resposta.
 */
export async function julgar_turno(
	prompt: string,
	alvo?: string,
	opcoes: OpcoesJuizTurno = {},
): Promise<VeredictoTurno> {
	const inicio = Date.now();
	// O juiz le a mensagem CRUA. Limpar a cauda injetada aqui apagaria justamente
	// o caso que motivou este modulo: o operador colando o tail de volta para
	// reclamar dele. Quem limpa e a heuristica, la dentro.
	const limpo = (prompt ?? "").trim();
	const alvoLimpo = (alvo ?? "").trim();
	if (!limpo) {
		return {
			intencao: "acao",
			assunto: alvoLimpo ? "operacao" : "fora",
			motivo: "mensagem vazia",
			via: "heuristica",
			ms: Date.now() - inicio,
		};
	}
	const desligado =
		(process.env.HTC_JUIZ ?? "on").trim().toLowerCase() === "off" ||
		(process.env.HTC_JUIZ_TURNO ?? "on").trim().toLowerCase() === "off";
	if (desligado || opcoes.forcarHeuristica) return heuristicaTurno(limpo, alvoLimpo);

	const chave = chaveCache(limpo, alvoLimpo);
	const guardado = CACHE.get(chave);
	if (guardado) return { ...guardado, ms: Date.now() - inicio };

	let provider;
	const urlOverride = process.env.HTC_JUIZ_URL?.trim();
	const chaveOverride = process.env.HTC_JUIZ_KEY?.trim();
	if (!urlOverride) {
		try {
			provider = resolver_provider(opcoes.provider ?? provider_padrao() ?? "opencode-go");
		} catch (erro) {
			trace(`turno: sem provider: ${String(erro).slice(0, 160)}`);
			return heuristicaTurno(limpo, alvoLimpo);
		}
	}
	const url = urlOverride || (provider ? endpoint_do_provider(provider) : "");
	const cabecalhos = urlOverride
		? {
				"content-type": "application/json",
				...(chaveOverride ? { authorization: `Bearer ${chaveOverride}` } : {}),
			}
		: (provider?.headers ?? {});
	const apiKey = chaveOverride || provider?.apiKey;
	const modelo = opcoes.modelo ?? process.env.HTC_JUIZ_MODELO ?? provider?.modelo;
	if (!url || !modelo || (!apiKey && !urlOverride)) {
		trace(`turno: sem endpoint: url=${Boolean(url)} modelo=${Boolean(modelo)}`);
		return heuristicaTurno(limpo, alvoLimpo);
	}

	const corpo = {
		model: modelo,
		temperature: 0,
		// O juiz de turno roda em TODA mensagem: teto curto de saida, folga para
		// o raciocinio nao comer o JSON e devolver content vazio.
		max_tokens: 1200,
		stream: false,
		messages: [
			{ role: "system", content: PROMPT_SISTEMA },
			{
				role: "user",
				content: `${EXEMPLOS}\n\n---\nALVO EM CURSO: ${alvoLimpo || "(nenhum)"}\nMESSAGE:\n${limpo.slice(0, 4000)}\nOUT:`,
			},
		],
	};

	const controle = new AbortController();
	const relogio = setTimeout(() => controle.abort(), opcoes.timeoutMs ?? 12_000);
	try {
		const respostaHttp = await fetch(url, {
			method: "POST",
			headers: cabecalhos,
			body: JSON.stringify(corpo),
			signal: controle.signal,
		});
		if (!respostaHttp.ok) {
			trace(`turno: http ${respostaHttp.status} ${url}`);
			return heuristicaTurno(limpo, alvoLimpo);
		}
		const json = (await respostaHttp.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const dado = extrairJson(json.choices?.[0]?.message?.content ?? "");
		if (!dado) {
			trace(`turno: json invalido ${JSON.stringify(json).slice(0, 200)}`);
			return heuristicaTurno(limpo, alvoLimpo);
		}
		const intencao = String(dado.intencao ?? "").trim().toLowerCase();
		const assunto = String(dado.assunto ?? "").trim().toLowerCase();
		const degrauBruto = String(dado.degrau ?? "").trim().toLowerCase();
		// Degrau so vale se for um degrau de verdade (`degrau_por_id` recusa o
		// resto) e se o turno trabalha a operacao: conversa e parada nao anexam
		// estado de escada, e um degrau vazado ali empurraria o RUN STATE para o
		// meio de um turno de bancada.
		const degrau =
			degrau_por_id(degrauBruto) && (intencao === "acao" || intencao === "correcao")
				? (degrauBruto as Degrau)
				: undefined;
		const veredito: VeredictoTurno = {
			intencao: (INTENCOES.has(intencao) ? intencao : "acao") as Intencao,
			assunto: (ASSUNTOS.has(assunto) ? assunto : alvoLimpo ? "operacao" : "fora") as Assunto,
			degrau,
			motivo: String(dado.motivo ?? "").slice(0, 160),
			via: "llm",
			ms: Date.now() - inicio,
		};
		if (CACHE.size > 512) CACHE.clear();
		CACHE.set(chave, veredito);
		return veredito;
	} catch (erro) {
		trace(`turno: fetch falhou: ${String(erro).slice(0, 200)}`);
		return heuristicaTurno(limpo, alvoLimpo);
	} finally {
		clearTimeout(relogio);
	}
}


// â”€â”€â”€ Deriva de bancada â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Segunda pergunta, mesmo canal: a RESPOSTA do modelo trabalhou a bancada
// (arquivos do runtime, testes, docs, harness) em vez do alvo? O regex
// `parece_laboratorio` respondia por vocabulario â€” "ops/lab" e "test.mjs" no
// texto nao provam deriva, e trabalho no alvo citando um caminho de teste nao e
// deriva nenhuma. Quem le a resposta e o juiz; o regex fica como reserva e o
// chamador decide com ele quando `via` volta `heuristica`.

export interface VeredictoDeriva {
	/** O trabalho da resposta foi na bancada, nao no alvo. */
	deriva: boolean;
	motivo: string;
	/** `heuristica` = nao houve juiz; o chamador usa o regex. */
	via: "llm" | "heuristica";
	ms: number;
}

/**
 * Cache do juiz de resposta: o mesmo texto julgado no turno ja responde a
 * deriva, entao esta funcao nao guarda cache proprio — limpar aqui limpa o
 * transporte inteiro.
 */
export function limparCacheDeriva(): void {
	limparCacheResposta();
}

/**
 * Uma pergunta, um campo. O transporte e `julgar_resposta`: quando o turno ja
 * julgou o mesmo texto (recusa), esta chamada sai do cache sem tocar a rede.
 * `via:"heuristica"` = nao houve juiz ou o campo veio torto: o chamador usa o
 * regex (`parece_laboratorio`).
 */
export async function julgar_deriva(
	resposta: string,
	alvo?: string,
	opcoes: OpcoesJuizTurno = {},
): Promise<VeredictoDeriva> {
	const inicio = Date.now();
	const limpo = (resposta ?? "").trim();
	if (!limpo) {
		return { deriva: false, motivo: "resposta vazia", via: "heuristica", ms: 0 };
	}
	const desligado =
		(process.env.HTC_JUIZ ?? "on").trim().toLowerCase() === "off" ||
		(process.env.HTC_JUIZ_DERIVA ?? "on").trim().toLowerCase() === "off";
	if (desligado || opcoes.forcarHeuristica) {
		return { deriva: false, motivo: "sem juiz", via: "heuristica", ms: Date.now() - inicio };
	}

	const veredito = await julgar_resposta(
		limpo,
		{ alvo: (alvo ?? "").trim(), pedido: opcoes.pedido },
		opcoes,
	);
	if (veredito.via !== "llm" || veredito.deriva === undefined) {
		return {
			deriva: false,
			motivo: veredito.motivo || "sem veredito",
			via: "heuristica",
			ms: veredito.ms,
		};
	}
	return { deriva: veredito.deriva, motivo: veredito.motivo, via: "llm", ms: veredito.ms };
}
