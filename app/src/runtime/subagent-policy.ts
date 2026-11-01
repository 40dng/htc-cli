/**
 * POLITICA DE GALHOS — agentes/subagentes como GALHOS da mesma arvore.
 *
 * O que a doc oficial diz:
 *  - `spawn_agent` (subagent): contexto proprio, devolve um RELATORIO ao agente
 *    principal e termina. O principal ESPERA e segue. Custo/uso entram na sessao.
 *  - `/team` (agent teams): task board + mailbox + mission log, persistidos em
 *    ~/.cline/data/db/teams.db; o time PERTENCE a sessao (resume por --id).
 *  - Preset `yolo` do core traz enableSpawnAgent/enableAgentTeams = FALSE.
 *
 * O que quebrava na nossa operacao (markdown/ANALISE_AGENTES.md):
 *  1. agente acha e NAO registra (texto puro como entrega) -> operador cego;
 *  2. contexto inchado (40 MB/log, 12M tokens/turno);
 *  3. trava silenciosa;
 *  4. nada de steer ao vivo.
 *
 * Esta politica responde aos 4, mantendo o galho BARATO (in-process, sem arvore
 * nova): o galho NAO herda o historico cru do pai, recebe UMA pergunta focada,
 * grava o detalhe no banco/disco e devolve um relatorio CURTO.
 */

export const MAX_LINHAS_RELATORIO_PADRAO = 12;

import { homedir } from "node:os";
import { join } from "node:path";
import { cauda_do_relatorio, caminho_relatorio, tamanho_relatorio } from "./subagent-relatorio";

/**
 * Abre o canal de relatorio de um galho. O pai guarda `offset` e chama `ler_delta`;
 * o filho escreve com `gravar_bloco`. Sem isso, o relatorio volta no contexto do pai e
 * o teto de linhas e paliativo.
 */
export function abrir_relatorio(
	base: string,
	sessao: string,
	id: string,
): { arquivo: string; offset: number } {
	const arquivo = caminho_relatorio(base, sessao, id);
	return { arquivo, offset: tamanho_relatorio(arquivo) };
}

/** Bloco que o pai injeta no proprio contexto: cauda do relatorio, nao o arquivo inteiro. */
export function relatorio_no_contexto(
	arquivo: string,
	linhas: number = MAX_LINHAS_RELATORIO_PADRAO,
): string {
	const cauda = cauda_do_relatorio(arquivo, linhas);
	if (!cauda) return "";
	return cauda;
}

export interface PoliticaAgentes {
	/** Liga spawn_agent (subsessao). Default: ligado. */
	enabled: boolean;
	/**
	 * Liga agent-teams (board + mailbox + mission log). Default: DESLIGADO.
	 *
	 * Medido em 30/10: 22 sessoes, 19 raiz — cada raiz nascia com um
	 * `team-XXXXX` proprio e so 3 subsessoes existiam. O time cobra board,
	 * mailbox e um time por sessao para trabalho que um galho resolve.
	 * Subsessao (spawn_agent) e o que entrega: contexto proprio, relatorio
	 * curto, custo na sessao do pai, sem linha extra no historico.
	 */
	teams: boolean;
	/** Teto de linhas do relatorio que o galho devolve ao pai. */
	maxReportLines: number;
	/** Exigir gravacao (finding/registro) antes de encerrar o turno. */
	gateObrigatorio: boolean;
	/** Ler o mailbox a cada elo (nao so a cada dominio). */
	steerCadaElo: boolean;
}

export const POLITICA_AGENTES_PADRAO: PoliticaAgentes = {
	enabled: true,
	teams: false,
	maxReportLines: MAX_LINHAS_RELATORIO_PADRAO,
	gateObrigatorio: true,
	steerCadaElo: true,
};

/**
 * Resolve a politica efetiva. `override` (flag --agents) vence; sem override o
 * default e LIGADO no modo autonomo (yolo/zen) — que e exatamente onde o preset
 * do core desliga e deixava a operacao sem galhos.
 *
 * Time so entra quando o operador pede: `HTC_TEAMS=1` ou `/team` na sessao.
 */
export function resolver_politica_agentes(
	modo: string,
	override?: boolean,
): PoliticaAgentes {
	const ligado = override ?? POLITICA_AGENTES_PADRAO.enabled;
	return {
		...POLITICA_AGENTES_PADRAO,
		enabled: ligado,
		teams: ligado && (process.env.HTC_TEAMS ?? "").trim() === "1",
	};
}

/** Bloco injetado no system prompt: as regras que fazem o galho prestar. */
export function instrucao_galhos(p: PoliticaAgentes = POLITICA_AGENTES_PADRAO): string {
	const linhas = [
		"GALHOS (subagentes/time) — voce e o galho, nao uma arvore nova:",
		"1. FACA NO ESPACO. Galho roda in-process, no mesmo workspace e na mesma sessao. NAO crie processo, servidor ou copia do projeto para 'explorar'. Nada de ramificar o ambiente.",
		"2. UMA PERGUNTA POR GALHO. Voce recebe UMA pergunta focada e responde ELA. Nao herde nem reproduza o historico do pai; se precisar de dado, leia do banco/disco.",
		"3. GATE DE REGISTRO (obrigatorio). Descobriu QUALQUER coisa? Grave ANTES de seguir (finding/creds/loot no banco) E dispare o report. Turno que descobre e nao grava NAO CONTA. Texto puro nao e entrega.",
		"4. RELATORIO CURTO. Devolva ao pai no maximo " +
			String(p.maxReportLines) +
			" linhas: o que achou, a evidencia curta e o proximo elo. O detalhe vai para o arquivo, nunca despejado no contexto.",
		"5. ARQUIVO DE RELATORIO. Detalhe completo em " +
			join(homedir(), ".htc", "state", "galhos") +
			"\\<sessao>\\<id>.relatorio, um bloco por linha. O pai le por offset: nao repita no retorno o que ja esta la.",
		"6. STEER AO VIVO. Leia o mailbox a cada elo, nao so por dominio.",
		"7. SEM ESPERA MORTA. Comando que nao retorna em segundos: abandone, registre o bloqueio e siga. Nunca fique parado esperando.",
		"8. GALHO FILHO. Se abrir outro galho, repita estas 8 regras na tarefa dele.",
		"9. PARALELISMO E POR SUBSSESSAO (spawn_agent), nao por sessao nova: subsessao herda o alvo, devolve relatorio e morre. Abrir sessao em background, processo extra ou time sem pedido e sujeira no historico — nao faca.",
	];
	if (!p.gateObrigatorio) {
		linhas[2] = "3. REGISTRO recomendado: grave o achado com evidencia curta.";
	}
	return linhas.join("\n");
}

/** Template de tarefa que o agente-pai usa ao abrir um galho (gate embutido). */
export function tarefa_do_galho(
	pergunta: string,
	evidenciaEsperada: string,
	proximoElo: string,
	relatorio?: string,
): string {
	const linhas = [
		`PERGUNTA (uma so): ${pergunta}`,
		`EVIDENCIA esperada: ${evidenciaEsperada}`,
		`PROXIMO ELO se confirmar: ${proximoElo}`,
		"Regras: faca no espaco (in-process), grave todo achado antes de encerrar, relatorio curto (<=12 linhas), leia o mailbox a cada elo, nada de espera morta.",
	];
	if (relatorio) {
		linhas.push(`RELATORIO: escreva cada bloco no arquivo ${relatorio} (o pai le por offset; nao despeje o texto inteiro no retorno).`);
	}
	return linhas.join("\n");
}
