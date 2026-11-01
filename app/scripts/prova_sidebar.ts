// language: TypeScript, file: scripts/prova_sidebar.ts, target: Bun / Windows
// Prova que o estado da sidebar e por sessao: chave propria, caminho proprio e
// HTC_SIDEBAR_FILE publicado no boot. Era o arquivo unico que fazia duas janelas
// abertas mostrarem o mesmo painel de OPERACAO/AGENTES.
//
// Roda sem dependencia: bun scripts/prova_sidebar.ts

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	caminhoSidebarGlobal,
	caminhoSidebarSessao,
	chaveSessao,
	prepararSidebar,
} from "../src/utils/sidebar.ts";

const casos: Array<[string, boolean]> = [];
const cwd = mkdtempSync(join(tmpdir(), "htc-sidebar-"));

delete process.env.HTC_SIDEBAR_CHAVE;
casos.push(["sem override, a chave e o pid", chaveSessao() === String(process.pid)]);

process.env.HTC_SIDEBAR_CHAVE = "teste";
casos.push(["HTC_SIDEBAR_CHAVE sobrepoe", chaveSessao() === "teste"]);

const ses = caminhoSidebarSessao(cwd);
const glob = caminhoSidebarGlobal(cwd);
casos.push(["caminho da sessao carrega a chave", ses.includes("htc_sidebar.teste.json")]);
casos.push(["caminho da sessao difere do global", ses !== glob]);
casos.push(["global mantem o nome antigo", glob.endsWith(join("ops", "state", "htc_sidebar.json"))]);

delete process.env.HTC_SIDEBAR_FILE;
const publicado = prepararSidebar(cwd);
casos.push(["prepararSidebar devolve o caminho da sessao", publicado === ses]);
casos.push(["HTC_SIDEBAR_FILE publicado", process.env.HTC_SIDEBAR_FILE === ses]);
casos.push(["diretorio criado", existsSync(join(cwd, "ops", "state"))]);

// duas sessoes no MESMO cwd nao colidem
process.env.HTC_SIDEBAR_CHAVE = "sessao-a";
const a = caminhoSidebarSessao(cwd);
process.env.HTC_SIDEBAR_CHAVE = "sessao-b";
const b = caminhoSidebarSessao(cwd);
casos.push(["duas sessoes, dois arquivos", a !== b]);

for (const [nome, ok] of casos) console.log(`${ok ? "PASS" : "FAIL"}  ${nome}`);
const passou = casos.filter(([, ok]) => ok).length;
console.log(`\n${passou}/${casos.length} PASS`);
process.exit(passou === casos.length ? 0 : 1);
