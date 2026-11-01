// language: TypeScript, file: src/tui/utils/largura-conteudo.ts, runtime: bun/node
// Largura util da area de conversa.
//
// O markdown media a tabela pela largura do TERMINAL, mas o chat nao ocupa o
// terminal inteiro: a sidebar come a direita e o transcript tem marcador +
// paddings. Resultado: tabela montada para 120 colunas num espaco de 86 -> a
// linha era cortada e a grade quebrava.
//
// A constante era 30 enquanto `sidebar.tsx` renderiza 42 (`prefs.sidebarLargura`):
// o markdown calculava 12 colunas a mais do que existiam e TODA tabela saia
// quebrada com a sidebar ligada. Agora a largura vem do mesmo lugar que o
// componente usa — `larguraSidebarEfetiva` e chamada pelos dois.

export const SIDEBAR_LARGURA = 42;
/** Marcador do agente (2) + padding do transcript. */
export const GUTTER_CONTEUDO = 4;
const LIMIAR_SIDEBAR = 110;

/** Mesma regra do root.tsx: sidebar liga em terminal largo, HTC_SIDEBAR manda. */
export function sidebarVisivel(
	larguraTerminal: number,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const flag = env.HTC_SIDEBAR;
	if (flag === "1") return true;
	if (flag === "0") return false;
	return larguraTerminal >= LIMIAR_SIDEBAR;
}

/**
 * Largura que a sidebar REALMENTE ocupa. Fonte unica: `sidebar.tsx` usa esta
 * funcao para o `width` do componente e `larguraConteudo` usa ela para descontar
 * do markdown. Duas formulas diferentes = tabela quebrada.
 */
export function larguraSidebarEfetiva(
	larguraTerminal: number,
	preferida: number = SIDEBAR_LARGURA,
): number {
	return Math.min(preferida, Math.max(28, larguraTerminal - 44));
}

/** Colunas realmente disponiveis para o markdown. */
export function larguraConteudo(
	larguraTerminal: number,
	env: NodeJS.ProcessEnv = process.env,
	preferida: number = SIDEBAR_LARGURA,
): number {
	const sidebar = sidebarVisivel(larguraTerminal, env)
		? larguraSidebarEfetiva(larguraTerminal, preferida)
		: 0;
	return Math.max(24, larguraTerminal - sidebar - GUTTER_CONTEUDO);
}
