// language: TypeScript, file: src/commands/op.ts, runtime: bun/node
/**
 * htc op — lanes nomeadas (OP1/OP2) com estado que sobrevive a sessao.
 *
 *   htc op                                   board das lanes (estado medido)
 *   htc op novo op1 --alvo integra.x.alvo.test --escopo a,b
 *   htc op op1 --prompt                      prompt gerado do estado
 *   htc op op1 --abrir [--spawn]             grava o prompt e abre a sessao (-z)
 *   htc op op1 --loop [--horas 3]            VIGIA: turnos seguidos ate o objetivo
 *   htc op op1 --loop --detach               vigia em background (fecha o terminal)
 *   htc op op1 --log                         ultimos turnos do vigia
 *   htc op op1 --relatorio                   relatorio para ler ao acordar
 *   htc op op1 --parar                       sinaliza parada no proximo limite
 *   htc op op1 --fechar
 *   htc op --json
 *
 * O que isto resolve: antes a OP1/OP2 era um prompt escrito a mao em %TEMP% e
 * um session id descartavel — reiniciar perdia o degrau e as duas dividiam o
 * mesmo `missao.json`. E `--abrir` disparava UM turno: ninguem olhava o
 * resultado nem regenerava o prompt com o estado novo. `--loop` e o vigia.
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename } from "node:path";
import { chaveDaOperacao } from "../runtime/missao";
import {
	caminhoPromptDaOperacao,
	carregarOperacoes,
	comandoDaOperacao,
	criarOperacao,
	estadoDaOperacao,
	fecharOperacao,
	gravarPromptDaOperacao,
	obterOperacao,
	promptDaOperacao,
	quadroDeOperacoes,
} from "../runtime/op";
import { caminhoDaPista, dirLanes } from "../runtime/steer";
import { carregarCorpus } from "../runtime/correlacao";
import {
	caminhoLogVigia,
	donoDoLock,
	gravarRelatorio,
	lerTurnos,
	liberarLock,
	limparFim,
	registrarLog,
	relatorioDaOperacao,
	resumoVigia,
	sinalizarFim,
	tomarLock,
	vigiar,
} from "../runtime/vigia";

export interface OpOptions {
	args?: string[];
	status?: boolean;
	json?: boolean;
	novo?: boolean;
	alvo?: string;
	objetivo?: string;
	escopo?: string;
	instrumento?: string;
	prompt?: boolean;
	abrir?: boolean;
	spawn?: boolean;
	fechar?: boolean;
	loop?: boolean;
	detach?: boolean;
	horas?: number;
	turnos?: number;
	tetoTurno?: number;
	intervalo?: number;
	limiteSecos?: number;
	log?: boolean;
	relatorio?: boolean;
	parar?: boolean;
}

export async function runOp(opts: OpOptions = {}): Promise<number> {
	const [verbo, ...resto] = opts.args ?? [];
	const alvo = opts.alvo?.trim();

	if (opts.novo || verbo === "novo") {
		const nome = opts.novo ? verbo : resto[0];
		const alvoDaOperacao = alvo ?? resto[1];
		if (!nome?.trim() || !alvoDaOperacao?.trim()) {
			console.error("uso: htc op novo <nome> --alvo <host> [--objetivo <txt>] [--escopo a,b]");
			return 1;
		}
		const escopo = opts.escopo
			?.split(",")
			.map((e) => e.trim())
			.filter(Boolean);
		const { operacao, criada } = criarOperacao({
			nome,
			alvo: alvoDaOperacao,
			objetivo: opts.objetivo,
			escopo,
			instrumento: opts.instrumento,
		});
		console.log(
			`${criada ? "lane criada" : "lane atualizada"}: ${operacao.nome} | ${operacao.alvo} | estado em missao.${operacao.nome}.json`,
		);
		return 0;
	}

	if (verbo && opts.loop) return await rodarVigia(verbo, opts);

	if (verbo && opts.parar) {
		if (!obterOperacao(verbo)) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		sinalizarFim(verbo);
		console.log(
			`parada sinalizada em ${chaveDaOperacao(verbo)}: o vigia encerra no fim do turno corrente`,
		);
		return 0;
	}

	if (verbo && opts.relatorio) {
		if (!obterOperacao(verbo)) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		console.log(gravarRelatorio(verbo));
		console.log(relatorioDaOperacao(verbo));
		return 0;
	}

	if (verbo && opts.log) {
		if (!obterOperacao(verbo)) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		const turnos = lerTurnos(verbo);
		console.log(`${resumoVigia(verbo)}`);
		for (const turno of turnos.slice(-12)) {
			const codigo = turno.timeout ? "TIMEOUT" : String(turno.codigo ?? "-");
			console.log(
				`#${turno.n} ${turno.inicio.slice(11, 16)} ${Math.round(turno.ms / 1000)}s cod ${codigo} | +${turno.delta.achados} achados +${turno.delta.validados} validados +${turno.delta.shells} shells | ${turno.depois.n} ${turno.depois.degrau} | ${turno.artefato ? "artefato" : "seco"}`,
			);
		}
		console.log(`relatorio: ${caminhoDaPista(verbo, process.env, "relatorio.md")}`);
		return 0;
	}

	if (verbo && opts.fechar) {
		const fechada = fecharOperacao(verbo);
		if (!fechada) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		console.log(`lane fechada: ${fechada.nome} (o estado da missao continua no disco)`);
		return 0;
	}

	if (verbo && opts.prompt) {
		const texto = promptDaOperacao(verbo);
		if (!texto) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		console.log(texto);
		return 0;
	}

	if (verbo && opts.abrir) {
		const caminho = gravarPromptDaOperacao(verbo);
		if (!caminho) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		const comando = comandoDaOperacao(verbo);
		if (!comando) {
			console.error(`lane desconhecida: ${verbo}`);
			return 1;
		}
		if (opts.spawn) {
			const filho = spawn(comando.cmd, comando.args, {
				detached: true,
				stdio: "ignore",
				env: { ...process.env, ...comando.env },
			});
			filho.unref();
			console.log(`prompt: ${caminho}`);
			console.log(`sessao aberta em background (HTC_OP=${comando.env.HTC_OP}, pid ${filho.pid})`);
			return 0;
		}
		console.log(`prompt: ${caminho}`);
		const linha = comando.args
			.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
			.join(" ");
		console.log(`abra com: HTC_OP=${comando.env.HTC_OP} "${comando.cmd}" ${linha}`);
		return 0;
	}

	const operacoes = carregarOperacoes();
	if (opts.json) {
		const estados = operacoes.map((o) => estadoDaOperacao(o.nome)).filter(Boolean);
		console.log(JSON.stringify(estados, null, 2));
		return 0;
	}
	if (verbo && !opts.status) {
		const estado = estadoDaOperacao(verbo);
		if (!estado) {
			console.error(`lane desconhecida: ${verbo} (htc op novo ${verbo} --alvo <host>)`);
			return 1;
		}
		console.log(
			[
				`lane ${estado.nome} | ${estado.alvo} | degrau ${estado.n}/10 ${estado.degrau}`,
				`fase ${estado.fase} | ${estado.achados} achados (${estado.validados} validados) | ${estado.shells} shells | ociosa ${estado.ociosaMin}m`,
				`proximo instrumento: ${estado.instrumento}`,
				`prova: ${estado.prova}`,
				`prompt: ${caminhoPromptDaOperacao(estado.nome)}`,
			].join("\n"),
		);
		return 0;
	}
	console.log(quadroDeOperacoes());
	for (const operacao of operacoes) {
		console.log(`  ${operacao.nome}: ${resumoVigia(operacao.nome)}`);
	}
	// Visao de bancada: o que ja foi medido atravessa as lanes. Uma lane ve so o
	// proprio alvo; o corpus mostra o componente que aparece em cinco hosts.
	const corpus = carregarCorpus();
	if (corpus.hosts.length > 0) {
		const topo = corpus.porHost
			.slice(0, 3)
			.map((h) => `${h.host} ${h.achados}`)
			.join(" · ");
		console.log(
			`\n  corpus: ${corpus.achados.length} achados em ${corpus.hosts.length} hosts (${topo}) — htc correlacao`,
		);
	}
	return 0;
}
/**
 * Mata o turno e o que ele abriu. `filho.kill()` no Windows mata o bun e deixa
 * os netos (bash, nmap, ffuf) rodando: o vigia acharia que o turno acabou e o
 * alvo continuaria levando scan da noite anterior.
 */
function matarArvore(pid: number | undefined): void {
	if (!pid) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// ja morreu
		}
	}
}

/** Entrypoint do proprio CLI: binario compilado ou `bun src/index.ts`. */
function entradaDoCli(): { cmd: string; base: string[] } {
	const cmd = process.execPath;
	if (basename(cmd).toLowerCase().startsWith("htc")) return { cmd, base: [] };
	const principal = (globalThis as { Bun?: { main?: string } }).Bun?.main;
	const entrypoint =
		principal && /\.(ts|js|mjs|cjs)$/i.test(principal) ? principal : process.argv[1];
	return { cmd, base: entrypoint ? [entrypoint] : [] };
}

/**
 * Um turno real: one-shot bloqueante com `HTC_OP` da lane, saida em arquivo e
 * teto de tempo com kill da arvore. O vigia mede o disco depois; o stdout do
 * turno fica em `ops/lanes/<lane>.turno-N.log` para o operador ler.
 */
function executarTurnoReal(): Parameters<typeof vigiar>[1]["executar"] {
	return async ({ nome, n, promptPath, prazoMs, env }) => {
		const comando = comandoDaOperacao(nome, env, {
			bloqueante: true,
			extras: ["-t", String(Math.max(1, Math.ceil(prazoMs / 1000)))],
		});
		if (!comando) return { codigo: null, timeout: false };
		mkdirSync(dirLanes(env), { recursive: true });
		const saida = caminhoDaPista(nome, env, `turno-${n}.log`);
		const fd = openSync(saida, "a");
		const filho = spawn(comando.cmd, comando.args, {
			cwd: process.cwd(),
			env: {
				...env,
				...comando.env,
				HTC_NO_IDENTITY: "1",
				// O supervisor de freeze (supervisor.ts) relanca o CLI DESTACADO
				// quando o batimento para: um turno novo sairia do controle do
				// vigia e dois turnos escreveriam no mesmo estado da lane. Aqui o
				// teto do vigia + taskkill e a autoridade; a recuperacao e o
				// proximo turno, que ja nasce com o prompt regenerado do disco.
				HTC_SUPERVISOR: "off",
			},
			stdio: ["ignore", fd, fd],
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		closeSync(fd);
		const inicio = Date.now();
		const resultado = await new Promise<{ codigo: number | null; timeout: boolean }>(
			(resolver) => {
				let encerrado = false;
				const timer = setTimeout(() => {
					if (encerrado) return;
					encerrado = true;
					matarArvore(filho.pid);
					resolver({ codigo: null, timeout: true });
				}, prazoMs);
				filho.on("close", (codigo) => {
					if (encerrado) return;
					encerrado = true;
					clearTimeout(timer);
					resolver({ codigo, timeout: false });
				});
				filho.on("error", () => {
					if (encerrado) return;
					encerrado = true;
					clearTimeout(timer);
					resolver({ codigo: null, timeout: false });
				});
			},
		);
		registrarLog(
			nome,
			`turno ${n} saida: ${saida} (${Math.round((Date.now() - inicio) / 1000)}s)`,
			env,
		);
		return resultado;
	};
}

function comandoDoVigia(
	nome: string,
	opts: Required<
		Pick<OpOptions, "horas" | "turnos" | "tetoTurno" | "intervalo" | "limiteSecos">
	>,
): { cmd: string; args: string[] } {
	const { cmd, base } = entradaDoCli();
	return {
		cmd,
		args: [
			...base,
			"op",
			nome,
			"--loop",
			"--horas",
			String(opts.horas),
			"--turnos",
			String(opts.turnos),
			"--teto-turno",
			String(opts.tetoTurno),
			"--intervalo",
			String(opts.intervalo),
			"--limite-secos",
			String(opts.limiteSecos),
		],
	};
}

async function rodarVigia(nome: string, opts: OpOptions): Promise<number> {
	const chave = chaveDaOperacao(nome);
	if (!obterOperacao(chave)) {
		console.error(`lane desconhecida: ${chave} (htc op novo ${chave} --alvo <host>)`);
		return 1;
	}
	const ajustes = {
		horas: Math.max(0.1, opts.horas ?? 3),
		turnos: Math.max(1, Math.round(opts.turnos ?? 24)),
		tetoTurno: Math.max(1, Math.round(opts.tetoTurno ?? 25)),
		intervalo: Math.max(0, Math.round(opts.intervalo ?? 20)),
		limiteSecos: Math.max(1, Math.round(opts.limiteSecos ?? 3)),
	};

	if (opts.detach) {
		// O lock e do FILHO: tomar aqui deixaria o pid do pai (que sai em
		// seguida) no arquivo e o vigia nasceria recusando o proprio lock.
		const dono = donoDoLock(chave);
		if (dono) {
			console.error(`ja existe vigia para ${chave} (pid ${dono})`);
			return 1;
		}
		limparFim(chave);
		const comando = comandoDoVigia(chave, ajustes);
		const log = caminhoLogVigia(chave);
		mkdirSync(dirLanes(), { recursive: true });
		const fd = openSync(log, "a");
		const filho = spawn(comando.cmd, comando.args, {
			detached: true,
			stdio: ["ignore", fd, fd],
			windowsHide: true,
			env: { ...process.env, HTC_OP: chave, HTC_NO_IDENTITY: "1" },
		});
		closeSync(fd);
		filho.unref();
		console.log(
			`vigia de ${chave} em background (pid ${filho.pid}) | ${ajustes.horas}h ou ${ajustes.turnos} turnos | log ${log}`,
		);
		return 0;
	}

	const lock = tomarLock(chave);
	if (!lock.ok) {
		console.error(`ja existe vigia para ${chave} (pid ${lock.pid})`);
		return 1;
	}
	limparFim(chave);
	console.log(
		`vigia de ${chave} | ${ajustes.horas}h | teto ${ajustes.tetoTurno}min/turno | ${ajustes.turnos} turnos | ${ajustes.limiteSecos} secos = steer`,
	);
	let motivo = "erro";
	try {
		const resultado = await vigiar(chave, {
			horas: ajustes.horas,
			turnos: ajustes.turnos,
			tetoTurnoMs: ajustes.tetoTurno * 60_000,
			intervaloMs: ajustes.intervalo * 1000,
			limiteSecos: ajustes.limiteSecos,
			executar: executarTurnoReal(),
			log: (linha) => {
				registrarLog(chave, linha);
				console.log(linha);
			},
		});
		motivo = resultado.motivo;
		console.log(
			`vigia encerrado: ${resultado.motivo} | ${resultado.turnos.length} turnos em ${resultado.horas.toFixed(2)}h`,
		);
	} finally {
		liberarLock(chave);
		gravarRelatorio(chave);
	}
	console.log(`relatorio: ${caminhoDaPista(chave, process.env, "relatorio.md")}`);
	return motivo === "erro" ? 1 : 0;
}

