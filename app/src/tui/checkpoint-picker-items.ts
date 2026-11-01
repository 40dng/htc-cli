import type { CheckpointEntry } from "@cline/core";
import { getUserRunSpan } from "@cline/core";
import type { Message } from "@cline/shared";
import { formatDisplayUserInput, truncateStr } from "@cline/shared";
import type { CheckpointPickerItem } from "./components/dialogs/checkpoint-picker";

/**
 * Highest checkpoint recorded at or before `runCount`.
 *
 * Empate no mesmo run acontece quando duas sessoes dividem o workspace (modelo
 * novo, resume): a mais recente e a que esta transcricao escreveu, entao ela
 * vira a linha do turno e a antiga sobra como "not in this transcript".
 */
function checkpointForRun(
	checkpointHistory: readonly CheckpointEntry[],
	runCount: number,
): CheckpointEntry | undefined {
	return checkpointHistory.reduce<CheckpointEntry | undefined>(
		(best, checkpoint) => {
			if (checkpoint.runCount > runCount) {
				return best;
			}
			if (!best || checkpoint.runCount > best.runCount) {
				return checkpoint;
			}
			if (
				checkpoint.runCount === best.runCount &&
				(checkpoint.createdAt ?? 0) > (best.createdAt ?? 0)
			) {
				return checkpoint;
			}
			return best;
		},
		undefined,
	);
}

function extractText(content: Message["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter(
			(b): b is { type: "text"; text: string } =>
				typeof b === "object" &&
				b !== null &&
				"type" in b &&
				(b as { type?: unknown }).type === "text" &&
				"text" in b &&
				typeof (b as { text?: unknown }).text === "string",
		)
		.map((b) => b.text)
		.join(" ");
}

/**
 * Builds the `/undo` checkpoint picker rows from the raw conversation and the
 * recorded checkpoint history.
 *
 * The run count MUST advance with `getUserRunSpan`, exactly as the core does
 * when it numbers checkpoints and later resolves them. Tool-result messages
 * carry role "user" but contribute 0, and a compaction summary spans the turns
 * it folded. Counting raw "user" messages overcounts, so the picker would hand
 * restore a run number the core cannot map — surfacing as
 * "Could not find user message for run N" and aborting the restore.
 *
 * Snapshots recorded beyond this transcript (model switch, resumed session,
 * fresh process) still get a row: the ref exists on disk and restore can pull
 * the transcript from the session that wrote it. Without the row the picker
 * reported "No checkpoints available" while the snapshots sat in the shadow.
 */
export function buildCheckpointPickerItems(
	rawMessages: readonly Message[],
	checkpointHistory: readonly CheckpointEntry[],
): CheckpointPickerItem[] {
	const items: CheckpointPickerItem[] = [];
	const usados = new Set<string>();
	let userRunCount = 0;
	for (const msg of rawMessages) {
		const span = getUserRunSpan(msg);
		if (span < 1) {
			continue;
		}
		userRunCount += span;
		const checkpoint = checkpointForRun(checkpointHistory, userRunCount);
		if (!checkpoint) {
			continue;
		}
		const text = extractText(msg.content);
		const preview = truncateStr(
			formatDisplayUserInput(text).replace(/\s+/g, " "),
			60,
		);
		if (!preview) {
			continue;
		}
		usados.add(checkpoint.ref);
		items.push({
			runCount: userRunCount,
			text: preview,
			fullText: text,
			createdAt: checkpoint.createdAt,
		});
	}
	// O filtro e por ref, nao por runCount: sessao nova no mesmo workspace
	// tambem comeca no run 1, e `runCount <= userRunCount` escondia o snapshot
	// da sessao (modelo) anterior — o caso "voltar depois de trocar de modelo".
	// Teto: picker com centenas de linhas nao e picker.
	//
	// NAO existe mais a lista de "snapshots de fora do transcript". O historico
	// de checkpoint e do WORKSPACE (repo shadow compartilhado), e `CheckpointEntry`
	// nao carrega sessionId — logo nao da para saber de quem e o snapshot. Listar
	// essas entradas fazia: sessao com 1 mensagem mostrar 5 snapshots, e escolher
	// uma delas restaurar arquivo de OUTRA sessao com o runCount errado (o
	// "clico e vou para outra sessao"). Aqui so entra o que a transcricao resolve.
	const TETO_ITENS = 40;
	return items.length > TETO_ITENS ? items.slice(-TETO_ITENS) : items;
}
