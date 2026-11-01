// language: TypeScript, file: src/utils/socks_bridge.ts, runtime: Bun
// O fetch do Bun recusa `socks4://`/`socks5://` como proxy
// ("UnsupportedProxyProtocol"), mas aceita `http://` via CONNECT. Este bridge
// sobe um proxy HTTP CONNECT em 127.0.0.1 e encadeia cada conexao num upstream
// SOCKS4/4a/5. Assim o servidor opencode (que so entende HTTP_PROXY/HTTPS_PROXY)
// sai pelo proxy residencial. Apenas node:net — sem dependencia externa.

import { connect, type Socket } from "node:net";
import { createServer, type Server } from "node:http";
import { lookup } from "node:dns/promises";

export interface UpstreamSocks {
	versao: 4 | 5;
	host: string;
	porta: number;
}

export interface BridgeSocks {
	/** URL http://127.0.0.1:<porta> para HTTPS_PROXY. */
	url: string;
	porta: number;
	fechar(): Promise<void>;
}

export interface OpcoesDoBridge {
	portaLocal?: number;
	/** Observa cada CONNECT que o bridge encaminha (diagnostico). */
	aoConectar?: (alvo: string) => void;
}

const BOM_DE_COMANDO_SOCKS4 = 0x01;
const SOCKS4_GRANTED = 0x5a;
const SOCKS4A_IP_FALSO = [0x00, 0x00, 0x00, 0x01];
const SOCKS5_SEM_AUTH = 0x00;
const SOCKS5_COMANDO_CONNECT = 0x01;
const SOCKS5_ATYP_IPV4 = 0x01;
const SOCKS5_ATYP_DOMINIO = 0x03;
const SOCKS5_ATYP_IPV6 = 0x04;

/** Aceita `socks4://host:porta`, `socks5://host:porta` ou `host:porta` (4 default). Ignora o `|...` das listas. */
export function parsear_upstream_socks(proxy: string): UpstreamSocks | null {
	const limpo = proxy.trim().split("|")[0]?.trim() ?? "";
	if (!limpo) {
		return null;
	}
	const comEsquema = limpo.includes("://") ? limpo : `socks4://${limpo}`;
	let url: URL;
	try {
		url = new URL(comEsquema);
	} catch {
		return null;
	}
	const esquema = url.protocol.replace(":", "").toLowerCase();
	if (
		esquema !== "socks4" &&
		esquema !== "socks4a" &&
		esquema !== "socks5" &&
		esquema !== "socks5h"
	) {
		return null;
	}
	const porta = Number.parseInt(url.port, 10);
	if (!url.hostname || !Number.isInteger(porta) || porta < 1 || porta > 65535) {
		return null;
	}
	return { versao: esquema.startsWith("socks5") ? 5 : 4, host: url.hostname, porta };
}

function bytesDePorta(porta: number): number[] {
	return [(porta >> 8) & 0xff, porta & 0xff];
}

function ehIpv4Literal(host: string): boolean {
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function construirPedidoSocks4(host: string, porta: number): Buffer {
	const alvo = ehIpv4Literal(host)
		? Buffer.from(host.split(".").map((parte) => Number.parseInt(parte, 10)))
		: Buffer.from(SOCKS4A_IP_FALSO);
	const cabecalho = Buffer.from([0x04, BOM_DE_COMANDO_SOCKS4, ...bytesDePorta(porta)]);
	const useridVazio = Buffer.from([0x00]);
	if (ehIpv4Literal(host)) {
		return Buffer.concat([cabecalho, alvo, useridVazio]);
	}
	// SOCKS4a: IP falso + userid vazio + hostname NUL-terminado.
	return Buffer.concat([
		cabecalho,
		alvo,
		useridVazio,
		Buffer.from(host, "utf8"),
		Buffer.from([0x00]),
	]);
}

function handshakeSocks4(socket: Socket, host: string, porta: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const aoReceber = (dados: Buffer) => {
			if (dados.length < 8) {
				return;
			}
			socket.off("data", aoReceber);
			if (dados[1] === SOCKS4_GRANTED) {
				resolve();
				return;
			}
			reject(new Error(`socks4 recusou a conexao (codigo 0x${dados[1].toString(16)})`));
		};
		socket.on("data", aoReceber);
		socket.once("error", reject);
		socket.write(construirPedidoSocks4(host, porta));
	});
}


function enderecoSocks5(host: string): Buffer {
	if (ehIpv4Literal(host)) {
		return Buffer.concat([
			Buffer.from([SOCKS5_ATYP_IPV4]),
			Buffer.from(host.split(".").map((parte) => Number.parseInt(parte, 10))),
		]);
	}
	const dominio = Buffer.from(host, "utf8");
	return Buffer.concat([Buffer.from([SOCKS5_ATYP_DOMINIO, dominio.length]), dominio]);
}

function tamanhoDaRespostaSocks5(dados: Buffer): number {
	if (dados[3] === SOCKS5_ATYP_IPV4) {
		return 10;
	}
	if (dados[3] === SOCKS5_ATYP_IPV6) {
		return 22;
	}
	return 7 + (dados[4] ?? 0);
}

function handshakeSocks5(socket: Socket, host: string, porta: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let etapa: "metodo" | "resposta" = "metodo";
		const aoReceber = (dados: Buffer) => {
			if (etapa === "metodo") {
				if (dados.length < 2) {
					return;
				}
				if (dados[0] !== 0x05 || dados[1] !== SOCKS5_SEM_AUTH) {
					socket.off("data", aoReceber);
					reject(new Error("socks5 exige autenticacao nao suportada"));
					return;
				}
				etapa = "resposta";
				socket.write(
					Buffer.concat([
						Buffer.from([0x05, SOCKS5_COMANDO_CONNECT, 0x00]),
						enderecoSocks5(host),
						Buffer.from(bytesDePorta(porta)),
					]),
				);
				return;
			}
			if (dados.length < 4) {
				return;
			}
			if (dados[1] !== 0x00) {
				socket.off("data", aoReceber);
				reject(new Error(`socks5 recusou a conexao (codigo ${dados[1]})`));
				return;
			}
			if (dados.length < tamanhoDaRespostaSocks5(dados)) {
				return;
			}
			socket.off("data", aoReceber);
			resolve();
		};
		socket.on("data", aoReceber);
		socket.once("error", reject);
		socket.write(Buffer.from([0x05, 0x01, SOCKS5_SEM_AUTH]));
	});
}

function handshake(
	socket: Socket,
	upstream: UpstreamSocks,
	host: string,
	porta: number,
): Promise<void> {
	return upstream.versao === 5
		? handshakeSocks5(socket, host, porta)
		: handshakeSocks4(socket, host, porta);
}

/** Resolve o alvo para IPv4 literal; guarda o hostname original para o fallback SOCKS4a. */
async function resolverAlvo(
	host: string,
): Promise<{ host: string; ipOriginal: string }> {
	if (ehIpv4Literal(host)) {
		return { host, ipOriginal: host };
	}
	const { address } = await lookup(host, { family: 4 });
	return { host: address, ipOriginal: host };
}

/** Sobe o bridge em 127.0.0.1. `portaLocal` 0 deixa o SO escolher uma porta livre. */
export async function iniciar_bridge_socks(
	proxy: string,
	portaLocalOuOpcoes: number | OpcoesDoBridge = 0,
): Promise<BridgeSocks> {
	const opcoes: OpcoesDoBridge =
		typeof portaLocalOuOpcoes === "number"
			? { portaLocal: portaLocalOuOpcoes }
			: portaLocalOuOpcoes;
	const portaLocal = opcoes.portaLocal ?? 0;
	const upstream = parsear_upstream_socks(proxy);
	if (!upstream) {
		throw new Error(`proxy socks invalido: ${proxy}`);
	}
	const servidor: Server = createServer();
	// O bridge so atende CONNECT; qualquer request HTTP direta e recusada.
	servidor.on("request", (_pedido, resposta) => {
		resposta.writeHead(405, { "content-type": "text/plain" }).end("CONNECT only");
	});
	servidor.on("connect", (pedido, socketBruto, cabecaInicial) => {
		const socketDoCliente = socketBruto as unknown as Socket;
		const [host, portaTexto] = (pedido.url ?? "").split(":");
		const porta = Number.parseInt(portaTexto ?? "443", 10);
		if (!host || !Number.isInteger(porta)) {
			socketDoCliente.destroy();
			return;
		}
		opcoes.aoConectar?.(`${host}:${porta}`);
		// Varios proxies SOCKS4 publicos nao implementam SOCKS4a (hostname no
		// pedido). Resolvemos o DNS aqui e mandamos sempre um IPv4 literal.
		resolverAlvo(host)
			.then(({ host: hostResolvido, ipOriginal }) => {
				const socketUpstream = connect({ host: upstream.host, port: upstream.porta });
				const abortar = () => {
					socketDoCliente.destroy();
					socketUpstream.destroy();
				};
				socketDoCliente.once("error", abortar);
				socketUpstream.once("error", abortar);
				socketUpstream.once("connect", () => {
					handshake(socketUpstream, upstream, hostResolvido, porta)
						.then(() => {
							socketDoCliente.write("HTTP/1.1 200 Connection Established\r\n\r\n");
							if (cabecaInicial && cabecaInicial.length > 0) {
								socketUpstream.write(cabecaInicial);
							}
							socketUpstream.pipe(socketDoCliente);
							socketDoCliente.pipe(socketUpstream);
						})
						.catch(() => {
							// Fallback: tenta SOCKS4a com o hostname original.
							const soc4a = connect({ host: upstream.host, port: upstream.porta });
							soc4a.once("error", abortar);
							soc4a.once("connect", () => {
								handshake(soc4a, upstream, ipOriginal, porta)
									.then(() => {
										socketDoCliente.write("HTTP/1.1 200 Connection Established\r\n\r\n");
										if (cabecaInicial && cabecaInicial.length > 0) {
											soc4a.write(cabecaInicial);
										}
										soc4a.pipe(socketDoCliente);
										socketDoCliente.pipe(soc4a);
									})
									.catch(abortar);
							});
						});
				});
			})
			.catch(() => socketDoCliente.destroy());
	});
	await new Promise<void>((resolve, reject) => {
		servidor.once("error", reject);
		servidor.listen(portaLocal, "127.0.0.1", resolve);
	});
	const endereco = servidor.address();
	const porta = typeof endereco === "object" && endereco ? endereco.port : portaLocal;
	return {
		url: `http://127.0.0.1:${porta}`,
		porta,
		fechar: () =>
			new Promise<void>((resolve) => {
				servidor.close(() => resolve());
			}),
	};
}
