// language: TypeScript, file: src/commands/slots.ts, runtime: bun/node
/**
 * htc slot — credenciais por sessao.
 *
 *   htc slot                          lista os 4 slots (chave mascarada)
 *   htc slot 2 key oc_sk_xxx          grava a chave do slot 2 e publica
 *   htc slot 2 modelo deepseek-v4-pro muda o modelo do slot 2
 *   htc slot 2 base https://...       muda o endpoint do slot 2
 *   htc slot --json                   estado cru
 *
 * Depois de gravar, cada sessao escolhe o slot no `/model` (provider go-slot-N).
 * A chave fica no providers.json — nunca em argv de processo do agente.
 */
import {
	chaveMascarada,
	definirSlot,
	idDoSlot,
	listarSlots,
} from "../utils/slots";

export interface SlotsOptions {
	args?: string[];
	json?: boolean;
}

export async function runSlot(opts: SlotsOptions = {}): Promise<number> {
	const [slotBruto, verbo, ...resto] = opts.args ?? [];
	const { aplicarSlots } = await import("../utils/slots");

	if (opts.json) {
		console.log(
			JSON.stringify(
				listarSlots().map((slot) => ({
					n: slot.n,
					provider: slot.id,
					modelo: slot.modelo,
					baseUrl: slot.baseUrl,
					chave: chaveMascarada(slot.apiKey),
					configurado: Boolean(slot.apiKey),
				})),
				null,
				2,
			),
		);
		return 0;
	}

	if (!slotBruto) {
		const slots = listarSlots();
		const { ProviderSettingsManager } = await import("@cline/core");
		const publicados = await aplicarSlots(new ProviderSettingsManager()).catch(
			() => [] as string[],
		);
		for (const slot of slots) {
			const estado = slot.apiKey
				? `${chaveMascarada(slot.apiKey)}  ${slot.modelo}`
				: "(sem chave)";
			console.log(
				`${slot.n}  ${slot.id.padEnd(11)} ${estado}${
					publicados.includes(slot.id) ? "  [publicado]" : ""
				}`,
			);
		}
		console.log(
			"\nuse: htc slot <n> key <chave>  |  htc slot <n> modelo <id>  |  depois /model -> go-slot-<n>",
		);
		return 0;
	}

	const n = Number.parseInt(slotBruto, 10);
	if (!Number.isInteger(n) || n < 1) {
		console.error("uso: htc slot <1-4> [key|modelo|base] <valor>");
		return 1;
	}

	if (!verbo) {
		const slot = listarSlots().find((item) => item.n === n);
		if (!slot) return 1;
		console.log(JSON.stringify({ ...slot, apiKey: chaveMascarada(slot.apiKey) }, null, 2));
		return 0;
	}

	const valor = resto.join(" ").trim();
	if (!valor) {
		console.error(`uso: htc slot ${n} ${verbo} <valor>`);
		return 1;
	}

	const acao = verbo.toLowerCase();
	if (acao === "key" || acao === "chave") {
		definirSlot(n, { apiKey: valor });
	} else if (acao === "modelo" || acao === "model") {
		definirSlot(n, { modelo: valor });
	} else if (acao === "base" || acao === "url") {
		definirSlot(n, { baseUrl: valor });
	} else {
		console.error(`verbo desconhecido: ${verbo} (use key|modelo|base)`);
		return 1;
	}

	const { ProviderSettingsManager } = await import("@cline/core");
	const publicados = await aplicarSlots(new ProviderSettingsManager()).catch(
		() => [] as string[],
	);
	const slot = listarSlots().find((item) => item.n === n);
	console.log(
		`slot ${n} -> ${idDoSlot(n)} | ${slot ? chaveMascarada(slot.apiKey) : "(sem chave)"} | ${
			slot?.modelo ?? ""
		}${publicados.includes(idDoSlot(n)) ? " | publicado" : ""}`,
	);
	console.log(`no TUI: /model -> ${idDoSlot(n)}`);
	return 0;
}
