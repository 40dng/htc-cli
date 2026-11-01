// language: TypeScript, file: scripts/instalar_entry_hub.ts, runtime: Bun, alvo: @cline/core 0.0.82
// O spawner de hub embutido em @cline/core/dist/index.js resolve o entry do
// daemon como `new URL("./entry.js", import.meta.url)`, ou seja `dist/entry.js`,
// mas o arquivo real vive em `dist/hub/daemon/entry.js`. Sem o shim o spawn do
// daemon falha com "Module not found" e o supervisor re-tenta em loop, enchendo
// ~/.cline/data/logs/hub-daemon.log sem limite (1 GB observado). Este script
// cria os shims idempotentes no postinstall.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RAIZ_DO_PACOTE = "@cline";
const NOME_DO_PACOTE = "core";
const DIR_DIST = "dist";

interface ShimDeEntry {
	caminho: string;
	alvo: string;
}

function resolver_dist_do_core(): string {
	const raiz_do_projeto = resolve(import.meta.dir, "..");
	const raiz_do_modulo = join(
		raiz_do_projeto,
		"node_modules",
		RAIZ_DO_PACOTE,
		NOME_DO_PACOTE,
		DIR_DIST,
	);
	return raiz_do_modulo;
}

function montar_shims(dist_do_core: string): ShimDeEntry[] {
	return [
		{ caminho: join(dist_do_core, "entry.js"), alvo: "./hub/daemon/entry.js" },
		{ caminho: join(dist_do_core, "hub", "entry.js"), alvo: "./daemon/entry.js" },
	];
}

function conteudo_do_shim(alvo: string): string {
	return `// Shim gerado por scripts/instalar_entry_hub.ts. Nao editar.\nimport "${alvo}";\n`;
}

export function instalar_entry_do_hub(): string[] {
	const dist_do_core = resolver_dist_do_core();
	const entry_do_daemon = join(dist_do_core, "hub", "daemon", "entry.js");
	if (!existsSync(entry_do_daemon)) {
		return [];
	}
	const instalados: string[] = [];
	for (const shim of montar_shims(dist_do_core)) {
		const conteudo = conteudo_do_shim(shim.alvo);
		if (existsSync(shim.caminho) && readFileSync(shim.caminho, "utf8") === conteudo) {
			continue;
		}
		mkdirSync(dirname(shim.caminho), { recursive: true });
		writeFileSync(shim.caminho, conteudo, "utf8");
		instalados.push(shim.caminho);
	}
	return instalados;
}

if (import.meta.main) {
	const instalados = instalar_entry_do_hub();
	if (instalados.length === 0) {
		console.log("[htc] entry do hub ja estava integro");
	} else {
		for (const caminho of instalados) {
			console.log(`[htc] entry do hub instalado: ${caminho}`);
		}
	}
}
