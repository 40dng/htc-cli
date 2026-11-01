// language: TypeScript, file: src/server/ops-paths.ts, runtime: Bun, alvo: caminhos de estado do operador
// Nenhum caminho pessoal fixo: env primeiro, senao o diretorio de dados do usuario.
import { homedir } from "node:os";
import { join } from "node:path";

function ambiente(nome: string): string | undefined {
	const valor = (process.env[nome] ?? "").trim();
	return valor.length > 0 ? valor : undefined;
}

/** Raiz do acervo de operacao (db, estado, relatorios). */
export function raiz_ops(): string {
	return (
		ambiente("HTC_OPS_DIR") ??
		ambiente("PMP_OPS") ??
		join(homedir(), ".cline", "data", "htc", "ops")
	);
}

/** Banco da operacao. */
export function caminho_db(): string {
	return ambiente("PMP_DB") ?? join(raiz_ops(), "state", "pmp.db");
}

/** Arquivo de estado dentro de <ops>/state. */
export function caminho_estado(nome: string): string {
	return join(raiz_ops(), "state", nome);
}

/** Diretorio de configuracao local do HTC. */
export function dir_config(): string {
	return ambiente("HTC_CONFIG_DIR") ?? join(homedir(), ".cline", "data", "htc", "config");
}

/** Arquivo de configuracao dentro de <config>. */
export function caminho_config(nome: string): string {
	return join(dir_config(), nome);
}
