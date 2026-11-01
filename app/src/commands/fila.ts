// language: TypeScript, file: src/commands/fila.ts, runtime: bun/node
/**
 * htc fila — alvos em serie sem entregar a lista ao modelo.
 *
 *   htc fila                          resumo + alvo atual
 *   htc fila add <url|host ...>       enfileira (dedupe por host)
 *   htc fila prox                     trava o proximo e imprime o turno
 *   htc fila simular <texto|@arquivo> mostra o turno exato, sem gastar token
 *   htc fila feito <alvo>             fecha o alvo e mostra o proximo
 *   htc fila parado <alvo> -e "<motivo>"
 *   htc fila limpar
 *   htc fila --json
 *
 * A fila existe para o lote: com mais de tres alvos na mesma mensagem o modelo
 * comeca a recusar o CONJUNTO, nao o alvo. Aqui a lista fica no disco e cada
 * turno leva um alvo so.
 */
import { readFileSync } from "node:fs";
import {
	absorverAlvos,
	carregarFila,
	caminhoFila,
	caminhoFilaPendente,
	ehLote,
	enquadrarTurno,
	estadoFila,
	listarFilasDeSessao,
	limparFila,
	limparTodasAsFilas,
	marcarAlvo,
	proximoAlvo,
	reivindicarFilaPendente,
	resumoFila,
} from "../runtime/fila-alvos";

export interface FilaOptions {
	args?: string[];
	json?: boolean;
	evidencia?: string;
	/** Opera a fila de uma sessao especifica (htc fila --sessao <id>). */
	sessao?: string;
	/** Opera a fila de uma lane (htc fila --op op1) — vale mais que a sessao. */
	op?: string;
	/** `limpar --todas`: global + todas as filas de sessao + pendente. */
	todas?: boolean;
}

export async function runFila(opts: FilaOptions = {}): Promise<number> {
	const [verbo, ...resto] = opts.args ?? [];
	// `--op <nome>` fixa a lane antes de tudo: a fila da OP1 nao pode cair na
	// fila da sessao (que morre no reinicio) nem na global.
	if (opts.op?.trim()) process.env.HTC_OP = opts.op.trim();
	// `--sessao <id>` vale para todos os verbos: a fila e por sessao.
	if (opts.sessao?.trim()) process.env.HTC_SESSION_ID = opts.sessao.trim();
	// Mesmo contrato do runtime: a primeira leitura de uma sessao sem fila pega a
	// fila preparada (`htc fila preparar ...`).
	reivindicarFilaPendente();

	if (opts.json) {
		console.log(JSON.stringify({ caminho: caminhoFila(), ...carregarFila() }, null, 2));
		return 0;
	}

	if (verbo === "sessoes") {
		const filas = listarFilasDeSessao();
		if (filas.length === 0) {
			console.log("nenhuma fila de sessao no disco (a global continua em fila.json)");
			console.log(`global: ${caminhoFila({ ...process.env, HTC_SESSION_ID: "" })}`);
			return 0;
		}
		for (const fila of filas) {
			console.log(`${fila.alvos.toString().padStart(4)} alvo(s)  ${fila.sessao}`);
		}
		console.log(`\npendente (proxima sessao pega): ${caminhoFilaPendente()}`);
		return 0;
	}

	// Prepara o lote ANTES de abrir a sessao: ela reivindica no primeiro turno.
	if (verbo === "preparar") {
		const entrada = resto.join(" ").trim();
		if (!entrada) {
			console.error('uso: htc fila preparar "alvo1 alvo2 ..." | @arquivo.txt');
			return 1;
		}
		const envPendente = { ...process.env, HTC_FILA: caminhoFilaPendente() };
		const absorcao = absorverAlvos(entrada, envPendente);
		if (absorcao.absorvidos.length === 0) {
			console.error("nenhum alvo reconhecido na entrada");
			return 1;
		}
		console.log(
			`fila pendente: ${absorcao.total} alvo(s) → ${caminhoFilaPendente()}`,
		);
		console.log("a proxima sessao sem fila reivindica esta lista no 1o turno");
		return 0;
	}

	if (verbo === "limpar") {
		// `--todas`: global + cada fila de sessao + pendente. Sem a flag, limpa so a
		// fila em foco (a da sessao de HTC_SESSION_ID, ou a global no CLI).
		if (opts.todas === true || resto.includes("--todas")) {
			const limpos = limparTodasAsFilas();
			if (limpos.length === 0) {
				console.log("nenhuma fila no disco");
				return 0;
			}
			for (const fila of limpos) {
				console.log(`  ${fila.alvos.toString().padStart(4)} alvo(s)  ${fila.sessao}`);
			}
			console.log(`fila(s) limpa(s): ${limpos.length}`);
			return 0;
		}
		const total = limparFila();
		console.log(`fila limpa (${total} alvo(s) removido(s))`);
		return 0;
	}

	if (verbo === "add") {
		const entrada = resto.join(" ");
		// Caminho de arquivo tambem vale: `htc fila add "c:\...\alvos novos.txt"`.
		const absorcao = absorverAlvos(entrada);
		if ((absorcao.documentos?.length ?? 0) > 0 && absorcao.citados.length === 0) {
			// Documento nao e fila: `add` avisa em vez de mentir "0 alvos".
			for (const documento of absorcao.documentos ?? []) {
				console.log(
					`documento (nao enfileirado): ${documento.original} — copia limpa em ${documento.copia}`,
				);
			}
			return 0;
		}
		if (absorcao.absorvidos.length === 0 && absorcao.citados.length === 0) {
			console.error("uso: htc fila add <url|host|caminho-de-lista ...>");
			return 1;
		}
		const deArquivo = absorcao.arquivos?.length
			? ` (${absorcao.arquivos.map((a) => `${a.alvos.length} de ${a.caminho}`).join(", ")})`
			: "";
		console.log(`+${absorcao.absorvidos.length} alvo(s)${deArquivo} — ${resumoFila()}`);
		return 0;
	}

	if (verbo === "prox") {
		const alvo = proximoAlvo();
		if (!alvo) {
			console.log("fila sem alvo pendente");
			return 1;
		}
		const instrucao = resto.join(" ").trim();
		console.log(enquadrarTurno(alvo.alvo, instrucao, alvo.tentativas));
		return 0;
	}

	if (verbo === "simular") {
		// Depuracao sem gastar token: absorve como o runtime absorve e imprime
		// o texto que iria para o modelo. `@arquivo` le o prompt do disco, o
		// que evita o inferno de aspas quando o texto tem caminho com espaco.
		const entrada = resto.join(" ");
		if (!entrada) {
			console.error("uso: htc fila simular <texto|@arquivo>");
			return 1;
		}
		const bruto = entrada.startsWith("@")
			? readFileSync(entrada.slice(1), "utf8").trim()
			: entrada;
		const absorcao = absorverAlvos(bruto);
		const vez = absorcao.alvo ?? proximoAlvo();
		console.log(
			JSON.stringify(
				{
					alvos: absorcao.citados.length,
					novos: absorcao.absorvidos.length,
					fila: absorcao.total,
					documentos: absorcao.documentos?.map((documento) => ({
						original: documento.original,
						copia: documento.copia,
						linhas_removidas: documento.removidas,
					})),
					arquivos: absorcao.arquivos?.map((arquivo) => ({
						caminho: arquivo.caminho,
						alvos: arquivo.alvos.length,
					})),
					texto: absorcao.texto,
				},
				null,
				2,
			),
		);
		console.log("---- turno ----");
		// Espelha o runtime: turno de documento nao recebe prefixo TARGET (nao
		// ha lote); o alvo em curso entra pela cauda, como no run-interactive.
		const turno =
			(absorcao.documentos?.length ?? 0) > 0 && !ehLote(absorcao)
				? enquadrarTurno("", absorcao.texto || bruto, 0)
				: enquadrarTurno(vez?.alvo ?? "", absorcao.texto || bruto, vez?.tentativas ?? 0);
		console.log(turno);
		return 0;
	}

	if (verbo === "feito" || verbo === "parado") {
		const alvo = resto.join(" ").trim();
		if (!alvo) {
			console.error(`uso: htc fila ${verbo} <alvo>`);
			return 1;
		}
		const atualizado = marcarAlvo(
			alvo,
			verbo === "feito" ? "feito" : "parado",
			verbo === "parado" ? opts.evidencia : undefined,
		);
		if (!atualizado) {
			console.error(`alvo fora da fila: ${alvo}`);
			return 1;
		}
		console.log(`${verbo}: ${atualizado.alvo} — ${resumoFila()}`);
		return 0;
	}

	// Sem verbo: absorve o que veio como texto (util em pipeline) e mostra estado.
	if (resto.length > 0 || (verbo && verbo.includes("."))) {
		const absorcao = absorverAlvos([verbo, ...resto].join(" "));
		if (absorcao.absorvidos.length > 0) {
			console.log(`+${absorcao.absorvidos.length} alvo(s) absorvido(s)`);
		}
	}

	const estado = estadoFila();
	console.log(resumoFila());
	if (estado.total === 0) {
		console.log(`arquivo: ${caminhoFila()}`);
	}
	return 0;
}
