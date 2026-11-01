// language: TypeScript, file: src/utils/workspace_guard.ts, runtime: Bun, alvo: indice de arquivos do workspace
// `getFileIndex(workspaceRoot)` monta um Set<string> com TODOS os arquivos do
// workspace, sem teto. Rodar o CLI com o home do usuario como workspace
// (C:\Users\<user>, ~) faz esse Set passar de centenas de milhares de caminhos
// — caches de browser, OneDrive, .bun/node_modules, .cline/data — e o processo
// salta para mais de 1 GB de RAM. Estes helpers barram os casos patologicos.

import { homedir } from "node:os";
import { parse, resolve, sep } from "node:path";

export const VARIAVEL_DE_OVERRIDE = "HTC_ALLOW_BROAD_WORKSPACE";

function sem_barra_final(caminho: string): string {
	return caminho.endsWith(sep) && caminho.length > 1
		? caminho.slice(0, -1)
		: caminho;
}

function normalizar(caminho: string): string {
	return sem_barra_final(resolve(caminho)).toLowerCase();
}

/** true quando o path e a raiz de um volume (C:\ , /). */
export function eh_raiz_de_volume(caminho: string): boolean {
	const alvo = resolve(caminho);
	return sem_barra_final(alvo).toLowerCase() === normalizar(parse(alvo).root);
}

/** true quando o path e o home do usuario, um ancestral dele, ou a raiz de um volume. */
export function eh_workspace_largo(caminho: string): boolean {
	const alvo = normalizar(caminho);
	if (!alvo) {
		return false;
	}
	if (eh_raiz_de_volume(caminho)) {
		return true;
	}
	const home = normalizar(homedir());
	if (alvo === home) {
		return true;
	}
	// Ancestral do home: C:\Users, /home — indexar tambem e patologico.
	return home.startsWith(`${alvo}${sep}`);
}

/** O usuario liberou explicitamente a indexacao de um workspace amplo. */
export function override_de_workspace_largo(
	env: Record<string, string | undefined> = process.env,
): boolean {
	const valor = env[VARIAVEL_DE_OVERRIDE]?.trim().toLowerCase();
	return valor === "1" || valor === "true" || valor === "yes";
}

/**
 * Decide se a indexacao do workspace deve ser bloqueada. Bloqueia somente os
 * casos patologicos; qualquer projeto normal passa.
 */
export function indexacao_do_workspace_bloqueada(
	caminho: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	return eh_workspace_largo(caminho) && !override_de_workspace_largo(env);
}

/** Linha de aviso mostrada uma vez no startup quando o indice e desligado. */
export function aviso_de_workspace_largo(caminho: string): string {
	return `[workspace] "${caminho}" e um diretorio amplo (home/ancestral/raiz): indice de arquivos e @mentions desativados para nao estourar a RAM. Rode o CLI dentro do projeto, ou defina ${VARIAVEL_DE_OVERRIDE}=1 para forcar.`;
}
