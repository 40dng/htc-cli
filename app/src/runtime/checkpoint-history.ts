// language: TypeScript, file: src/runtime/checkpoint-history.ts, runtime: Bun
//
// O historico de checkpoint tem duas fontes: o metadata da sessao (onde o core
// grava o que ele mesmo criou) e os refs do repo-sombra (o que o workspace tem
// de fato). Trocar de modelo, retomar outra sessao ou subir a CLI de novo cria
// um id novo; se o metadata nascer vazio, o picker anunciava "No checkpoints
// available" com dezenas de snapshots no disco. Aqui as duas listas viram uma
// so — o ref e a verdade, o metadata e cache.

import { type CheckpointEntry, getUserRunSpan } from "@cline/core";
import type { MessageWithMetadata } from "@cline/shared";

function entrada_valida(entrada: CheckpointEntry | undefined): entrada is CheckpointEntry {
	return (
		!!entrada &&
		typeof entrada.ref === "string" &&
		entrada.ref.length > 0 &&
		Number.isInteger(entrada.runCount) &&
		entrada.runCount >= 1
	);
}

/**
 * Junta as duas fontes. A entrada da sessao vence a do shadow **do mesmo run e
 * da mesma sessao**: e a que o core resolve sozinho no restore, entao trocar o
 * ref criaria divergencia. Snapshot de outra sessao no mesmo run nao e o mesmo
 * snapshot — fica, senao trocar de modelo esconde o checkpoint anterior.
 */
export function mesclar_historico_de_checkpoint(
	daSessao: readonly CheckpointEntry[],
	doShadow: readonly CheckpointEntry[],
): CheckpointEntry[] {
	const chaveDe = (entrada: CheckpointEntry): string =>
		`${(entrada as { sessionId?: string }).sessionId ?? ""}/${entrada.runCount}`;
	const porChave = new Map<string, CheckpointEntry>();
	for (const entrada of doShadow) {
		if (entrada_valida(entrada)) {
			porChave.set(chaveDe(entrada), entrada);
		}
	}
	for (const entrada of daSessao) {
		if (entrada_valida(entrada)) {
			porChave.set(chaveDe(entrada), entrada);
		}
	}
	return [...porChave.values()].sort(
		(a, b) => a.runCount - b.runCount || (a.createdAt ?? 0) - (b.createdAt ?? 0),
	);
}

/**
 * Snapshot mais alto em ou antes do run pedido — mesma regra do core, para o
 * picker oferecer exatamente o run que o restore consegue resolver.
 */
export function checkpoint_para_run(
	historico: readonly CheckpointEntry[],
	runCount: number,
): CheckpointEntry | undefined {
	return historico.reduce<CheckpointEntry | undefined>((melhor, entrada) => {
		if (!entrada_valida(entrada) || entrada.runCount > runCount) {
			return melhor;
		}
		if (!melhor || entrada.runCount > melhor.runCount) {
			return entrada;
		}
		return melhor;
	}, undefined);
}

/**
 * O core recusa restaurar mensagens de um run que nao existe na transcricao
 * ("Could not find user message for run N") e tambem o que foi dobrado num
 * resumo de compactacao. Esta checagem evita chamar o restore para descobrir.
 */
export function run_esta_na_transcricao(
	messages: readonly MessageWithMetadata[],
	runCount: number,
): boolean {
	let total = 0;
	for (const mensagem of messages) {
		const span = getUserRunSpan(mensagem);
		if (span < 1) {
			continue;
		}
		total += span;
		if (total === runCount) {
			return true;
		}
		if (total > runCount) {
			return false;
		}
	}
	return false;
}
