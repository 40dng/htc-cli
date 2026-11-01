// language: TypeScript, file: src/runtime/opencode_question.ts, runtime: Bun, alvo: provider opencode
// Mapeia os eventos `question.asked` do OpenCode (perguntas interativas que o
// agente do servidor opencode faz no meio do turno) para o mesmo canal de
// perguntas que o CLI ja usa no tool `ask_question` (o caminho que o DeepSeek
// percorre). O provider ai-sdk-provider-opencode-sdk le o resolvedor registrado
// aqui via globalThis e responde a pergunta no servidor opencode.

/** Uma opcao selecionavel de uma pergunta do OpenCode. */
export interface OpcaoDePerguntaOpencode {
	label: string;
	description?: string;
}

/** Uma pergunta do evento `question.asked`. */
export interface PerguntaOpencode {
	question: string;
	header?: string;
	options: OpcaoDePerguntaOpencode[];
	multiple?: boolean;
	custom?: boolean;
}

/** Payload entregue ao resolvedor registrado pelo CLI. */
export interface PedidoDePerguntaOpencode {
	questionId: string;
	sessionId: string;
	questions: PerguntaOpencode[];
}

/** Respostas por pergunta; cada resposta e a lista de labels escolhidos. */
export type RespostaDePerguntaOpencode = string[][];

export type ResolvedorDePerguntaOpencode = (
	pedido: PedidoDePerguntaOpencode,
) => Promise<RespostaDePerguntaOpencode | null> | RespostaDePerguntaOpencode | null;

/** Callback de pergunta ja existente no CLI (terminal ou TUI). */
export type CanalDePerguntaDoCli = (
	pergunta: string,
	opcoes: string[],
) => Promise<string>;

const CHAVE_GLOBAL = "__HTC_OPENCODE_QUESTION__";
const CHAVE_GLOBAL_DESCRICAO = "__HTC_OPENCODE_QUESTION_INFO__";

const OPCAO_DE_RESERVA = "responder livremente";

interface EscopoGlobal {
	[CHAVE_GLOBAL]?: ResolvedorDePerguntaOpencode;
	[CHAVE_GLOBAL_DESCRICAO]?: string;
}

function escopo(): EscopoGlobal {
	return globalThis as unknown as EscopoGlobal;
}

export function registrar_resolvedor_de_pergunta(
	resolvedor: ResolvedorDePerguntaOpencode,
	descricao = "cli",
): void {
	const alvo = escopo();
	alvo[CHAVE_GLOBAL] = resolvedor;
	alvo[CHAVE_GLOBAL_DESCRICAO] = descricao;
}

export function remover_resolvedor_de_pergunta(): void {
	const alvo = escopo();
	delete alvo[CHAVE_GLOBAL];
	delete alvo[CHAVE_GLOBAL_DESCRICAO];
}

export function ler_resolvedor_de_pergunta(): ResolvedorDePerguntaOpencode | null {
	return escopo()[CHAVE_GLOBAL] ?? null;
}

export const CHAVE_GLOBAL_DO_RESOLVEDOR = CHAVE_GLOBAL;

function montar_texto_da_pergunta(pergunta: PerguntaOpencode): string {
	const corpo = pergunta.question?.trim() || pergunta.header?.trim() || "pergunta do opencode";
	const cabecalho =
		pergunta.header && pergunta.question && pergunta.header !== pergunta.question
			? `[${pergunta.header}] `
			: "";
	const detalhes = pergunta.options
		.filter((opcao) => opcao.description?.trim())
		.map((opcao) => `${opcao.label}: ${opcao.description}`)
		.join(" | ");
	return detalhes ? `${cabecalho}${corpo}\n${detalhes}` : `${cabecalho}${corpo}`;
}

function normalizar_resposta(
	resposta: string,
	pergunta: PerguntaOpencode,
): string[] {
	const limpo = resposta.trim();
	if (!limpo) {
		const primeira = pergunta.options[0]?.label;
		return primeira ? [primeira] : [];
	}
	const exata = pergunta.options.find((opcao) => opcao.label === limpo);
	if (exata) {
		return [exata.label];
	}
	if (pergunta.multiple) {
		const rotulos = limpo
			.split(",")
			.map((parte) => parte.trim())
			.filter(Boolean);
		const selecionados = rotulos
			.map((rotulo) => pergunta.options.find((opcao) => opcao.label === rotulo)?.label ?? rotulo)
			.filter(Boolean);
		if (selecionados.length > 0) {
			return selecionados;
		}
	}
	return [limpo];
}

/**
 * Constroi um resolvedor que roteia cada pergunta do opencode pelo canal de
 * pergunta do CLI (`askQuestionInTerminal` no headless, `tuiAskQuestion` no TUI).
 * Retorna `null` quando o canal nao esta disponivel, para o provider cair no
 * comportamento antigo (avisar e seguir).
 */
export function criar_resolvedor_do_cli(
	perguntar: CanalDePerguntaDoCli,
): ResolvedorDePerguntaOpencode {
	return async (pedido) => {
		if (pedido.questions.length === 0) {
			return null;
		}
		const respostas: RespostaDePerguntaOpencode = [];
		for (const pergunta of pedido.questions) {
			const opcoes = pergunta.options.map((opcao) => opcao.label);
			const texto = montar_texto_da_pergunta(pergunta);
			const resposta = await perguntar(texto, opcoes.length > 0 ? opcoes : [OPCAO_DE_RESERVA]);
			respostas.push(normalizar_resposta(resposta, pergunta));
		}
		return respostas;
	};
}

/** Resolvedor para canais que so existem depois do boot do TUI. */
export function criar_resolvedor_preguicoso(
	obter_canal: () => CanalDePerguntaDoCli | null,
): ResolvedorDePerguntaOpencode {
	return async (pedido) => {
		const canal = obter_canal();
		if (!canal) {
			return null;
		}
		return await criar_resolvedor_do_cli(canal)(pedido);
	};
}
