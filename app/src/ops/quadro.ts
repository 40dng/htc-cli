// Quadro do HTC OPS: o conteudo da tela como texto. O renderer (opentui) so pinta.
import { alvo as detalheAlvo, capacidade, fila, frota, leakradar, resumo } from "../server/fleet";
import { sessoes } from "./bus";
import { sessoesCli } from "./sessoes";

export type Aba = "capacidade" | "fila" | "alvos" | "sessoes" | "htc" | "log";
export const NAV: { id: Aba; rotulo: string }[] = [
	{ id: "capacidade", rotulo: "Supply" },
	{ id: "fila", rotulo: "Fila" },
	{ id: "alvos", rotulo: "Alvos" },
	{ id: "sessoes", rotulo: "Agentes" },
	{ id: "htc", rotulo: "Sessoes HTC" },
	{ id: "log", rotulo: "Log" },
];

const n = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const corta = (s: string, w: number) => (s.length > w ? s.slice(0, Math.max(0, w - 1)) + "…" : s);
const pad = (s: string, w: number) => corta(s, w).padEnd(w);
const medidor = (v: number, alvo: number, larg = 14) => {
	const c = alvo > 0 ? Math.min(larg, Math.round((v / alvo) * larg)) : 0;
	return "█".repeat(c) + "░".repeat(Math.max(0, larg - c));
};
const idade = (desde: number) => {
	const s = Math.floor((Date.now() - desde) / 1000);
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export type Contexto = {
	aba: Aba;
	sel: number;
	busca: string;
	aviso: string;
	log: string[];
	largura: number;
	altura: number;
	iconeBusca: string;
};

export type Linhas = unknown[];

export function linhasDe(aba: Aba, busca: string): Linhas {
	const q = busca.trim().toLowerCase();
	const casa = (t: string) => !q || t.toLowerCase().includes(q);
	if (aba === "capacidade") return capacidade();
	if (aba === "fila") return (fila() as { domain: string }[]).filter((t) => casa(t.domain));
	if (aba === "alvos") return (frota(255) as { alvo: string }[]).filter((a) => casa(a.alvo));
	if (aba === "sessoes") return [...sessoes.values()].filter((s) => casa(s.alvo));
	if (aba === "htc") return sessoesCli(40).filter((s) => casa(s.id + " " + s.agente + " " + s.prompt));
	return [];
}

export function alvoDe(aba: Aba, linha: unknown): string | null {
	if (!linha || typeof linha !== "object") return null;
	const o = linha as Record<string, unknown>;
	if (aba === "fila") return (o.domain as string) ?? null;
	if (aba === "alvos") return (o.alvo as string) ?? null;
	if (aba === "sessoes") return (o.alvo as string) ?? null;
	if (aba === "htc") return (o.id as string) ?? null;
	return null;
}

export function detalheDe(aba: Aba, linha: unknown): string[] {
	const alvo = alvoDe(aba, linha);
	if (!alvo) return [];
	if (aba === "fila") {
		const t = linha as { id: number; domain: string; status: string; attempts: number; result_json: string | null };
		return [`alvo ${t.domain}`, `task #${t.id}`, `status ${t.status}`, `tentativas ${t.attempts}`, "", ...String(t.result_json ?? "").slice(0, 3000).split("\n")];
	}
	if (aba === "htc") {
		const s = linha as { curto: string; agente: string; modelo: string; workspace: string; prompt: string; inicio: string; status: string };
		return [`sessao ${s.curto}`, `agente ${s.agente}`, `modelo ${s.modelo}`, `status ${s.status}`, `workspace ${s.workspace}`, `inicio ${s.inicio}`, "", ...(s.prompt.match(/.{1,78}/g) ?? [])];
	}
	const d = detalheAlvo(alvo);
	return [`alvo ${alvo}`, "", ...d.findings.slice(0, 40).map((f) => `[${String(f.status ?? "?").slice(0, 10)}] ${String(f.title ?? "").slice(0, 88)}`)];
}

export function montarQuadro(c: Contexto): string {
	const L = Math.max(64, c.largura);
	const out: string[] = [];
	const linha = (s = "") => out.push(corta(s, L));

	const cap = capacidade();
	const lr = leakradar();
	const tot = resumo();
	const vivos = cap.reduce((s, x) => s + x.vivos, 0);
	const emUso = cap.reduce((s, x) => s + x.em_uso, 0);
	const livres = cap.reduce((s, x) => s + x.livres, 0);
	const pendentes = (fila() as { status: string }[]).filter((t) => t.status === "pending").length;

	linha(`HTC OPS  ·  plano de controle${" ".repeat(Math.max(1, L - 58))}${new Date().toLocaleTimeString("pt-BR")}`);
	linha("─".repeat(L));
	linha(`CAPACIDADE   vivos ${n(vivos)}   em uso ${n(emUso)}   LIVRES ${n(livres)}   repor ${n(cap.reduce((s, x) => s + x.reposicao, 0))}`);
	for (const x of cap) {
		linha(
			`  ${pad(x.tipo, 6)} ${pad(String(x.vivos), 4)}/${pad(String(x.alvo), 4)} ${medidor(x.vivos, x.alvo)}  livres ${pad(String(x.livres), 4)} taxa ${String(Math.round(x.taxa_ok * 100)).padStart(3)}%  repor ${x.reposicao}`,
		);
	}
	linha(`EXECUCAO     rodando ${n(sessoes.size)}   fila ${n(pendentes)}   leases ${n(emUso)}`);
	linha("─".repeat(L));

	const corpo = Math.max(3, c.altura - out.length - 5);
	const linhas = linhasDe(c.aba, c.busca);

	if (c.aba === "capacidade") {
		linha(`LEAKRADAR    pontos ${n(lr.gasto.total)}   dominios ${n(lr.varridos)}   com senha ${n(lr.com_senha)}   senhas ${n(lr.senhas_visiveis)}`);
		linha(`FRENTE       alvos ${n(tot.alvos)}   val ${n(tot.validados)}   expl ${n(tot.exploitable)}   shell ${n(tot.shells)}`);
		linha("");
		linha("reposicao so quando vivos < alvo — acervo finito, nao cresce sozinho");
		for (let i = 0; i < Math.max(0, corpo - 4); i++) linha("");
	} else if (c.aba === "log") {
		for (const l of c.log.slice(-corpo)) linha(l);
		if (!c.log.length) linha("  (sem eventos)");
	} else {
		linha(
			c.aba === "fila" ? pad("id", 7) + pad("alvo", 30) + pad("status", 11) + "prio"
			: c.aba === "alvos" ? pad("alvo", 34) + pad("find", 7) + pad("val", 7) + "expl"
			: c.aba === "sessoes" ? pad("alvo", 34) + pad("pid", 8) + "idade"
			: pad("sessao", 18) + pad("agente", 14) + "modelo",
		);
		const vis = linhas.slice(0, corpo);
		vis.forEach((l, i) => {
			const o = l as Record<string, unknown>;
			const txt =
				c.aba === "fila" ? pad(`#${o.id}`, 7) + pad(String(o.domain), 30) + pad(String(o.status), 11) + String(o.priority)
				: c.aba === "alvos" ? pad(String(o.alvo), 34) + pad(String(o.findings), 7) + pad(String(o.validados), 7) + String(o.exploitable)
				: c.aba === "sessoes" ? pad(String(o.alvo), 34) + pad(String(o.pid), 8) + idade(Number(o.desde))
				: pad(String(o.curto), 18) + pad(String(o.agente), 14) + String(o.modelo ?? "").slice(0, 20);
			linha((i === c.sel ? "▸ " : "  ") + txt);
		});
		if (!vis.length) linha("  (vazio)");
		for (let i = vis.length; i < corpo; i++) linha("");
	}

	while (out.length < c.altura - 3) out.push("");
	linha("─".repeat(L));
	linha(pad(`${c.iconeBusca} ${c.busca || "buscar"}`, 26) + "1-6 abas · tab alterna · / busca · d dispara · enter detalhe · x orfas · q sai");
	linha(c.aviso || `alvos ${n(tot.alvos)} · val ${n(tot.validados)} · expl ${n(tot.exploitable)} · shell ${n(tot.shells)}   ·   vivos ${n(vivos)}  em uso ${n(emUso)}  livres ${n(livres)}  ·  pontos ${n(lr.gasto.total)}`);
	return out.join("\n");
}

