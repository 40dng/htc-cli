/**
 * HTC — telemetria de recusa
 *
 * Uma linha por recusa detectada em `~/.htc/state/recusas.jsonl`:
 * qual padrao casou, qual payload estava ativo e para qual foi trocado.
 * Serve para descobrir qual A/B funciona por modelo — sem rede, sem dado de fora.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RecusaRegistro {
	resposta: string;
	padrao: number;
	payloadAtual: number;
	proximoPayload: number;
	esgotado: boolean;
}

export function caminhoRecusas(): string {
	const dir = process.env.HTC_STATE_DIR?.trim()
		? join(process.env.HTC_STATE_DIR.trim(), "state")
		: join(homedir(), ".htc", "state");
	mkdirSync(dir, { recursive: true });
	return join(dir, "recusas.jsonl");
}

export function registrarRecusa(registro: RecusaRegistro): void {
	try {
		const linha = {
			em: new Date().toISOString(),
			padrao: registro.padrao,
			payload: registro.payloadAtual,
			proximo: registro.proximoPayload,
			esgotado: registro.esgotado,
			// trecho curto: o suficiente para reconhecer a recusa, sem despejar a resposta
			trecho: registro.resposta.replace(/\s+/g, " ").slice(0, 160),
		};
		appendFileSync(caminhoRecusas(), `${JSON.stringify(linha)}\n`, "utf8");
	} catch {
		// telemetria nunca derruba a sessao
	}
}
