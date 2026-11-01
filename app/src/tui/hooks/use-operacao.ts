import { readFileSync } from "node:fs";
import { useEffect, useState } from "react";
import {
	caminhoSidebarGlobal,
	caminhoSidebarSessao,
	lerGalhos,
	lerResumoFila,
	type ResumoFilaSidebar,
	type ResumoGalhosSidebar,
} from "../../utils/sidebar";

export type PayloadSidebar = {
	rotulo?: string;
	indice?: number;
	nivel?: number;
	atualizado?: string;
};

export type EstadoOperacao = {
	alvo?: string;
	objetivo?: string;
	fase?: string;
	findings?: number;
	validados?: number;
	shells?: number;
	fechada?: boolean;
	agentes?: Array<{ nome: string; estado: string }>;
	payload?: PayloadSidebar;
	atualizado?: string;
	/** Derivados das fontes vivas (fila no disco, galhos no disco). */
	fila?: ResumoFilaSidebar;
	galhos?: ResumoGalhosSidebar;
};

/**
 * Estado de operacao da SESSAO (`ops/state/htc_sidebar.<chave>.json`).
 * O arquivo global (`ops/state/htc_sidebar.json`) so entra como fallback com
 * HTC_SIDEBAR_GLOBAL=1: por padrao ele e ignorado, porque era exatamente o que
 * fazia duas sessoes abertas cuspirem o mesmo painel. Sem arquivo, o painel
 * fica em "sem estado" e nada quebra. Contrato em docs/SIDEBAR.md.
 *
 * A fila e os galhos vem de fora do espelho: sao arquivos do runtime
 * (`state/fila.<sessao>.json`, `state/galhos/<sessao>/`). Antes o painel nao
 * mostrava nenhum dos dois — operacao com 7 alvos na fila aparecia "sem estado".
 *
 * Poll de 1s: o espelho e escrito a cada mutacao de missao/payload, e 5s deixava
 * a sidebar um turno atras da realidade.
 */
export function useOperacao(ativo = true): EstadoOperacao | undefined {
	const [estado, setEstado] = useState<EstadoOperacao | undefined>();

	useEffect(() => {
		if (!ativo) return;
		const ler = () => {
			const cwd = process.cwd();
			const caminhos = [caminhoSidebarSessao(cwd)];
			if ((process.env.HTC_SIDEBAR_GLOBAL ?? "").trim() === "1") {
				caminhos.push(caminhoSidebarGlobal(cwd));
			}
			let espelho: EstadoOperacao | undefined;
			for (const caminho of caminhos) {
				try {
					espelho = JSON.parse(readFileSync(caminho, "utf8")) as EstadoOperacao;
					break;
				} catch {
					// nao existe ainda: tenta o proximo
				}
			}
			const fila = lerResumoFila();
			const galhos = lerGalhos();
			if (!espelho && !fila && !galhos) {
				setEstado(undefined);
				return;
			}
			setEstado({ ...(espelho ?? {}), fila, galhos });
		};
		ler();
		const id = setInterval(ler, 1000);
		return () => clearInterval(id);
	}, [ativo]);

	return estado;
}
