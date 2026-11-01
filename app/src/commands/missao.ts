// language: TypeScript, file: src/commands/missao.ts, runtime: bun/node
/**
 * htc missao — estado da operacao que sobrevive ao turno.
 *
 *   htc missao https://alvo.tld                 abre (idempotente)
 *   htc missao https://alvo.tld --novo          troca de alvo com missao aberta
 *   htc missao --status | --json                estado atual
 *   htc missao --degrau webshell                fixa o degrau da escada (1..10)
 *   htc missao --caixa                          mostra a caixa de contexto (constantes)
 *   htc missao --fase enum                      avanca fase (recon|enum|vetor|exploit|shell|pos)
 *   htc missao achado "login admin" -e "200 + Set-Cookie" --validado
 *   htc missao --shell alvo.tld --transporte tcp -e "id -> uid=33(www-data)"
 *   htc missao --fechar
 */
import {
	abrirMissao,
	carregarMissao,
	FASES,
	type FaseMissao,
	fecharMissao,
	textoMissao,
	definirFase,
	definirDegrau,
	registrarAchado,
	registrarShell,
} from "../runtime/missao";
import { DEGRAUS, type Degrau, degrau_por_id } from "../runtime/escada";
import { resumo_da_caixa } from "../runtime/contexto";

export interface MissaoOptions {
	/** Posicionais: <alvo> ou "achado" "<titulo>". */
	args?: string[];
	status?: boolean;
	json?: boolean;
	novo?: boolean;
	objetivo?: string;
	escopo?: string;
	/** Opera a missao de uma lane (`--op op1`): vale mais que o session id. */
	op?: string;
	fase?: string;
	degrau?: string;
	/** `--caixa`: mostra hash, fontes e o arquivo da caixa de contexto. */
	caixa?: boolean;
	shell?: string;
	transporte?: string;
	evidencia?: string;
	validado?: boolean;
	fechar?: boolean;
}

export async function runMissao(opts: MissaoOptions = {}): Promise<number> {
	const [verbo, ...resto] = opts.args ?? [];
	// `--op <nome>` fixa a lane antes de qualquer leitura: `htc missao --op op1
	// achado ...` grava em `missao.op1.json`, nao no arquivo da sessao.
	if (opts.op?.trim()) process.env.HTC_OP = opts.op.trim();
	const alvo = verbo && verbo !== "achado" ? verbo : undefined;
	// Caixa de contexto: as constantes (contrato, mapa, escada, payload, opsec,
	// autonomia) com hash e fontes. Existe para o operador VER o que o modelo
	// recebe uma vez — e para saber o que reler quando o hash muda.
	if (opts.caixa) {
		console.log(resumo_da_caixa());
		return 0;
	}
	if (opts.fechar) {
		const fechada = fecharMissao();
		if (!fechada) {
			console.log("sem missao aberta");
			return 1;
		}
		console.log(`missao fechada: ${fechada.alvo} (${fechada.shells.length} shells, ${fechada.achados.length} achados)`);
		return 0;
	}

	if (opts.degrau) {
		const id = opts.degrau.trim().toLowerCase() as Degrau;
		const def = degrau_por_id(id);
		if (!def) {
			console.error(
				`degrau invalido: ${opts.degrau} (use ${DEGRAUS.map((d) => d.id).join("|")})`,
			);
			return 1;
		}
		const missao = definirDegrau(def.id);
		if (!missao) {
			console.error("sem missao aberta (htc missao <alvo>)");
			return 1;
		}
		console.log(`degrau: ${def.n}/10 ${def.id} — ${def.artefato}`);
		console.log(`fecha quando: ${def.prova}`);
		return 0;
	}

	if (opts.fase) {
		const fase = opts.fase.trim().toLowerCase() as FaseMissao;
		if (!FASES.includes(fase)) {
			console.error(`fase invalida: ${opts.fase} (use ${FASES.join("|")})`);
			return 1;
		}
		const missao = definirFase(fase);
		if (!missao) {
			console.error("sem missao aberta (htc missao <alvo>)");
			return 1;
		}
		console.log(`fase: ${missao.fase}`);
		return 0;
	}

	if (opts.shell) {
		if (!opts.evidencia?.trim()) {
			console.error("shell sem prova: passe -e \"<saida do comando no alvo>\"");
			return 1;
		}
		const missao = registrarShell({
			host: opts.shell,
			transporte: opts.transporte ?? "desconhecido",
			prova: opts.evidencia,
		});
		if (!missao) {
			console.error("sem missao aberta (htc missao <alvo>)");
			return 1;
		}
		console.log(`shell registrada: ${opts.shell} (total ${missao.shells.length})`);
		return 0;
	}

	if (verbo === "achado") {
		const titulo = resto.join(" ").trim();
		if (!titulo) {
			console.error('uso: htc missao achado "<titulo>" [-e "<evidencia>"] [--validado]');
			return 1;
		}
		const missao = registrarAchado({
			titulo,
			evidencia: opts.evidencia,
			validado: opts.validado,
		});
		if (!missao) {
			console.error("sem missao aberta (htc missao <alvo>)");
			return 1;
		}
		console.log(`achado: ${titulo} (total ${missao.achados.length})`);
		return 0;
	}

	if (alvo && !opts.status) {
		const escopo = opts.escopo
			?.split(",")
			.map((e) => e.trim())
			.filter(Boolean);
		const { missao, criada } = abrirMissao({
			alvo,
			objetivo: opts.objetivo,
			escopo,
			novo: opts.novo,
		});
		if (!criada && missao.alvo !== alvo) {
			console.error(
				`missao aberta em ${missao.alvo}; feche (--fechar) ou abra a nova com --novo`,
			);
			return 1;
		}
		console.log(
			`${criada ? "missao aberta" : "missao atualizada"}: ${missao.alvo} | ${missao.objetivo} | fase ${missao.fase}`,
		);
		return 0;
	}

	const missao = carregarMissao();
	if (!missao) {
		console.log("sem missao (htc missao <alvo>)");
		return opts.status ? 1 : 0;
	}
	if (opts.json) {
		console.log(JSON.stringify(missao, null, 2));
		return 0;
	}
	console.log(textoMissao(missao));
	return 0;
}
