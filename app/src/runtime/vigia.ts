// language: TypeScript, file: src/runtime/vigia.ts, runtime: bun/node
/**
 * VIGIA — o supervisor de uma lane, para operacao sem operador.
 *
 * O defeito que isto fecha: uma sessao `-z` dispara UM turno e morre. Ninguem
 * olha o resultado, ninguem regenera o prompt com o estado novo, ninguem mata
 * turno travado. Deixar "a OP1 ligada" era deixar um turno so, e acordar com o
 * mesmo degrau e a mesma contagem.
 *
 * O vigia roda em volta do CLI, nao dentro dele:
 *   1. le o estado do disco (missao da lane + fila + escada),
 *   2. REGENERA o prompt da lane a partir desse estado (o proximo instrumento do
 *      motor, com prova e proibicoes),
 *   3. dispara um turno one-shot bloqueante com `HTC_OP=<lane>`,
 *   4. mede o delta no disco (achados/validados/shells/degrau),
 *   5. decide: continuar, corrigir por steer, ou parar,
 *   6. grava tudo (turno, log, relatorio) para o operador ler ao acordar.
 *
 * Por que processo filho e nao in-process: turno travado mata so o filho; o
 * vigia sobrevive, registra o timeout e parte para o proximo. Um crash do turno
 * nao pode ser um crash da noite inteira.
 *
 * Nao confundir com `supervisor.ts`: aquele vigia UMA execucao (batimento,
 * freeze, kill, relancamento com `--id`). Este vigia a LANE, entre execucoes.
 * O turno do vigia roda com `HTC_SUPERVISOR=off` — relancamento destacado
 * escaparia do teto e poria dois turnos no mesmo estado.
 *
 * Estado: <raiz>/ops/lanes/<chave>.{turnos.jsonl,vigia.log,steer,fim,lock,relatorio.md}
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { INSTRUMENTOS } from "./autonomia";
import { estadoDaOperacao, gravarPromptDaOperacao } from "./op";
import { abrirMissao, carregarMissao, chaveDaOperacao } from "./missao";
import {
	caminhoDaPista,
	dirLanes,
	escreverSteer,
	limparSteer,
} from "./steer";

export interface EstadoTurno {
	degrau: string;
	n: number;
	fase: string;
	achados: number;
	validados: number;
	shells: number;
	ultimo?: string;
}

export interface Turno {
	n: number;
	inicio: string;
	ms: number;
	/** 0 ok, !=0 falha do CLI, null = morto por sinal. */
	codigo: number | null;
	timeout: boolean;
	antes: EstadoTurno;
	depois: EstadoTurno;
	delta: { achados: number; validados: number; shells: number; degrau: boolean };
	/** Turno que mudou o disco. Sem artefato = girou em falso. */
	artefato: boolean;
}

export interface Decisao {
	acao: "continuar" | "parar";
	motivo: string;
	/** Instrucao que entra no prompt do turno seguinte. */
	steer?: string;
	esperaMs: number;
}

export interface ContextoDoTurno {
	nome: string;
	n: number;
	promptPath: string;
	prazoMs: number;
	env: NodeJS.ProcessEnv;
}

export interface OpcoesVigia {
	horas: number;
	turnos: number;
	tetoTurnoMs: number;
	intervaloMs: number;
	/** Turnos secos consecutivos antes de steer de bloqueio. */
	limiteSecos: number;
	executar: (ctx: ContextoDoTurno) => Promise<{ codigo: number | null; timeout: boolean }>;
	agora?: () => number;
	dormir?: (ms: number) => Promise<void>;
	log?: (linha: string) => void;
}

export interface ResultadoVigia {
	nome: string;
	motivo: string;
	turnos: Turno[];
	horas: number;
}

export function caminhoTurnos(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return caminhoDaPista(nome, env, "turnos.jsonl");
}

export function caminhoLogVigia(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return caminhoDaPista(nome, env, "vigia.log");
}

export function caminhoRelatorio(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return caminhoDaPista(nome, env, "relatorio.md");
}

export function lerTurnos(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): Turno[] {
	const arquivo = caminhoTurnos(nome, env);
	if (!existsSync(arquivo)) return [];
	const linhas = readFileSync(arquivo, "utf8").split(/\r?\n/);
	const turnos: Turno[] = [];
	for (const linha of linhas) {
		const bruta = linha.trim();
		if (!bruta.startsWith("{")) continue;
		try {
			turnos.push(JSON.parse(bruta) as Turno);
		} catch {
			// linha truncada por kill no meio da escrita: ignora, o resto vale
		}
	}
	return turnos;
}

export function registrarTurno(
	nome: string,
	turno: Turno,
	env: NodeJS.ProcessEnv = process.env,
): void {
	mkdirSync(dirLanes(env), { recursive: true });
	appendFileSync(caminhoTurnos(nome, env), `${JSON.stringify(turno)}\n`, "utf8");
}

export function registrarLog(
	nome: string,
	linha: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	mkdirSync(dirLanes(env), { recursive: true });
	appendFileSync(
		caminhoLogVigia(nome, env),
		`${new Date().toISOString()} ${linha}\n`,
		"utf8",
	);
}
/** Sequencia de turnos sem artefato no fim do historico (retomada conta). */
export function turnosSecos(turnos: Turno[]): number {
	let secos = 0;
	for (let i = turnos.length - 1; i >= 0; i -= 1) {
		if (turnos[i].artefato) break;
		secos += 1;
	}
	return secos;
}

export function estadoDoTurno(estado: {
	degrau: string;
	n: number;
	fase: string;
	achados: number;
	validados: number;
	shells: number;
	ultimo?: string;
}): EstadoTurno {
	return {
		degrau: estado.degrau,
		n: estado.n,
		fase: estado.fase,
		achados: estado.achados,
		validados: estado.validados,
		shells: estado.shells,
		ultimo: estado.ultimo,
	};
}

export function calcularDelta(
	antes: EstadoTurno,
	depois: EstadoTurno,
): Turno["delta"] {
	return {
		achados: depois.achados - antes.achados,
		validados: depois.validados - antes.validados,
		shells: depois.shells - antes.shells,
		degrau: depois.degrau !== antes.degrau,
	};
}

/** Steer de bloqueio: o instrumento nao rende, o turno seguinte muda de vetor. */
export function steerDeBloqueio(estado: EstadoTurno, secos: number): string {
	const proximos = (
		INSTRUMENTOS[estado.degrau as keyof typeof INSTRUMENTOS] ?? []
	)
		.filter((instrumento) => instrumento !== estado.ultimo)
		.slice(0, 3)
		.join(" | ");
	return [
		`Sem artefato ha ${secos} turnos no degrau ${estado.n}/10 ${estado.degrau}.`,
		"O instrumento atual nao esta rendendo: nomeie o motivo em UMA linha, grave como achado e pegue o proximo vetor do mesmo degrau.",
		proximos
			? `Vetores deste degrau: ${proximos}.`
			: "Nao ha outro vetor neste degrau: o degrau esta BLOQUEADO — registre o motivo e pare de repetir.",
		"Nao repita o mesmo comando sem mudar um parametro medido: comando que falhou duas vezes nao vira evidencia na terceira.",
	].join(" ");
}

/** Steer de disciplina: degrau subiu sem prova no disco. */
export function steerDeProva(antes: EstadoTurno, depois: EstadoTurno): string {
	return [
		`O degrau subiu de ${antes.n}/10 ${antes.degrau} para ${depois.n}/10 ${depois.degrau} sem validados novos.`,
		"Escalar sem prova e o erro que custa a noite inteira: volte ao degrau anterior e prove com execucao ou escrita observada antes de subir de novo.",
	].join(" ");
}

export function sinalDeFim(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return existsSync(caminhoDaPista(nome, env, "fim"));
}

/**
 * Lane nova nao tem missao: o turno acorda com `fase: sem missao`, zero degrau
 * e zero prova, e gasta o primeiro turno so descobrindo onde gravar. Abre a
 * missao da lane a partir do alvo/objetivo/escopo registrados, uma vez.
 */
export function garantirMissaoDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	const chave = chaveDaOperacao(nome);
	const estado = estadoDaOperacao(chave, env);
	if (!estado) return;
	const envLane = { ...env, HTC_OP: chave };
	if (carregarMissao(envLane)) return;
	abrirMissao({
		alvo: estado.alvo,
		objetivo: estado.objetivo,
		escopo: estado.escopo,
		env: envLane,
	});
}

export interface EntradaDecisao {
	antes: EstadoTurno;
	depois: EstadoTurno;
	secos: number;
	limiteSecos: number;
	laneFechada: boolean;
	missaoFechada: boolean;
	fim: boolean;
	restanteMs: number;
	turnosRestantes: number;
	intervaloMs: number;
	timeout: boolean;
	/** Turno terminou com codigo != 0: falha de infraestrutura, nao de metodo. */
	falhou: boolean;
	/** Falhas consecutivas ate aqui (inclui esta). */
	falhas: number;
}

/**
 * A decisao do vigia, pura: mesma entrada, mesma saida, testavel sem processo.
 * A ordem importa — parada antes de correcao (nao se corrige o que vai acabar),
 * prova antes de bloqueio (subir sem prova e o erro mais caro).
 */
export function decidirTurno(entrada: EntradaDecisao): Decisao {
	const parar = (motivo: string): Decisao => ({
		acao: "parar",
		motivo,
		esperaMs: 0,
	});
	if (entrada.fim) return parar("parada sinalizada pelo operador (.fim)");
	if (entrada.laneFechada) return parar("lane fechada");
	if (entrada.missaoFechada) return parar("missao fechada — objetivo encerrado");
	if (entrada.restanteMs <= 0) return parar("prazo do vigia esgotado");
	if (entrada.turnosRestantes <= 0) return parar("teto de turnos atingido");
	// Falha de infraestrutura (provider, cota, CLI) nao e sinal de metodo: nao
	// gera steer nem conta como turno seco. Insiste com espera maior; cinco
	// falhas seguidas param a lane em vez de girar a noite inteira em erro.
	if (entrada.falhou) {
		if (entrada.falhas >= 5) {
			return parar(`CLI falhou ${entrada.falhas} turnos seguidos`);
		}
		return {
			acao: "continuar",
			motivo: `turno falhou (${entrada.falhas} seguidos)`,
			esperaMs: Math.max(entrada.intervaloMs, 60_000),
		};
	}
	if (entrada.depois.degrau !== entrada.antes.degrau && entrada.depois.validados <= entrada.antes.validados) {
		return {
			acao: "continuar",
			motivo: "degrau sem prova",
			steer: steerDeProva(entrada.antes, entrada.depois),
			esperaMs: entrada.intervaloMs,
		};
	}
	if (entrada.timeout) {
		return {
			acao: "continuar",
			motivo: "turno estourou o teto",
			steer: [
				`O turno estourou o teto de tempo no degrau ${entrada.depois.n}/10 ${entrada.depois.degrau}.`,
				"Comando que nao retorna em segundos e comando errado: reduza o escopo, use timeout explicito e registre o bloqueio antes de tentar de novo.",
			].join(" "),
			esperaMs: entrada.intervaloMs,
		};
	}
	if (entrada.secos >= entrada.limiteSecos) {
		return {
			acao: "continuar",
			motivo: `${entrada.secos} turnos secos`,
			steer: steerDeBloqueio(entrada.depois, entrada.secos),
			esperaMs: entrada.intervaloMs,
		};
	}
	return {
		acao: "continuar",
		motivo: "ok",
		esperaMs: entrada.intervaloMs,
	};
}

function hora(iso: string | undefined): string {
	if (!iso) return "-";
	const data = new Date(iso);
	if (Number.isNaN(data.getTime())) return "-";
	return data.toISOString().slice(11, 16);
}

/**
 * Relatorio para o operador ler ao acordar: o que cada turno mudou, o que
 * sobrou no disco, onde parou e qual e o proximo passo tecnico.
 */
export function relatorioDaOperacao(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const chave = chaveDaOperacao(nome);
	const estado = estadoDaOperacao(chave, env);
	const missao = carregarMissao({ ...env, HTC_OP: chave });
	const turnos = lerTurnos(chave, env);
	const ultimo = turnos[turnos.length - 1];
	const linhas: string[] = [];
	linhas.push(`# ${chave.toUpperCase()} — relatorio do vigia`);
	linhas.push("");
	if (!estado) {
		linhas.push("lane desconhecida no registro de operacoes");
		return linhas.join("\n");
	}
	linhas.push(`alvo: ${estado.alvo}`);
	linhas.push(
		`degrau: ${estado.n}/10 ${estado.degrau} | fase: ${estado.fase} | achados ${estado.achados} (${estado.validados} validados) | shells ${estado.shells}`,
	);
	linhas.push(
		`missao: ${missao ? (missao.fechada ? "fechada" : "aberta") : "sem missao"} | lane: ${estado.fechada ? "fechada" : "aberta"}`,
	);
	linhas.push(
		`turnos registrados: ${turnos.length}${ultimo ? ` | ultimo em ${hora(ultimo.inicio)} (${Math.round(ultimo.ms / 1000)}s)` : ""}`,
	);
	linhas.push("");
	linhas.push("## Turnos");
	if (turnos.length === 0) {
		linhas.push("nenhum turno registrado");
	} else {
		linhas.push("| n | inicio | dur | cod | achados | validados | shells | degrau |");
		linhas.push("|---|--------|-----|-----|---------|-----------|--------|--------|");
		for (const turno of turnos) {
			const codigo = turno.timeout ? "TIMEOUT" : String(turno.codigo ?? "-");
			linhas.push(
				`| ${turno.n} | ${hora(turno.inicio)} | ${Math.round(turno.ms / 1000)}s | ${codigo} | +${turno.delta.achados} | +${turno.delta.validados} | +${turno.delta.shells} | ${turno.depois.n} ${turno.depois.degrau} |`,
			);
		}
	}
	linhas.push("");
	linhas.push("## Achados no disco");
	if (!missao || missao.achados.length === 0) {
		linhas.push("nenhum");
	} else {
		for (const achado of missao.achados.slice(-12)) {
			linhas.push(
				`- ${achado.validado ? "[validado]" : "[hipotese]"} ${achado.titulo}${achado.evidencia ? ` — ${achado.evidencia.slice(0, 160)}` : ""}`,
			);
		}
	}
	linhas.push("");
	linhas.push("## Proximo passo");
	linhas.push(`instrumento: ${estado.instrumento}`);
	linhas.push(`prova exigida: ${estado.prova}`);
	linhas.push("");
	linhas.push("## Arquivos");
	linhas.push(`prompt: ${caminhoDaPista(chave, env, "md")}`);
	linhas.push(`turnos: ${caminhoTurnos(chave, env)}`);
	linhas.push(`log: ${caminhoLogVigia(chave, env)}`);
	return linhas.join("\n");
}

export function gravarRelatorio(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const caminho = caminhoRelatorio(nome, env);
	mkdirSync(dirLanes(env), { recursive: true });
	writeFileSync(caminho, `${relatorioDaOperacao(nome, env)}\n`, "utf8");
	return caminho;
}

/**
 * O laco. Um turno por vez, sempre com o prompt regenerado do estado que o
 * turno anterior deixou. Nao paraleliza dentro da lane: dois turnos na mesma
 * lane escrevem no mesmo `missao.<lane>.json` e o segundo apaga o primeiro.
 */
export async function vigiar(
	nome: string,
	opcoes: OpcoesVigia,
): Promise<ResultadoVigia> {
	const chave = chaveDaOperacao(nome);
	const env: NodeJS.ProcessEnv = { ...process.env, HTC_OP: chave };
	const agora = opcoes.agora ?? (() => Date.now());
	const dormir =
		opcoes.dormir ??
		((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms)));
	const log = opcoes.log ?? ((linha: string) => registrarLog(chave, linha, env));
	const inicioMs = agora();
	const prazo = inicioMs + opcoes.horas * 3_600_000;
	let secos = turnosSecos(lerTurnos(chave, env));
	let falhas = 0;
	const feitos: Turno[] = [];
	let motivo = "fim do laco";

	// Lane recem-criada nao tem missao: sem isso o primeiro turno gasta o tempo
	// descobrindo onde gravar o proprio estado.
	garantirMissaoDaOperacao(chave, env);

	for (let n = 1; n <= opcoes.turnos; n += 1) {
		const estado = estadoDaOperacao(chave, env);
		if (!estado) {
			motivo = "lane desconhecida no registro de operacoes";
			break;
		}
		const missao = carregarMissao({ ...env, HTC_OP: chave });
		const restanteMs = prazo - agora();
		const antes = estadoDoTurno(estado);
		const pre = decidirTurno({
			antes,
			depois: antes,
			secos,
			limiteSecos: opcoes.limiteSecos,
			laneFechada: estado.fechada,
			missaoFechada: missao?.fechada === true,
			fim: sinalDeFim(chave, env),
			restanteMs,
			turnosRestantes: opcoes.turnos - n + 1,
			intervaloMs: 0,
			timeout: false,
			falhou: false,
			falhas: 0,
		});
		if (pre.acao === "parar") {
			motivo = pre.motivo;
			break;
		}
		const promptPath = gravarPromptDaOperacao(chave, env);
		if (!promptPath) {
			motivo = "prompt nao gerado (estado da lane ilegivel)";
			break;
		}
		const inicio = agora();
		const tetoDoTurno = Math.max(1, Math.min(opcoes.tetoTurnoMs, restanteMs));
		log(
			`turno ${n} abre | ${antes.n}/10 ${antes.degrau} | achados ${antes.achados} validados ${antes.validados} shells ${antes.shells} | teto ${Math.round(tetoDoTurno / 60_000)}m`,
		);
		let resultado: { codigo: number | null; timeout: boolean };
		try {
			resultado = await opcoes.executar({
				nome: chave,
				n,
				promptPath,
				prazoMs: tetoDoTurno,
				env,
			});
		} catch (erro) {
			resultado = { codigo: null, timeout: false };
			log(
				`turno ${n} executor falhou: ${erro instanceof Error ? erro.message : String(erro)}`,
			);
		}
		const depoisEstado = estadoDaOperacao(chave, env);
		const depois = depoisEstado ? estadoDoTurno(depoisEstado) : antes;
		const delta = calcularDelta(antes, depois);
		const artefato =
			delta.achados > 0 || delta.validados > 0 || delta.shells > 0 || delta.degrau;
		const falhou = resultado.codigo !== null && resultado.codigo !== 0;
		falhas = falhou ? falhas + 1 : 0;
		secos = artefato ? 0 : falhou ? secos : secos + 1;
		const turno: Turno = {
			n,
			inicio: new Date(inicio).toISOString(),
			ms: agora() - inicio,
			codigo: resultado.codigo,
			timeout: resultado.timeout,
			antes,
			depois,
			delta,
			artefato,
		};
		registrarTurno(chave, turno, env);
		feitos.push(turno);
		log(
			`turno ${n} fecha | ${Math.round(turno.ms / 1000)}s | codigo ${resultado.codigo}${resultado.timeout ? " TIMEOUT" : ""} | +${delta.achados} achados +${delta.validados} validados +${delta.shells} shells${delta.degrau ? ` | degrau ${depois.n} ${depois.degrau}` : ""} | ${artefato ? "artefato" : `seco ${secos}/${opcoes.limiteSecos}`}`,
		);
		if (artefato) limparSteer(chave, env);
		const missaoDepois = carregarMissao({ ...env, HTC_OP: chave });
		const decisao = decidirTurno({
			antes,
			depois,
			secos,
			limiteSecos: opcoes.limiteSecos,
			laneFechada: depoisEstado?.fechada === true,
			missaoFechada: missaoDepois?.fechada === true,
			fim: sinalDeFim(chave, env),
			restanteMs: prazo - agora(),
			turnosRestantes: opcoes.turnos - n,
			intervaloMs: opcoes.intervaloMs,
			timeout: resultado.timeout,
			falhou,
			falhas,
		});
		if (decisao.steer) {
			escreverSteer(chave, decisao.steer, env);
			log(`steer (${decisao.motivo}): ${decisao.steer.slice(0, 180)}`);
		}
		if (decisao.acao === "parar") {
			motivo = decisao.motivo;
			break;
		}
		if (decisao.esperaMs > 0) await dormir(decisao.esperaMs);
	}

	gravarRelatorio(chave, env);
	log(`vigia encerrado: ${motivo}`);
	return {
		nome: chave,
		motivo,
		turnos: feitos,
		horas: (agora() - inicioMs) / 3_600_000,
	};
}

export function sinalizarFim(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	mkdirSync(dirLanes(env), { recursive: true });
	writeFileSync(
		caminhoDaPista(nome, env, "fim"),
		`${new Date().toISOString()}\n`,
		"utf8",
	);
}

export function limparFim(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	rmSync(caminhoDaPista(nome, env, "fim"), { force: true });
}

export function pidVivo(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (erro) {
		// EPERM = existe e nao e nosso; ESRCH = morto.
		return (erro as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

/**
 * Um vigia por lane. Dois supervisores na mesma lane sao dois turnos escrevendo
 * no mesmo `missao.<lane>.json`: o segundo apaga o primeiro e o operador acorda
 * com metade do trabalho.
 */
export function tomarLock(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; pid?: number } {
	const arquivo = caminhoDaPista(nome, env, "lock");
	if (existsSync(arquivo)) {
		const bruto = readFileSync(arquivo, "utf8").trim();
		const pid = Number.parseInt(bruto, 10);
		if (Number.isFinite(pid) && pidVivo(pid)) return { ok: false, pid };
	}
	mkdirSync(dirLanes(env), { recursive: true });
	writeFileSync(arquivo, `${process.pid}\n`, "utf8");
	return { ok: true };
}

export function liberarLock(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	rmSync(caminhoDaPista(nome, env, "lock"), { force: true });
}

export function donoDoLock(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	const arquivo = caminhoDaPista(nome, env, "lock");
	if (!existsSync(arquivo)) return undefined;
	const pid = Number.parseInt(readFileSync(arquivo, "utf8").trim(), 10);
	if (!Number.isFinite(pid) || !pidVivo(pid)) return undefined;
	return pid;
}

/** Uma linha de estado do vigia para o board. */
export function resumoVigia(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const pid = donoDoLock(nome, env);
	const turnos = lerTurnos(nome, env);
	const ultimo = turnos[turnos.length - 1];
	const partes: string[] = [];
	partes.push(pid ? `vigia rodando (pid ${pid})` : "vigia parado");
	if (turnos.length > 0) {
		const art = turnos.filter((t) => t.artefato).length;
		partes.push(`${turnos.length} turnos (${art} com artefato)`);
	}
	if (ultimo) {
		partes.push(`ultimo ${hora(ultimo.inicio)} ${ultimo.artefato ? "artefato" : "seco"}`);
	}
	if (sinalDeFim(nome, env)) partes.push("parada sinalizada");
	return partes.join(" | ");
}

