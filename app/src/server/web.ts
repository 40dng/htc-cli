import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirPainelBuild } from "../utils/painel";
import {
	alvo,
	aprovacoes,
	decidir,
	disparar,
	egress,
	egressResumo,
	eventosDesde,
	eventosRecentes,
	fila,
	frota,
	leakradar,
	leases,
	liberarLease,
	mudarFase,
	pedirLease,
	registrarEvento,
	resumo,
	substrato,
} from "./fleet";

// build estatico do painel (Next export) — resolvido em runtime, nao por import.meta
const UI_DIR = dirPainelBuild();

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function mime_de(caminho: string) {
	const ponto = caminho.lastIndexOf(".");
	return ponto >= 0 ? (MIME[caminho.slice(ponto).toLowerCase()] ?? "application/octet-stream") : "application/octet-stream";
}

function servir_estatico(rota: string): Response | null {
	if (rota.includes("..")) return null;
	const relativo = rota.replace(/^\/+/, "") || "index.html";
	const caminho = UI_DIR + relativo;
	const arquivo = Bun.file(caminho);
	if (!arquivo.size) return null;
	return new Response(arquivo, {
		headers: {
			"content-type": mime_de(caminho),
			"cache-control": caminho.includes("/_next/") ? "public, max-age=31536000, immutable" : "no-store",
		},
	});
}

function json(dados: unknown, status = 200) {
	return new Response(JSON.stringify(dados), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

/** Host de um alvo com ou sem esquema, para comparar missao e frota. */
function hostDe(valor: string): string {
	try {
		return new URL(valor.includes("://") ? valor : `https://${valor}`).hostname.toLowerCase();
	} catch {
		return valor.trim().toLowerCase().replace(/\/+$/, "");
	}
}

function mesmoAlvo(a: string, b: string): boolean {
	const ha = hostDe(a);
	const hb = hostDe(b);
	return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

/** Provider/modelo que o CLI usaria agora — lido de providers.json, nao inventado. */
function provedorPadrao(env: NodeJS.ProcessEnv = process.env): {
	provider?: string;
	model?: string;
} {
	if (env.HTC_WEB_PROVIDER?.trim()) {
		return {
			provider: env.HTC_WEB_PROVIDER.trim(),
			model: env.HTC_WEB_MODEL?.trim() || undefined,
		};
	}
	try {
		const arquivo = join(homedir(), ".htc", "data", "settings", "providers.json");
		const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as {
			lastUsedProvider?: string;
			providers?: Record<string, { settings?: { model?: string } }>;
		};
		const provider = bruto.lastUsedProvider?.trim() || undefined;
		const model = provider ? bruto.providers?.[provider]?.settings?.model?.trim() : undefined;
		return { provider, model };
	} catch {
		return {};
	}
}

/** Agente do chat: o MESMO entrypoint do CLI, em modo --json. */
function comandoAgente(env: NodeJS.ProcessEnv = process.env): string[] {
	const bruto = env.HTC_WEB_AGENT_CMD?.trim() || "bun run src/index.ts";
	return bruto.split(/\s+/).filter(Boolean);
}

function ehLoopback(host: string): boolean {
	return /^(127\.|localhost$|::1$|\[::1\])/.test(host);
}

/** Regra de acesso ao painel: loopback livre; interface roteavel exige token. */
export function politicaDeAcesso(host: string, token?: string): "livre" | "token" | "sem-token" {
	const esperado = token?.trim();
	if (ehLoopback(host)) return esperado ? "token" : "livre";
	return esperado ? "token" : "sem-token";
}

function tokenDoPedido(req: Request, url: URL): string {
	const cabecalho = req.headers.get("authorization") ?? "";
	if (cabecalho.toLowerCase().startsWith("bearer ")) return cabecalho.slice(7).trim();
	return (url.searchParams.get("token") ?? "").trim();
}

// Ranking do garimpo: deterministico e auditavel. LLM entra so como reforco opcional.
type ItemGarimpo = { url?: string; username?: string; password?: string; host?: string; service?: string; added?: string };

export function ranquearGarimpo(dominio: string | null, itens: ItemGarimpo[], termo?: string) {
	const d = (dominio ?? "").toLowerCase();
	const t = (termo ?? "").toLowerCase();
	return itens
		.map((it) => {
			const url = it.url ?? "";
			const host = (it.host ?? url.replace(/^[a-z]+:\/\//, "").split("/")[0] ?? "").toLowerCase();
			const frase = `${it.username ?? "?"}${it.password ? `:${it.password}` : ""} @ ${host || (it.service ?? "?")}`;
			let score = 0;
			if (it.password) score += 15;
			if (it.username) score += 5;
			if (host && d && (host === d || host.endsWith(`.${d}`))) score += 40;
			if (url) score += 10;
			if (t && `${host} ${it.service ?? ""} ${frase}`.toLowerCase().includes(t)) score += 25;
			if (/^2026/.test(it.added ?? "")) score += 10;
			return { item: it, frase, score };
		})
		.sort((a, b) => b.score - a.score);
}

function garimpo(corpo: { dominio?: string; termo?: string; itens?: ItemGarimpo[] }) {
	const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
	if (!itens.length) {
		return json({ erro: "sem itens: envie itens[] (a fonte de vazamento roda fora do broker)" }, 503);
	}
	const rank = ranquearGarimpo(corpo.dominio ?? null, itens, corpo.termo);
	const top = rank.slice(0, 25);
	registrarEvento(corpo.dominio ?? null, "garimpo", `${top.length} itens ranqueados de ${itens.length}`);
	return json({ ok: true, total: itens.length, ranqueados: top, llm: false });
}

/** Sobe o painel. Leitura + aprovacao; nenhum comando livre. */
export function iniciarWeb(porta = 8787, opcoes: { host?: string } = {}) {
	const host = opcoes.host ?? process.env.HTC_WEB_HOST?.trim() ?? "127.0.0.1";
	const politica = politicaDeAcesso(host, process.env.HTC_WEB_TOKEN);
	const clientes = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const enc = new TextEncoder();
	let ultimo = 0;

	const tique = setInterval(() => {
		if (!clientes.size) return;
		try {
			const novos = eventosDesde(ultimo);
			for (const e of novos) {
				ultimo = Math.max(ultimo, Number((e as { id: number }).id));
				const linha = `data: ${JSON.stringify(e)}\n\n`;
				for (const c of clientes) c.enqueue(enc.encode(linha));
			}
		} catch {
			/* banco ocupado: tenta no proximo tique */
		}
	}, 3000);

	const servidor = Bun.serve({
		port: porta,
		hostname: host,
		idleTimeout: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const rota = url.pathname;

			// Guarda de acesso: leitura/escrita da API e o SSE. Estatico nao expoe estado.
			const protegido = rota.startsWith("/api/") || rota === "/events";
			if (protegido) {
				if (politica === "sem-token") {
					return json(
						{ erro: "painel em interface roteavel exige HTC_WEB_TOKEN" },
						403,
					);
				}
				if (politica === "token") {
					const esperado = process.env.HTC_WEB_TOKEN?.trim() ?? "";
					const recebido = tokenDoPedido(req, url);
					const tamanhoIgual = recebido.length === esperado.length;
					const ok =
						tamanhoIgual &&
						timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
					if (!ok) return json({ erro: "token invalido" }, 401);
				}
			}

			if (rota === "/" || rota === "/index.html") {
				return servir_estatico("/") ?? json({ erro: "build do painel ausente - rode bun run build em web/" }, 503);
			}
			try {
				if (rota === "/api/fleet") return json({ resumo: resumo(), frota: frota(255) });
				if (rota === "/api/egress") return json({ pool: egress(), resumo: egressResumo(), leases: leases() });
				if (rota === "/api/leakradar") return json(leakradar());
				if (rota === "/api/lease" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as { host?: string; dono?: string };
					if (!corpo.host) return json({ erro: "host obrigatorio" }, 400);
					return json(pedirLease(corpo.host, corpo.dono));
				}
				if (rota.startsWith("/api/lease/") && req.method === "DELETE") {
					return json(liberarLease(decodeURIComponent(rota.slice("/api/lease/".length))));
				}
				if (rota === "/api/tasks") return json(fila());
				if (rota === "/api/supply") return json(substrato());
				if (rota === "/api/dispatch" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as {
						alvo?: string;
						prompt?: string;
						prioridade?: number;
					};
					if (!corpo.alvo) return json({ erro: "alvo obrigatorio" }, 400);
					const prompt = (corpo.prompt ?? "").trim() || "recon completo, doutrina padrao, ate o objetivo";
					return json(disparar(corpo.alvo, prompt, corpo.prioridade ?? 8));
				}
				if (rota === "/api/approvals" && req.method === "GET") return json(aprovacoes());
				if (rota.startsWith("/api/approvals/") && req.method === "POST") {
					const id = Number(rota.split("/").pop());
					const corpo = (await req.json().catch(() => ({}))) as { decisao?: string };
					return json(decidir(id, corpo.decisao ?? "negado"));
				}
				if (rota.startsWith("/api/target/") && rota.endsWith("/fase") && req.method === "POST") {
					const dominio = decodeURIComponent(rota.slice("/api/target/".length, -"/fase".length));
					const corpo = (await req.json().catch(() => ({}))) as { fase?: string };
					if (!corpo.fase) return json({ erro: "fase obrigatoria" }, 400);
					// O banco da frota pode estar ausente/ocupado; a missao nao pode
					// ficar para tras por isso. Cada escrita falha sozinha.
					let r: unknown;
					try {
						r = mudarFase(dominio, corpo.fase);
					} catch (erro) {
						r = { erro: String(erro) };
					}
					// O arrasto do kanban escreve nos dois lugares: banco da frota e
					// missao que o agente le. Uma fonte so nao pode ficar para tras.
					try {
						const { carregarMissao, definirFase, FASES } = await import("../runtime/missao");
						const fase = corpo.fase.toLowerCase();
						const missao = carregarMissao();
						if (
							missao &&
							!missao.fechada &&
							(FASES as string[]).includes(fase) &&
							mesmoAlvo(missao.alvo, dominio)
						) {
							definirFase(fase as (typeof FASES)[number]);
						}
					} catch {
						// missao e best-effort: o quadro nao falha por isso
					}
					return json(r);
				}
				// Missao: mesma fonte do CLI (src/runtime/missao.ts), nunca uma copia.
				if (rota === "/api/missao" && req.method === "GET") {
					const { carregarMissao, listarIntel } = await import("../runtime/missao");
					return json({ missao: carregarMissao() ?? null, intel: listarIntel() });
				}
				if (rota === "/api/missao/fase" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as { alvo?: string; fase?: string };
					const { carregarMissao, definirFase, FASES } = await import("../runtime/missao");
					const fase = String(corpo.fase ?? "").toLowerCase();
					if (!(FASES as string[]).includes(fase)) {
						return json({ erro: `fase invalida: ${corpo.fase ?? ""}` }, 400);
					}
					const missao = carregarMissao();
					if (!missao) return json({ erro: "sem missao aberta" }, 409);
					if (corpo.alvo && !mesmoAlvo(missao.alvo, corpo.alvo)) {
						return json({ erro: `missao aberta em ${missao.alvo}` }, 409);
					}
					const atualizada = definirFase(fase as (typeof FASES)[number]);
					try {
						if (missao.alvo) registrarEvento(missao.alvo, "missao", `fase ${fase}`);
					} catch {
						// log do plano de controle e opcional: o estado ja foi gravado
					}
					return json({ ok: true, missao: atualizada ?? null });
				}
				if (rota.startsWith("/api/target/")) {
					return json(alvo(decodeURIComponent(rota.slice("/api/target/".length))));
				}
				if (rota === "/api/monitor" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as { dominios?: string[] };
					const m = await import("./monitor");
					const perfil = await m.perfil();
					const r = await m.monitorar(corpo.dominios?.length ? corpo.dominios : m.dominiosDoAcervo(20));
					return json({ perfil, ...r });
				}
				if (rota === "/api/suprimento" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as { texto?: string };
					const { executar } = await import("../commands/suprimento");
					return json(await executar((corpo.texto ?? "").slice(0, 200)));
				}
				if (rota === "/api/log") {
					const limite = Number(url.searchParams.get("limite") ?? 200);
					return json({ eventos: eventosRecentes(Number.isFinite(limite) ? limite : 200) });
				}
				if (rota === "/api/garimpo" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as { dominio?: string; termo?: string; itens?: ItemGarimpo[] };
					return garimpo(corpo);
				}
				// Chat = o runtime do CLI, em --json, transmitido linha a linha.
				if (rota === "/api/chat" && req.method === "POST") {
					const corpo = (await req.json().catch(() => ({}))) as {
						prompt?: string;
						alvo?: string;
						sessao?: string;
					};
					const prompt = String(corpo.prompt ?? "").trim().slice(0, 12_000);
					if (!prompt) return json({ erro: "prompt obrigatorio" }, 400);

					// Alvo escolhido no painel abre/reaproveita a missao que o agente le.
					if (corpo.alvo?.trim()) {
						try {
							const { abrirMissao } = await import("../runtime/missao");
							abrirMissao({ alvo: corpo.alvo.trim() });
						} catch {
							// missao e best-effort: o chat nao para por isso
						}
					}

					const { provider, model } = provedorPadrao();
					const args = [...comandoAgente(), "--json"];
					if (provider) args.push("-P", provider);
					if (model) args.push("-m", model);
					if (corpo.sessao?.trim()) args.push("--id", corpo.sessao.trim());
					// `--` fecha as flags: prompt com "-" na frente nao vira opcao.
					args.push("--", prompt);

					const proc = Bun.spawn(args, {
						cwd: process.cwd(),
						env: { ...process.env, HTC_WEB_CHAT: "1" },
						stdout: "pipe",
						stderr: "pipe",
					});
					const codificador = new TextEncoder();
					const fluxo = new ReadableStream<Uint8Array>({
						async start(controller) {
							const enviar = (obj: unknown) => {
								controller.enqueue(codificador.encode(`data: ${JSON.stringify(obj)}\n\n`));
							};
							const bombear = async (
								saida: ReadableStream<Uint8Array>,
								canal: "stdout" | "stderr",
							) => {
								const leitor = saida.getReader();
								const decodificador = new TextDecoder();
								let resto = "";
								for (;;) {
									const { done, value } = await leitor.read();
									if (done) break;
									resto += decodificador.decode(value, { stream: true });
									const linhas = resto.split("\n");
									resto = linhas.pop() ?? "";
									for (const linha of linhas) {
										const texto = linha.trim();
										if (!texto) continue;
										try {
											enviar(JSON.parse(texto));
										} catch {
											enviar({ type: canal, line: texto });
										}
									}
								}
								const texto = resto.trim();
								if (texto) {
									try {
										enviar(JSON.parse(texto));
									} catch {
										enviar({ type: canal, line: texto });
									}
								}
							};
							req.signal.addEventListener("abort", () => {
								try {
									proc.kill();
								} catch {
									// processo ja saiu
								}
							});
							try {
								await Promise.all([
									bombear(proc.stdout as ReadableStream<Uint8Array>, "stdout"),
									bombear(proc.stderr as ReadableStream<Uint8Array>, "stderr"),
								]);
								enviar({ type: "exit", code: await proc.exited });
							} catch (erro) {
								enviar({ type: "error", message: String(erro) });
							} finally {
								controller.close();
							}
						},
						cancel() {
							try {
								proc.kill();
							} catch {
								// ja saiu
							}
						},
					});
					return new Response(fluxo, {
						headers: {
							"content-type": "text/event-stream",
							"cache-control": "no-cache",
							connection: "keep-alive",
						},
					});
				}
				if (rota === "/events") {
					const stream = new ReadableStream<Uint8Array>({
						start(c) {
							clientes.add(c);
							c.enqueue(enc.encode("retry: 3000\n\n"));
							// replay: quem abre a tela ve o historico, nao so o futuro
							try {
								for (const e of eventosRecentes(200)) {
									c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
									ultimo = Math.max(ultimo, Number(e.id));
								}
							} catch {
								/* banco ocupado: segue sem replay */
							}
							req.signal.addEventListener("abort", () => clientes.delete(c));
						},
						cancel() {},
					});
					return new Response(stream, {
						headers: {
							"content-type": "text/event-stream",
							"cache-control": "no-cache",
							connection: "keep-alive",
						},
					});
				}
				// estatico do painel (/_next/*, favicon) e fallback da SPA
			if (!rota.startsWith("/api/")) {
				const estatico = servir_estatico(rota);
				if (estatico) return estatico;
			}
			return json({ erro: "rota inexistente" }, 404);
			} catch (e) {
				return json({ erro: String(e) }, 500);
			}
		},
	});

	const parar = () => {
		clearInterval(tique);
		servidor.stop(true);
	};
	process.on("SIGINT", parar);
	return { servidor, parar, url: `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${servidor.port}/` };
}
