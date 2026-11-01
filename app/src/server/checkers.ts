// Checkers de suprimento: prova se a conta está viva de verdade. Nada de "porta aberta".
import { connect } from "node:net";

export type Resultado = { vivo: boolean; motivo: string; detalhe?: string };

const TIMEOUT = 8000;

/** Chave de IA: GET /models é barato e discrimina morta (401) de sem-saldo (402/429). */
export async function checarIa(chave: string, provedor: string): Promise<Resultado> {
	const p = provedor.toLowerCase();
	const url = p.includes("openrouter")
		? "https://openrouter.ai/api/v1/models"
		: p.includes("deepseek")
			? "https://api.deepseek.com/models"
			: p.includes("groq")
				? "https://api.groq.com/openai/v1/models"
				: p.includes("x.ai")
					? "https://api.x.ai/v1/models"
					: "https://api.openai.com/v1/models";
	try {
		const r = await fetch(url, { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(TIMEOUT) });
		if (r.status === 200) return { vivo: true, motivo: "auth ok + /models" };
		if (r.status === 401 || r.status === 403) return { vivo: false, motivo: `credencial recusada (${r.status})` };
		if (r.status === 402 || r.status === 429) return { vivo: true, motivo: `viva, sem credito/limite (${r.status})` };
		return { vivo: false, motivo: `http ${r.status}` };
	} catch (e) {
		return { vivo: false, motivo: `sem resposta (${String(e).slice(0, 40)})` };
	}
}

/** Proxy: CONNECT real. Só isso prova auth + túnel. */
export function checarProxy(host: string, porta: number, usuario = "", senha = ""): Promise<Resultado> {
	return new Promise((resolve) => {
		const auth = usuario ? `Proxy-Authorization: Basic ${Buffer.from(`${usuario}:${senha}`).toString("base64")}\r\n` : "";
		const s = connect({ host, port: porta });
		let buf = "";
		const fim = (r: Resultado) => {
			s.destroy();
			resolve(r);
		};
		s.setTimeout(TIMEOUT);
		s.once("connect", () => {
			s.setNoDelay(true);
			s.write(`CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n${auth}\r\n`);
		});
		s.on("data", (d) => {
			buf += d.toString();
			if (buf.includes(" 200 ")) return fim({ vivo: true, motivo: "CONNECT 200" });
			if (buf.includes(" 407 ")) return fim({ vivo: false, motivo: "auth recusada (407)" });
			if (buf.includes(" 403 ")) return fim({ vivo: false, motivo: "bloqueado pelo proxy (403)" });
			if (buf.length > 400) fim({ vivo: false, motivo: buf.split("\r\n")[0]?.slice(0, 40) ?? "resposta estranha" });
		});
		s.once("timeout", () => fim({ vivo: false, motivo: "timeout" }));
		s.once("error", (e: NodeJS.ErrnoException) => fim({ vivo: false, motivo: e.code ?? "erro de rede" }));
	});
}

/** VPS: SSH com banner prova host de verdade (não é só porta aberta em proxy). */
export function checarVps(host: string, porta = 22): Promise<Resultado> {
	return new Promise((resolve) => {
		const s = connect({ host, port: porta });
		let buf = "";
		const fim = (r: Resultado) => {
			s.destroy();
			resolve(r);
		};
		s.setTimeout(TIMEOUT);
		s.on("data", (d) => {
			buf += d.toString();
			if (buf.startsWith("SSH-")) return fim({ vivo: true, motivo: buf.split("\r\n")[0]!.slice(0, 40) });
			if (buf.length > 80) fim({ vivo: true, motivo: "porta responde (sem banner ssh)" });
		});
		s.once("timeout", () => fim({ vivo: false, motivo: "timeout" }));
		s.once("error", (e: NodeJS.ErrnoException) => fim({ vivo: false, motivo: e.code ?? "erro" }));
	});
}

export async function checar(tipo: string, host: string, porta: number, usuario: string, senha: string): Promise<Resultado> {
	if (tipo === "ai") return checarIa(senha, host);
	if (tipo === "proxy") return checarProxy(host, porta, usuario, senha);
	if (tipo === "vps") return checarVps(host, porta || 22);
	return { vivo: false, motivo: `tipo desconhecido: ${tipo}` };
}
