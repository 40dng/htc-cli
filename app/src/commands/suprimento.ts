// /suprimento - linguagem natural vira plano de aquisicao e o plano vira medicao.
// Ex: "3 vps pra operacao de 40 alvos e 4 api keys de ia" -> 3 vps + 4 ai.
import { Database } from "bun:sqlite";
import { checar } from "../server/checkers";
import { caminhoDb } from "../server/fleet";
import { necessidades, plano as planoDeCaca } from "../server/supply";

export type Pedido = { tipo: "vps" | "proxy" | "ai"; qtd: number; regiao?: string; provedor?: string };

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Extrai o pedido do texto cru. O numero colado no tipo manda; sem numero = 1. */
export function interpretar(texto: string): Pedido[] {
	const t = semAcento(texto);
	const regiao = /\b(br|brasil|residencial)\b/.test(t) ? "br" : /\b(us|eua|america)\b/.test(t) ? "us" : undefined;
	const provedores = ["iproyal", "oxylabs", "smartproxy", "brightdata", "rayobyte", "contabo", "ionos", "hetzner", "vultr", "digitalocean", "openai", "deepseek", "openrouter", "groq"];
	const provedor = provedores.find((p) => t.includes(p));

	const tipos: { tipo: Pedido["tipo"]; citado: RegExp; comNumero: RegExp }[] = [
		{ tipo: "vps", citado: /\b(vps|servidores?|maquinas?|vm)\b/, comNumero: /(\d+)\s*(?:de\s+)?(?:vps|servidores?|maquinas?|vm)\b/ },
		{ tipo: "ai", citado: /\b(api|apis|chaves?|keys?|modelos?|llm)\b/, comNumero: /(\d+)\s*(?:de\s+)?(?:api\s*keys?|apis|chaves?(?:\s+de\s+api)?|keys?|modelos?)\b/ },
		{ tipo: "proxy", citado: /\b(proxies|proxy|residencial)\b/, comNumero: /(\d+)\s*(?:de\s+)?(?:proxies|proxy)\b/ },
	];

	const out: Pedido[] = [];
	for (const k of tipos) {
		if (!k.citado.test(t)) continue;
		const m = k.comNumero.exec(t);
		const qtd = m ? Number(m[1]) : 1;
		out.push({ tipo: k.tipo, qtd: Math.max(1, Math.min(50, Number.isFinite(qtd) ? qtd : 1)), regiao, provedor });
	}
	if (!out.length && regiao) out.push({ tipo: "proxy", qtd: 1, regiao, provedor });
	return out;
}

function abrir() {
	const d = new Database(caminhoDb());
	d.exec("pragma busy_timeout=10000");
	return d;
}

export type Medicao = { tipo: string; host: string; porta: number; vivo: boolean; motivo: string };

/** Valida o acervo do tipo pedido e devolve o que ficou de pe. */
export async function medir(pedidos: Pedido[], limitePorTipo = 12): Promise<Medicao[]> {
	const d = abrir();
	const saida: Medicao[] = [];
	for (const p of pedidos) {
		const linhas = d
			.query(
				`select tipo, host, porta, usuario, senha from egress
				 where tipo = ? and status in ('candidato','vivo')
				 order by score desc, case status when 'vivo' then 0 else 1 end
				 limit ?`,
			)
			.all(p.tipo, Math.min(200, p.qtd * 8 + limitePorTipo)) as { tipo: string; host: string; porta: number; usuario: string; senha: string }[];

		const fila = [...linhas];
		const workers = Array.from({ length: Math.min(6, fila.length) }, async () => {
			for (;;) {
				const l = fila.shift();
				if (!l) return;
				const r = await checar(l.tipo, l.host, l.porta, l.usuario, l.senha);
				saida.push({ tipo: l.tipo, host: l.host, porta: l.porta, vivo: r.vivo, motivo: r.motivo });
				try {
					d.run("update egress set status = ?, score = ?, origem = coalesce(origem, 'checker') where host = ? and porta = ? and usuario = ?", [
						r.vivo ? "vivo" : "morto",
						r.vivo ? 80 : 0,
						l.host,
						l.porta,
						l.usuario,
					]);
				} catch {
					/* linha sumiu: segue */
				}
			}
		});
		await Promise.all(workers);
	}
	d.close();
	return saida;
}

export async function executar(texto: string) {
	const pedidos = interpretar(texto);
	if (!pedidos.length) {
		return { erro: "nao entendi o pedido. ex: /suprimento 3 vps e 4 api keys de ia, proxy BR residencial", necessidades: necessidades() };
	}
	const medido = await medir(pedidos);
	const vivos = medido.filter((m) => m.vivo);
	const falta = pedidos.map((p) => ({ ...p, ok: vivos.filter((v) => v.tipo === p.tipo).length, falta: Math.max(0, p.qtd - vivos.filter((v) => v.tipo === p.tipo).length) }));
	return {
		pedido: pedidos,
		medido: medido.length,
		vivos: vivos.length,
		porTipo: falta,
		resultado: vivos.slice(0, 10).map((v) => `${v.tipo} ${v.host}:${v.porta}  ${v.motivo}`),
		caca: planoDeCaca(5).filter((c) => falta.some((f) => f.tipo === c.tipo && f.falta > 0)),
	};
}

if (import.meta.main) {
	const texto = process.argv.slice(2).join(" ");
	console.log(JSON.stringify(await executar(texto), null, 1));
}
