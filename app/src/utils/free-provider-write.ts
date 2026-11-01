// language: TypeScript, file: src/utils/free-provider-write.ts, runtime: bun
//
// Escrita do provider `htc-free` isolada num modulo sem `@cline/core`.
//
// Motivo medido: a mesma escrita aborta o processo quando roda dentro de
// `free-models.ts`, e roda limpa em script separado (9 candidatos eliminados —
// ops/knowledge/free-channel-write-defeito.md). Aqui nao ha core, nao ha
// registry, nao ha estado de sessao: so `spawnSync` e JSON.
//
// `bun -e` continua sendo o caminho preferido; quando o bun nao esta no PATH
// (binario instalado em maquina sem bun), a escrita cai para o proprio processo
// — este modulo nao carrega core, entao nao herda o abort nativo.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CODIGO = [
	'const fs=require("node:fs"),path=require("node:path"),os=require("node:os");',
	'const p=JSON.parse(process.env.HTC_FREE_PAYLOAD||"{}");',
	'const raiz=process.env.HTC_STATE_DIR||path.join(os.homedir(),".htc");',
	'const alvo=path.join(raiz,"data","settings","providers.json");',
	'fs.mkdirSync(path.dirname(alvo),{recursive:true});',
	'let est={version:1,modes:{},providers:{}};',
	'try{est=JSON.parse(fs.readFileSync(alvo,"utf8"));}catch{}',
	'est.version??=1;est.modes??={};est.providers??={};',
	'est.providers["htc-free"]={settings:{provider:"htc-free",protocol:"openai-chat",baseUrl:p.base,',
	'...(p.chave?{apiKey:p.chave}:{}),...(p.modelo?{model:p.modelo}:{})},',
	'updatedAt:new Date().toISOString(),tokenSource:"manual"};',
	'fs.writeFileSync(alvo,JSON.stringify(est,null,2)+"\\n");',
].join("");

/** Grava `providers.json` num filho. Devolve false quando o filho nao sai com 0. */
export function escreverProviderFree(entrada: {
	base: string;
	chave: string;
	modelo: string;
}): boolean {
	const filho = spawnSync("bun", ["-e", CODIGO], {
		windowsHide: true,
		encoding: "utf8",
		input: "",
		timeout: 15_000,
		env: { ...process.env, HTC_FREE_PAYLOAD: JSON.stringify(entrada) },
	});
	if (filho.status === 0) return true;
	// bun ausente/erro: escreve aqui mesmo, com o mesmo merge do filho.
	return escreverInline(entrada);
}

/** Mesma escrita do filho, no proprio processo (modulo sem core). */
function escreverInline(entrada: {
	base: string;
	chave: string;
	modelo: string;
}): boolean {
	try {
		const raiz = process.env.HTC_STATE_DIR?.trim() || join(homedir(), ".htc");
		const alvo = join(raiz, "data", "settings", "providers.json");
		mkdirSync(dirname(alvo), { recursive: true });
		let estado: {
			version?: number;
			modes?: Record<string, unknown>;
			providers?: Record<string, unknown>;
		} = {};
		try {
			estado = JSON.parse(readFileSync(alvo, "utf8").replace(/^\uFEFF/, "")) as typeof estado;
		} catch {
			estado = {};
		}
		estado.version ??= 1;
		estado.modes ??= {};
		estado.providers ??= {};
		estado.providers["htc-free"] = {
			settings: {
				provider: "htc-free",
				protocol: "openai-chat",
				baseUrl: entrada.base,
				...(entrada.chave ? { apiKey: entrada.chave } : {}),
				...(entrada.modelo ? { model: entrada.modelo } : {}),
			},
			updatedAt: new Date().toISOString(),
			tokenSource: "manual",
		};
		writeFileSync(alvo, `${JSON.stringify(estado, null, 2)}\n`, "utf8");
		return true;
	} catch {
		return false;
	}
}
