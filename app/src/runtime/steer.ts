// language: TypeScript, file: src/runtime/steer.ts, runtime: bun/node
/**
 * STEER — o canal de correcao ao vivo de uma lane.
 *
 * O turno e um processo que nasce, trabalha e morre. Entre um turno e outro nao
 * existe memoria: o que o vigia aprendeu (instrumento seco, degrau avancado sem
 * prova, bloqueio nomeado) precisa entrar no PROMPT do turno seguinte, senao o
 * agente repete o mesmo comando por tres horas e chama isso de trabalho.
 *
 * Arquivo: <raiz>/ops/lanes/<chave>.steer — texto puro, sobrescrito a cada
 * decisao, lido pelo gerador de prompt, apagado quando o turno produz artefato.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { raiz_estado } from "./contexto";
import { chaveDaOperacao } from "./missao";

export function dirLanes(env: NodeJS.ProcessEnv = process.env): string {
	return join(raiz_estado(env), "ops", "lanes");
}

export function caminhoDaPista(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
	sufixo = "steer",
): string {
	return join(dirLanes(env), `${chaveDaOperacao(nome)}.${sufixo}`);
}

export function escreverSteer(
	nome: string,
	texto: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	mkdirSync(dirLanes(env), { recursive: true });
	writeFileSync(caminhoDaPista(nome, env), `${texto.trim()}\n`, "utf8");
}

export function lerSteer(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const arquivo = caminhoDaPista(nome, env);
	if (!existsSync(arquivo)) return undefined;
	try {
		const texto = readFileSync(arquivo, "utf8").trim();
		return texto || undefined;
	} catch {
		return undefined;
	}
}

export function limparSteer(
	nome: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	try {
		rmSync(caminhoDaPista(nome, env), { force: true });
	} catch {
		// best-effort: steer velho nao pode derrubar o turno
	}
}
