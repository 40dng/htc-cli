// barramento entre htc-cli (executa) e htc-ops (controla).
// TCP local, uma mensagem JSON por linha. O CLI pergunta antes de tocar o alvo.
import { createServer, connect, type Server, type Socket } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir as abrirEnvelope, selar } from "./cofre";

export const PORTA_PADRAO = 47811;
const ARQ_PORTA = join(tmpdir(), "htc-ops.port");

export type Mensagem =
	| { t: "hello"; alvo: string; pid: number; fase?: string }
	| { t: "lease"; alvo: string; proxy: string | null; livre: boolean; motivo?: string; ttl: number }
	| { t: "event"; alvo: string; kind: string; msg: string }
	| { t: "done"; alvo: string; ok: boolean; resumo?: unknown }
	| { t: "ping" }
	| { t: "pong"; sessao: number; livres: number };

export type Sessao = {
	alvo: string;
	pid: number;
	proxy: string | null;
	desde: number;
	eventos: { ts: number; kind: string; msg: string }[];
};

/** Estado vivo do barramento (quem esta rodando e com qual egress). */
export const sessoes = new Map<string, Sessao>();

let servidor: Server | null = null;

export function portaAtual(): number {
	try {
		if (existsSync(ARQ_PORTA)) return Number(readFileSync(ARQ_PORTA, "utf8").trim()) || PORTA_PADRAO;
	} catch {
		/* sem arquivo */
	}
	return PORTA_PADRAO;
}

/** Sobe o barramento. `alocar` decide se ha egress livre para o alvo. */
export function subirBus(alocar: (alvo: string) => { proxy: string | null; livre: boolean; motivo?: string }) {
	servidor = createServer((sock: Socket) => {
		let buffer = "";
		sock.setEncoding("utf8");
		sock.on("data", (pedaco: string) => {
			buffer += pedaco;
			let corte = buffer.indexOf("\n");
			while (corte >= 0) {
				const linha = buffer.slice(0, corte).trim();
				buffer = buffer.slice(corte + 1);
				corte = buffer.indexOf("\n");
				if (!linha) continue;
				let m: Mensagem;
				try {
					m = abrirEnvelope(linha) as Mensagem;
				} catch {
					try {
						m = JSON.parse(linha) as Mensagem; // compatibilidade: peer sem cofre
					} catch {
						sock.write(selar({ t: "erro", msg: "envelope invalido" }));
						continue;
					}
				}
				responder(sock, m, alocar);
			}
		});
		sock.on("error", () => sock.destroy());
	});

	servidor.on("error", (e: NodeJS.ErrnoException) => {
		// porta ocupada: outra instancia do ops ja controla; a tela segue so leitura
		if (e.code !== "EADDRINUSE") throw e;
	});

	servidor.listen(PORTA_PADRAO, "127.0.0.1", () => {
		writeFileSync(ARQ_PORTA, String(PORTA_PADRAO));
	});
	return servidor;
}

function responder(sock: Socket, m: Mensagem, alocar: (alvo: string) => { proxy: string | null; livre: boolean; motivo?: string }) {
	if (m.t === "hello") {
		const existente = sessoes.get(m.alvo);
		if (existente) {
			// um alvo, uma sessao: devolve a mesma lease
			sock.write(selar({ t: "lease", alvo: m.alvo, proxy: existente.proxy, livre: true, ttl: 2400 }));
			return;
		}
		const r = alocar(m.alvo);
		if (!r.livre) {
			sock.write(selar({ t: "lease", alvo: m.alvo, proxy: null, livre: false, motivo: r.motivo ?? "sem egress", ttl: 0 }));
			return;
		}
		sessoes.set(m.alvo, { alvo: m.alvo, pid: m.pid, proxy: r.proxy, desde: Date.now(), eventos: [] });
		sock.write(selar({ t: "lease", alvo: m.alvo, proxy: r.proxy, livre: true, ttl: 2400 }));
		return;
	}
	if (m.t === "event") {
		sessoes.get(m.alvo)?.eventos.push({ ts: Date.now(), kind: m.kind, msg: m.msg });
		return;
	}
	if (m.t === "done") {
		sessoes.delete(m.alvo);
		return;
	}
	if (m.t === "ping") {
		sock.write(selar({ t: "pong", sessao: sessoes.size, livres: 0 }));
	}
}

export function pararBus() {
	servidor?.close();
	servidor = null;
}

/** Lado do CLI: pergunta se pode rodar e recebe o egress. Falha fechado. */
export function pedirAoOps(alvo: string, timeoutMs = 1500): Promise<{ livre: boolean; proxy: string | null; motivo?: string }> {
	return new Promise((resolve) => {
		const sock = connect({ host: "127.0.0.1", port: portaAtual() });
		let buf = "";
		const fim = (r: { livre: boolean; proxy: string | null; motivo?: string }) => {
			sock.destroy();
			resolve(r);
		};
		sock.setTimeout(timeoutMs);
		sock.on("connect", () => {
			sock.write(selar({ t: "hello", alvo, pid: process.pid } satisfies Mensagem));
		});
		sock.on("data", (d: string | Buffer) => {
			buf += d.toString();
			const i = buf.indexOf("\n");
			if (i < 0) return;
			try {
				const m = abrirEnvelope(buf.slice(0, i)) as Mensagem;
				if (m.t === "lease") fim({ livre: m.livre, proxy: m.proxy, motivo: m.motivo });
			} catch {
				fim({ livre: false, proxy: null, motivo: "resposta invalida do ops" });
			}
		});
		sock.on("timeout", () => fim({ livre: false, proxy: null, motivo: "ops nao respondeu" }));
		sock.on("error", () => fim({ livre: false, proxy: null, motivo: "ops offline" }));
	});
}

export function avisarOps(m: Mensagem) {
	try {
		const sock = connect({ host: "127.0.0.1", port: portaAtual() });
		sock.on("connect", () => {
			sock.write(selar(m));
			sock.end();
		});
		sock.on("error", () => sock.destroy());
	} catch {
		/* ops offline: o CLI segue, o registro se perde */
	}
}
