// Teto unico do historico: o backend busca 2x o limite pedido (para descartar
// subagentes) e corta a varredura em 2000 linhas, entao 1000 devolve o acervo
// inteiro sem cair no cap interno.
export const HISTORY_LIST_LIMIT = 1000;
