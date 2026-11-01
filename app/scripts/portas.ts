// language: TypeScript, file: scripts/portas.ts, runtime: Bun
// Sonda TCP com timeout curto e saida determinista (o shell desta bancada
// devolve vazio em Test-NetConnection). Uso:
//   bun scripts/portas.ts <host> <porta>[,<porta>...] [timeoutMs]
import { connect } from "node:net";

const [host, portasArg, msArg] = process.argv.slice(2);
if (!host || !portasArg) {
	console.log("uso: bun scripts/portas.ts <host> <porta,porta> [timeoutMs]");
	process.exit(2);
}
const portas = portasArg.split(",").map((p) => Number(p.trim())).filter(Number.isFinite);
const timeout = Number(msArg ?? 2500);

function sonda(porta: number): Promise<string> {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const sock = connect({ host, port: porta });
		let feito = false;
		const fim = (txt: string) => {
			if (feito) return;
			feito = true;
			sock.destroy();
			resolve(`${host}:${porta} => ${txt} (${Date.now() - t0}ms)`);
		};
		sock.setTimeout(timeout);
		sock.once("connect", () => fim("aberta"));
		sock.once("timeout", () => fim("timeout"));
		sock.once("error", (e: NodeJS.ErrnoException) => fim(`erro ${e.code ?? e.message}`));
	});
}

for (const r of await Promise.all(portas.map(sonda))) console.log(r);
