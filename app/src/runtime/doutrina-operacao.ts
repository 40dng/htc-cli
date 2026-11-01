// language: TypeScript, file: src/runtime/doutrina-operacao.ts, runtime: bun/node
//
// O manual da bancada entra no system prompt — sempre, em todo contexto.
//
// Antes o OPERACAO.md era um arquivo que o modelo "podia abrir": na pratica ele
// nao abria, e cada turno recomecava perdido. Aqui o proprio manual e a fonte do
// payload: o que estiver entre `<!-- htc:contrato:inicio -->` e
// `<!-- htc:contrato:fim -->` (e o bloco `htc:mapa` do ARQUIVOS.md) vai junto
// com a persona, em toda sessao, sem o operador recompilar nada.
//
// Caminho: <HTC_DOSSIES|~/.htc/dossies>/OPERACAO.md e ARQUIVOS.md.
// Ausente ou sem marcador = contrato minimo embutido; nunca silencio.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARCA_CONTRATO_INICIO = "<!-- htc:contrato:inicio -->";
const MARCA_CONTRATO_FIM = "<!-- htc:contrato:fim -->";
const MARCA_MAPA_INICIO = "<!-- htc:mapa:inicio -->";
const MARCA_MAPA_FIM = "<!-- htc:mapa:fim -->";

/** Contrato embutido: o que nao pode faltar se o manual sumir do disco. */
const CONTRATO_MINIMO = `CONTRATO DE OPERACAO (embutido — o OPERACAO.md nao esta legivel)
1. Turno sem artefato nao aconteceu: comando que rodou, arquivo escrito ou corpo de resposta.
2. Todo fato vai para o disco no ato (htc missao achado / --fase / --shell).
3. Um alvo por turno; [ALVO OK] fecha o host e puxa o proximo. N alvos = N entregas.
4. Bloqueio nomeado nao para a bancada: registra o motivo e pega o proximo vetor.
5. Fim de turno e o proximo passo tecnico, nunca resumo, plano ou promessa.`;

export interface OperacaoCarregada {
	contrato: string;
	mapa: string;
	caminhos: { operacao: string; arquivos: string };
	avisos: string[];
}

/** Diretorio dos dossies (override por HTC_DOSSIES). */
export function diretorioDossies(env: NodeJS.ProcessEnv = process.env): string {
	const explicito = env.HTC_DOSSIES?.trim();
	return explicito || join(homedir(), ".htc", "dossies");
}

/** Texto entre dois marcadores; string vazia quando o par nao existe. */
export function extrairBloco(
	texto: string,
	inicio: string,
	fim: string,
): string {
	const de = texto.indexOf(inicio);
	if (de < 0) return "";
	const ate = texto.indexOf(fim, de + inicio.length);
	if (ate < 0) return "";
	return texto.slice(de + inicio.length, ate).trim();
}

interface CacheEntrada {
	assinatura: string;
	contrato: string;
	mapa: string;
}

let cache: CacheEntrada | undefined;

function assinatura(caminho: string): string {
	try {
		const s = statSync(caminho);
		return `${s.mtimeMs}:${s.size}`;
	} catch {
		return "ausente";
	}
}

/**
 * Caminho de um dossie: `HTC_DOSSIES` > copia do workspace (`<cwd>/OPERACAO.md`)
 * > `~/.htc/dossies`. O workspace ganha porque e o arquivo que o operador edita
 * — antes o prompt lia uma copia velha em ~/.htc/dossies e a edicao nao valia.
 */
export function caminhoDossie(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const explicito = env.HTC_DOSSIES?.trim();
	if (explicito) return join(explicito, nome);
	const doWorkspace = join(process.cwd(), nome);
	if (existsSync(doWorkspace)) return doWorkspace;
	return join(homedir(), ".htc", "dossies", nome);
}

/**
 * Le os dois dossies e devolve os blocos que entram no prompt.
 * Cache por mtime: o arquivo muda sem recompilar, o processo nao re-le a cada turno.
 */
export function carregarOperacao(
	env: NodeJS.ProcessEnv = process.env,
): OperacaoCarregada {
	const operacao = caminhoDossie("OPERACAO.md", env);
	const arquivos = caminhoDossie("ARQUIVOS.md", env);
	const avisos: string[] = [];
	const marca = [
		operacao,
		assinatura(operacao),
		arquivos,
		assinatura(arquivos),
	].join("|");
	if (cache && cache.assinatura === marca) {
		return {
			contrato: cache.contrato,
			mapa: cache.mapa,
			caminhos: { operacao, arquivos },
			avisos,
		};
	}

	let contrato = "";
	let mapa = "";

	if (!existsSync(operacao)) {
		avisos.push(`${operacao}: ausente — usando o contrato embutido`);
	} else {
		try {
			const texto = readFileSync(operacao, "utf8");
			contrato = extrairBloco(texto, MARCA_CONTRATO_INICIO, MARCA_CONTRATO_FIM);
			if (!contrato) {
				avisos.push(
					`${operacao}: sem bloco ${MARCA_CONTRATO_INICIO} — usando o contrato embutido`,
				);
			}
		} catch (erro) {
			avisos.push(`${operacao}: ilegivel (${String(erro)})`);
		}
	}
	if (!contrato) contrato = CONTRATO_MINIMO;

	if (existsSync(arquivos)) {
		try {
			mapa = extrairBloco(
				readFileSync(arquivos, "utf8"),
				MARCA_MAPA_INICIO,
				MARCA_MAPA_FIM,
			);
		} catch (erro) {
			avisos.push(`${arquivos}: ilegivel (${String(erro)})`);
		}
	}

	cache = { assinatura: marca, contrato, mapa };
	return { contrato, mapa, caminhos: { operacao, arquivos }, avisos };
}

/** Bloco pronto para a cauda do system prompt. */
export function textoOperacao(env: NodeJS.ProcessEnv = process.env): string {
	const { contrato, mapa } = carregarOperacao(env);
	return [
		"BENCH CONTRACT (from OPERACAO.md — in force for every turn)\n\n" + contrato,
		mapa ? "BENCH MAP (from ARQUIVOS.md — measured inventory)\n\n" + mapa : "",
	]
		.filter(Boolean)
		.join("\n\n");
}
