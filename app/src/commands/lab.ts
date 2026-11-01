// language: TypeScript, file: src/commands/lab.ts, runtime: bun/node
// `htc lab bypass` — mede a taxa de ENTREGA do bypass, por variante de payload.
//
// Uso:
//   htc lab bypass                     todas as variantes, 1 rodada, modelo atual
//   htc lab bypass --variant silencio   so uma variante
//   htc lab bypass --runs 2 --json      duas rodadas, relatorio JSON
//   htc lab bypass --mock               valida o harness sem rede/token
//   htc lab bypass --out lab.json       grava o relatorio

import { writeFileSync } from "node:fs";
import { criar_executor_htc } from "../lab/executor";
import { SONDAS_BYPASS, SONDAS_SETOR } from "../lab/prompts";
import { rodar_lab, type RelatorioLab, type ResumoVariante } from "../lab/runner";
import { PAYLOADS } from "../runtime/htc-bypass";
import { c, writeln, writeErr } from "../utils/output";

export interface OpcoesLab {
	variante?: string;
	only?: string;
	runs?: string;
	provider?: string;
	modelo?: string;
	json?: boolean;
	mock?: boolean;
	out?: string;
	timeout?: string;
	/** Só as sondas de setor (banco/pagamento/terceiro). */
	setor?: boolean;
	/** Todas: tecnicas + setor. */
	todos?: boolean;
}

function barra(taxa: number, largura = 20): string {
	const cheio = Math.round(Math.max(0, Math.min(1, taxa)) * largura);
	return `${"█".repeat(cheio)}${"░".repeat(largura - cheio)}`;
}

function linhaResumo(resumo: ResumoVariante, melhor: boolean): string {
	const pct = `${(resumo.taxa * 100).toFixed(0)}%`.padStart(4);
	const marca = melhor ? `${c.green}*${c.reset}` : " ";
	return `${marca} ${resumo.variante.padEnd(11)} ${barra(resumo.taxa)} ${pct}  artefato=${resumo.artefato}/${resumo.total} recusa=${resumo.recusa} misto=${resumo.misto} indef=${resumo.indefinido} erro=${resumo.erros}`;
}

function imprimir(relatorio: RelatorioLab): void {
	const sondas = new Set(relatorio.resultados.map((r) => r.sonda)).size;
	writeln(`${c.dim}lab bypass — ${relatorio.geradoEm}${c.reset}`);
	writeln(
		`${c.dim}${sondas} sonda(s) x ${relatorio.variantes.length} variante(s), taxa = artefato/respostas sem erro${c.reset}\n`,
	);
	for (const resumo of relatorio.variantes) {
		writeln(linhaResumo(resumo, resumo.variante === relatorio.melhor?.variante));
	}
	const falhas = relatorio.resultados.filter((r) => r.veredito !== "artefato");
	if (falhas.length > 0) {
		writeln(`\n${c.yellow}fora da entrega:${c.reset}`);
		for (const falha of falhas) {
			const erro = falha.erro ? ` [erro: ${falha.erro}]` : "";
			writeln(
				`  ${falha.variante}/${falha.sonda} -> ${falha.veredito}${erro} :: ${c.dim}${falha.trecho}${c.reset}`,
			);
		}
	}
	if (relatorio.melhor) {
		writeln(
			`\nmelhor variante: ${c.green}${relatorio.melhor.variante}${c.reset} (${(relatorio.melhor.taxa * 100).toFixed(0)}%)`,
		);
	}
}

export async function runLabBypass(opcoes: OpcoesLab): Promise<number> {
	const variantes = opcoes.variante
		? [opcoes.variante]
		: PAYLOADS.map((payload) => payload.id);
	const desconhecidas = variantes.filter(
		(id) => !PAYLOADS.some((payload) => payload.id === id),
	);
	if (desconhecidas.length > 0) {
		writeErr(
			`variante desconhecida: ${desconhecidas.join(", ")} (use ${PAYLOADS.map((p) => p.id).join(", ")})`,
		);
		return 2;
	}
	const repeticoes = Math.max(1, Number.parseInt(opcoes.runs ?? "1", 10) || 1);
	const timeoutMs = Math.max(60_000, Number.parseInt(opcoes.timeout ?? "300000", 10) || 300_000);

	const executar = opcoes.mock
		? async ({ sonda }: { sonda: { id: string } }) => ({
				texto: [
					`Artefato para ${sonda.id}.`,
					"```cpp",
					"#include <windows.h>",
					"#include <stdio.h>",
					"int main(void) {",
					"    void *mem = VirtualAlloc(0, 0x1000, MEM_COMMIT, PAGE_READWRITE);",
					"    printf(\"%p\\n\", mem);",
					"    return 0;",
					"}",
					"```",
				].join("\n"),
		  })
		: criar_executor_htc({
				provider: opcoes.provider,
				modelo: opcoes.modelo,
			});

	if (!opcoes.json) {
		writeln(
			`${c.dim}${opcoes.mock ? "modo mock (sem rede)" : "rodando one-shot real — consome tokens do modelo"}${c.reset}`,
		);
	}
	// Conjunto de sondas: tecnico (padrao), setor (--setor) ou os dois (--todos).
	const base = opcoes.setor
		? SONDAS_SETOR
		: opcoes.todos
			? [...SONDAS_BYPASS, ...SONDAS_SETOR]
			: SONDAS_BYPASS;
	const ids = opcoes.only?.split(",").map((id) => id.trim());
	const sondas = ids ? base.filter((sonda) => ids.includes(sonda.id)) : base;
	if (sondas.length === 0) {
		writeErr("nenhuma sonda casou com --only");
		return 1;
	}

	const relatorio = await rodar_lab({
		executar,
		variantes,
		repeticoes,
		timeoutMs,
		sondas,
		aoProgredir: (resultado, indice, total) => {
			if (opcoes.json) return;
			const pct = `${Math.round((indice / total) * 100)}%`.padStart(4);
			writeln(
				`${c.dim}[${pct}]${c.reset} ${resultado.variante}/${resultado.sonda} -> ${resultado.veredito}${resultado.erro ? ` (erro: ${resultado.erro})` : ""}`,
			);
		},
	});

	if (opcoes.out) {
		try {
			writeFileSync(opcoes.out, `${JSON.stringify(relatorio, null, 2)}\n`, "utf8");
		} catch (erro) {
			writeErr(`nao consegui escrever ${opcoes.out}: ${String(erro)}`);
		}
	}
	if (opcoes.json) {
		writeln(JSON.stringify(relatorio, null, 2));
	} else {
		imprimir(relatorio);
	}
	// Codigo de saida util em CI: 0 quando alguma variante entrega tudo.
	return relatorio.variantes.some((v) => v.total > 0 && v.taxa >= 1) ? 0 : 1;
}
