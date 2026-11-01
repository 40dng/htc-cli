// language: TypeScript, file: src/runtime/task-id.ts, runtime: Bun/Node
/**
 * ID DE TAREFA COM PREFIXO DE TIPO.
 *
 * Terceira lacuna do motor de referencia (`src/Task.ts` do Claude Code): com id opaco, o
 * mission log e o log do vigia nao dizem o que a tarefa era — so um hash. O prefixo resolve
 * isso sem consulta: `a…` e agente, `b…` e bash, `t…` e teammate.
 *
 * Formato: prefixo (1 char) + 8 chars em base36 = 36^8 ≈ 2,8 trilhoes de combinacoes.
 * Alfabeto so digitos e minusculas: id vira nome de arquivo sem escapar nada.
 */

export type TipoTarefa =
	| "local_bash"
	| "local_agent"
	| "remote_agent"
	| "in_process_teammate"
	| "local_workflow"
	| "monitor_mcp"
	| "dream";

const PREFIXOS: Record<TipoTarefa, string> = {
	local_bash: "b",
	local_agent: "a",
	remote_agent: "r",
	in_process_teammate: "t",
	local_workflow: "w",
	monitor_mcp: "m",
	dream: "d",
};

const ALFABETO = "0123456789abcdefghijklmnopqrstuvwxyz";
const CHARS = 8;

export function prefixo_de(tipo: TipoTarefa): string {
	return PREFIXOS[tipo] ?? "x";
}

/** Prefixo -> tipo, para decodificar log sem consultar tabela externa. */
export function tipo_do_prefixo(prefixo: string): TipoTarefa | undefined {
	const achado = Object.entries(PREFIXOS).find(([, p]) => p === prefixo);
	return achado ? (achado[0] as TipoTarefa) : undefined;
}

/**
 * Gera o id. `aleatorio` existe para teste deterministico: recebe um array de bytes e
 * devolve o id; sem ele, usa crypto.randomBytes.
 */
export function gerar_id_tarefa(
	tipo: TipoTarefa,
	aleatorio?: (n: number) => Uint8Array,
): string {
	const bytes = aleatorio ? aleatorio(CHARS) : crypto.getRandomValues(new Uint8Array(CHARS));
	let id = prefixo_de(tipo);
	for (let i = 0; i < CHARS; i++) {
		id += ALFABETO[(bytes[i] ?? 0) % ALFABETO.length];
	}
	return id;
}

export interface IdDecodificado {
	prefixo: string;
	tipo: TipoTarefa;
	corpo: string;
}

/** Decodifica um id gerado aqui. Formato invalido devolve undefined (nao lanca). */
export function decodificar_id(id: string): IdDecodificado | undefined {
	if (id.length !== CHARS + 1) return undefined;
	const prefixo = id[0] ?? "";
	const tipo = tipo_do_prefixo(prefixo);
	if (!tipo) return undefined;
	const corpo = id.slice(1);
	for (const c of corpo) if (!ALFABETO.includes(c)) return undefined;
	return { prefixo, tipo, corpo };
}
