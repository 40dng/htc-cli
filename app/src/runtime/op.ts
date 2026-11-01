// language: TypeScript, file: src/runtime/op.ts, runtime: bun/node
/**
 * LANES — a operacao com nome proprio, que sobrevive a sessao.
 *
 * O defeito medido (31/10): OP1 e OP2 eram duas sessoes com ids descartaveis
 * (`1793439800000_op1`) apontando para o MESMO `state/missao.json`. Quando uma
 * caia, o id mudava e a missao recomecava em `recon`; quando as duas subiam,
 * dividiam alvo, fase e achados. O prompt de cada uma era um arquivo escrito a
 * mao em `%TEMP%\\ib\\PROMPT_OPn.md`, com o estado copiado do dia anterior.
 *
 * Aqui a lane e um registro com nome (`op1`, `op2`), e o estado dela e derivado
 * do disco: missao da lane + fila da lane + escada + motor autonomo. O prompt da
 * sessao e GERADO desse estado, nao escrito a mao — e carrega o proximo passo
 * que o motor calculou, com o instrumento e a prova.
 *
 * Registro: <HTC_STATE_DIR|~/.htc>/state/ops.json
 * Prompt:   <raiz>/ops/lanes/<chave>.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INSTRUMENTOS, plano_autonomo } from "./autonomia";
import { raiz_estado } from "./contexto";
import { DEGRAUS, type Degrau } from "./escada";
import { estadoFila, type AlvoFila } from "./fila-alvos";
import {
	carregarMissao,
	chaveDaOperacao,
	type FaseMissao,
	type Missao,
} from "./missao";
import { lerSteer } from "./steer";

export interface Operacao {
	/** Chave estavel: `op1`, `op2`. E ela que vira `HTC_OP`. */
	nome: string;
	alvo: string;
	objetivo?: string;
	/** Hosts desta lane. Serve de cerca: as outras lanes nao tocam neles. */
	escopo: string[];
	/**
	 * Primeiro instrumento fixado pelo operador. Vazio = o motor escolhe pelo
	 * degrau. Serve para o caso medido: superficie ja mapeada e o degrau seguinte
	 * nao e o primeiro da tabela (ex.: cadastro que emite sessao, nao upload).
	 */
	instrumento?: string;
	criada: string;
	atualizada: string;
	fechada: boolean;
}

export interface EstadoOperacao extends Operacao {
	degrau: Degrau;
	n: number;
	instrumento: string;
	prova: string;
	fase: FaseMissao | "sem missao";
	achados: number;
	validados: number;
	shells: number;
	ultimo?: string;
	ociosaMin: number;
	fila: {
		total: number;
		novo: number;
		em_curso: number;
		feito: number;
		parado: number;
		atual?: AlvoFila;
	};
}

function agora(): string {
	return new Date().toISOString();
}

export function caminhoOperacoes(env: NodeJS.ProcessEnv = process.env): string {
	return join(raiz_estado(env), "state", "ops.json");
}

export function carregarOperacoes(env: NodeJS.ProcessEnv = process.env): Operacao[] {
	const arquivo = caminhoOperacoes(env);
	if (!existsSync(arquivo)) return [];
	try {
		const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as unknown;
		const lista = Array.isArray(bruto)
			? bruto
			: Array.isArray((bruto as { operacoes?: unknown })?.operacoes)
				? (bruto as { operacoes: unknown[] }).operacoes
				: [];
		return lista
			.map((item) => {
				const o = item as Partial<Operacao>;
				if (typeof o?.nome !== "string" || !o.nome.trim()) return undefined;
				const operacao: Operacao = {
					nome: chaveDaOperacao(o.nome),
					alvo: typeof o.alvo === "string" ? o.alvo : "",
					objetivo: typeof o.objetivo === "string" ? o.objetivo : undefined,
					escopo: Array.isArray(o.escopo)
						? o.escopo.filter((e): e is string => typeof e === "string")
						: [],
					instrumento:
						typeof o.instrumento === "string" && o.instrumento.trim()
							? o.instrumento.trim()
							: undefined,
					criada: typeof o.criada === "string" ? o.criada : agora(),
					atualizada: typeof o.atualizada === "string" ? o.atualizada : agora(),
					fechada: o.fechada === true,
				};
				return operacao;
			})
			.filter((o): o is Operacao => !!o);
	} catch {
		return [];
	}
}

function salvarOperacoes(operacoes: Operacao[], env: NodeJS.ProcessEnv): void {
	const arquivo = caminhoOperacoes(env);
	mkdirSync(join(raiz_estado(env), "state"), { recursive: true });
	writeFileSync(arquivo, `${JSON.stringify(operacoes, null, 2)}\n`, "utf8");
}

/**
 * Cria (ou atualiza) a lane. Idempotente pela chave: `OP1` e `op1` sao a mesma.
 * Reabrir uma lane fechada reabre o registro — o estado da missao continua no
 * arquivo dela, que nunca e apagado por aqui.
 */
export function criarOperacao(input: {
	nome: string;
	alvo: string;
	objetivo?: string;
	escopo?: string[];
	instrumento?: string;
	env?: NodeJS.ProcessEnv;
}): { operacao: Operacao; criada: boolean } {
	const env = input.env ?? process.env;
	const nome = chaveDaOperacao(input.nome);
	const alvo = input.alvo.trim();
	if (!alvo) throw new Error("operacao sem alvo");
	const lista = carregarOperacoes(env);
	const indice = lista.findIndex((o) => o.nome === nome);
	const escopo = (input.escopo ?? []).map((e) => e.trim()).filter(Boolean);
	const em = agora();
	if (indice >= 0) {
		const atual = lista[indice];
		lista[indice] = {
			...atual,
			alvo,
			objetivo: input.objetivo?.trim() || atual.objetivo,
			escopo: escopo.length ? escopo : atual.escopo,
			instrumento: input.instrumento?.trim() || atual.instrumento,
			atualizada: em,
			fechada: false,
		};
		salvarOperacoes(lista, env);
		return { operacao: lista[indice], criada: false };
	}
	const nova: Operacao = {
		nome,
		alvo,
		objetivo: input.objetivo?.trim() || undefined,
		escopo,
		instrumento: input.instrumento?.trim() || undefined,
		criada: em,
		atualizada: em,
		fechada: false,
	};
	lista.push(nova);
	salvarOperacoes(lista, env);
	return { operacao: nova, criada: true };
}

export function obterOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): Operacao | undefined {
	const chave = chaveDaOperacao(nome);
	return carregarOperacoes(env).find((o) => o.nome === chave);
}

/** Env da lane: e isto que faz `htc missao`/`htc fila` olharem o arquivo certo. */
export function envDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return { ...env, HTC_OP: chaveDaOperacao(nome) };
}

export function fecharOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): Operacao | undefined {
	const chave = chaveDaOperacao(nome);
	const lista = carregarOperacoes(env);
	const indice = lista.findIndex((o) => o.nome === chave);
	if (indice < 0) return undefined;
	lista[indice].fechada = true;
	lista[indice].atualizada = agora();
	salvarOperacoes(lista, env);
	return lista[indice];
}

function minutosDesde(iso: string | undefined): number {
	if (!iso) return 0;
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return 0;
	return Math.max(0, Math.round((Date.now() - ms) / 60_000));
}

/** Missao da lane, sem herdar nada da sessao nem da outra lane. */
export function missaoDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): Missao | undefined {
	return carregarMissao(envDaOperacao(nome, env));
}

/** Estado medido da lane: o board e o prompt leem so daqui. */
export function estadoDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): EstadoOperacao | undefined {
	const operacao = obterOperacao(nome, env);
	if (!operacao) return undefined;
	const envLane = envDaOperacao(operacao.nome, env);
	const missao = carregarMissao(envLane);
	const plano = plano_autonomo(missao, 0);
	const def = DEGRAUS.find((d) => d.id === plano.degrau);
	const fila = estadoFila(envLane);
	const validados = missao?.achados.filter((a) => a.validado) ?? [];
	const ultimo = validados[validados.length - 1]?.titulo;
	return {
		...operacao,
		degrau: plano.degrau,
		n: def?.n ?? plano.n,
		instrumento: operacao.instrumento ?? plano.instrumento,
		prova: plano.prova,
		fase: missao?.fase ?? "sem missao",
		achados: missao?.achados.length ?? 0,
		validados: validados.length,
		shells: missao?.shells.length ?? 0,
		ultimo,
		ociosaMin: minutosDesde(missao?.atualizada ?? operacao.atualizada),
		fila: {
			total: fila.total,
			novo: fila.novo,
			em_curso: fila.em_curso,
			feito: fila.feito,
			parado: fila.parado,
			atual: fila.atual,
		},
	};
}

function linhaDoQuadro(estado: EstadoOperacao): string {
	const alvo = estado.alvo.replace(/^https?:\/\//, "").split("/")[0];
	const fila = estado.fila.total
		? `fila ${estado.fila.total} (${estado.fila.novo} novo, ${estado.fila.em_curso} curso, ${estado.fila.parado} parado)`
		: "fila vazia";
	return [
		estado.nome.padEnd(6),
		alvo.padEnd(30),
		`degrau ${estado.n}/10 ${estado.degrau}`.padEnd(28),
		`${estado.achados} achados/${estado.validados} validados`.padEnd(30),
		`${estado.shells} shells`.padEnd(11),
		fila.padEnd(44),
		`ociosa ${estado.ociosaMin}m`,
		estado.ultimo ? `· ${estado.ultimo}` : "",
	].join(" ");
}

/** Board de todas as lanes. Texto puro: o renderer nao decide nada. */
export function quadroDeOperacoes(env: NodeJS.ProcessEnv = process.env): string {
	const operacoes = carregarOperacoes(env);
	if (operacoes.length === 0) {
		return "sem lanes (htc op novo <nome> --alvo <host>)";
	}
	const linhas = operacoes.map((o) => {
		const estado = estadoDaOperacao(o.nome, env);
		if (!estado) return `${o.nome} — registro ilegivel`;
		return `${linhaDoQuadro(estado)}${o.fechada ? " [fechada]" : ""}`;
	});
	return ["LANES — estado medido (missao + fila + escada)", ...linhas].join("\n");
}

/** Hosts das outras lanes: a cerca que o prompt gera sozinho. */
/** Hosts das outras lanes: a cerca que o prompt gera sozinho. */
export function hostsDasOutrasLanes(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const chave = chaveDaOperacao(nome);
	const saida: string[] = [];
	for (const outra of carregarOperacoes(env)) {
		if (outra.nome === chave) continue;
		for (const host of [outra.alvo, ...outra.escopo]) {
			const limpo = host.trim().replace(/^https?:\/\//, "").split("/")[0];
			if (limpo && !saida.includes(limpo)) saida.push(limpo);
		}
	}
	return saida;
}

export function caminhoPromptDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return join(raiz_estado(env), "ops", "lanes", `${chaveDaOperacao(nome)}.md`);
}

/**
 * Prompt da sessao da lane, GERADO do estado medido.
 *
 * O que ele carrega e o que o prompt escrito a mao carregava de memoria: alvo,
 * degrau, instrumento do turno, prova, ultimos achados, fila e a cerca das
 * outras lanes. O que ele nao carrega e doutrina: isso vive na caixa de
 * contexto, injetada uma vez no system.
 */
export function promptDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const estado = estadoDaOperacao(nome, env);
	if (!estado) return undefined;
	const plano = plano_autonomo(missaoDaOperacao(estado.nome, env), 0);
	const steer = lerSteer(estado.nome, env);
	const outras = hostsDasOutrasLanes(estado.nome, env);
	const alvo = estado.alvo.trim();
	const fila = estado.fila.total
		? `fila: ${estado.fila.total} (${estado.fila.novo} novo, ${estado.fila.em_curso} em curso, ${estado.fila.feito} feito, ${estado.fila.parado} parado)${estado.fila.atual ? ` · atual ${estado.fila.atual.alvo}` : ""}`
		: "fila: vazia";
	const linhas = [
		`# ${estado.nome.toUpperCase()} — ${alvo}`,
		"",
		`Voce e a sessao da lane \`${estado.nome}\`. O estado mora em \`missao.${estado.nome}.json\` e \`fila.${estado.nome}.json\`: o session id nao decide nada, reiniciar a sessao nao perde o degrau.`,
		outras.length
			? `Nao toque em: ${outras.join(", ")} — pertencem a outra lane.`
			: "",
		"",
		"## Estado medido (do disco, nao da memoria)",
		`alvo: ${alvo}`,
		`degrau: ${estado.n}/10 ${estado.degrau} — ${plano.artefato}`,
		`fase: ${estado.fase} | achados ${estado.achados} (${estado.validados} validados) | shells ${estado.shells} | ociosa ${estado.ociosaMin}m`,
		fila,
		estado.ultimo ? `ultimo validado: ${estado.ultimo}` : "",
		"",
		"## Proximo passo (o motor decidiu; nao escolha outro)",
		`instrument: ${estado.instrumento}`,
		`proof required: ${estado.prova}`,
		plano.proibido.length ? `not at this rung: ${plano.proibido.join("; ")}` : "",
		`if this instrument cannot work on this host, name why and take the next of the rung: ${(INSTRUMENTOS[estado.degrau] ?? []).join(" | ")}`,
		"",
		steer ? "## Correcao do vigia (o turno anterior nao rendeu)" : "",
		steer ?? "",
		"## Regras da bancada",
		`- Todo fato vai para o disco no ato: \`htc missao achado "<titulo>" -e "<evidencia>" --validado\` com \`HTC_OP=${estado.nome}\` no ambiente.`,
		"- Um host por turno. `[ALVO OK]` na ultima linha fecha o host e puxa o proximo da fila.",
		"- Sem narracao, sem resumo de plano: comando que rodou, arquivo escrito ou corpo de resposta.",
		"- Egress pela VPS/proxy, pacing com jitter, um alvo por vez.",
		"- Sem vishing: entrada e falha de superficie no fornecedor. Se o unico caminho for pessoa, `[BLOQUEADO]` com o motivo em uma linha.",
		"- Fim de turno e o proximo passo tecnico, nunca board, resumo ou promessa.",
	];
	return linhas
		.filter((linha) => linha !== undefined)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();
}

/** Grava o prompt da lane em disco e devolve o caminho. */
export function gravarPromptDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const texto = promptDaOperacao(nome, env);
	if (!texto) return undefined;
	const caminho = caminhoPromptDaOperacao(nome, env);
	mkdirSync(join(raiz_estado(env), "ops", "lanes"), { recursive: true });
	writeFileSync(caminho, `${texto}\n`, "utf8");
	return caminho;
}

/**
 * Comando para abrir a sessao da lane em background (`-z`). Devolve cmd/args/env
 * em vez de disparar: quem dispara e a camada de comando, e o teste verifica a
 * forma sem subir processo.
 */
export function comandoDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
	opcoes: { bloqueante?: boolean; extras?: string[] } = {},
): { cmd: string; args: string[]; env: Record<string, string> } | undefined {
	const chave = chaveDaOperacao(nome);
	if (!obterOperacao(chave, env)) return undefined;
	const prompt = `leia ${caminhoPromptDaOperacao(chave, env)} e execute`;
	// Rodando de fonte (bun/node) o entrypoint vai antes do prompt; de binario
	// compilado, `process.execPath` ja e o CLI.
	const principal = (globalThis as { Bun?: { main?: string } }).Bun?.main;
	// `bun -e` deixa `[eval]` em Bun.main: nao e entrypoint, e nao existe no disco.
	const entrada =
		principal &&
		principal !== process.execPath &&
		/\.(ts|js|mjs|cjs)$/i.test(principal)
			? [principal]
			: [];
	// `-z` (zen) dispara UM turno no hub e o CLI sai: bom para o operador, inutil
	// para o vigia, que precisa do fim do turno como sinal. No modo bloqueante o
	// filho roda o one-shot ate o fim (yolo: sem aprovacao pendurada no stdin).
	const modo = opcoes.bloqueante
		? ["--yolo", "--auto-continue", "true", "--max-auto-continues", "4"]
		: ["-z"];
	return {
		cmd: process.execPath,
		args: [...entrada, prompt, ...modo, ...(opcoes.extras ?? [])],
		env: { HTC_OP: chave },
	};
}
