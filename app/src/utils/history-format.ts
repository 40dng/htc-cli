import type { SessionHistoryRecord } from "@cline/core";
import { formatDisplayUserInput, truncateStr } from "@cline/shared";
import { formatUsd } from "./output";
import { shouldShowCliUsageCost } from "./usage-cost-display";

export function formatSessionStatusLabel(
	status: SessionHistoryRecord["status"] | undefined,
): string {
	return status?.trim() || "unknown";
}

export function mergeHistoryStatusRows(
	currentRows: SessionHistoryRecord[],
	refreshedRows: SessionHistoryRecord[],
): SessionHistoryRecord[] {
	const currentById = new Map(
		currentRows.map((row) => [row.sessionId, row] as const),
	);

	return refreshedRows.map((row) => {
		const current = currentById.get(row.sessionId);
		if (!current) {
			return row;
		}
		return {
			...current,
			status: row.status,
			endedAt: row.endedAt,
			exitCode: row.exitCode,
			updatedAt: row.updatedAt,
		};
	});
}

/**
 * Tira do titulo o que o runtime escreveu, nao o operador: enquadramento de
 * retry (`The last run on X stopped short…`), prompt de continuacao e a cauda de
 * missao. Sem isso o /history e o `htc history` ficam com lixo de payload.
 */
const PREFIXOS_DO_RUNTIME = [
	/^The last run on .{1,120}? stopped short of the objective\.\s*/i,
	/^Work order:\s*\S+\s*/i,
	/^\S+ is in hand\.\s*/i,
	/^Host in hand:\s*\S+\s*/i,
	/^TARGET:\s*\S+\s*/i,
	/^Continue\.\s*Nao escreva board[\s\S]*$/i,
	/^Continue the operation from the document[\s\S]*$/i,
	/^Resume from the last result the tools returned[\s\S]*$/i,
];

export function limparTituloDeRuntime(texto: string): string {
	let saida = texto;
	for (const prefixo of PREFIXOS_DO_RUNTIME) {
		const antes = saida;
		saida = saida.replace(prefixo, "").trim();
		if (saida !== antes) break;
	}
	return saida.replace(/^(?:[-–—:;,.]+[\s]*)+/, "").trim();
}

function formatHistoryTitle(
	title: string | undefined,
	prompt: string | undefined,
): string | undefined {
	const rawTitle = title?.trim() || prompt?.trim() || undefined;
	if (!rawTitle) return;
	const semRuntime = limparTituloDeRuntime(rawTitle) || "(continuacao)";
	const normalized = formatDisplayUserInput(semRuntime);
	return truncateStr(normalized.replace(/\s+/g, " "), 40);
}

export function formatCheckpointBadge(
	row: SessionHistoryRecord,
): string | undefined {
	const checkpoint = row.metadata?.checkpoint;
	const count = checkpoint?.history?.length ?? 0;
	const latestRun = checkpoint?.latest?.runCount;
	if (count <= 0) {
		return undefined;
	}
	if (typeof latestRun === "number" && Number.isFinite(latestRun)) {
		const total = count > 99 ? "99+" : String(count);
		return `CP ${total} R${latestRun}`;
	}
	return `CP ${count}`;
}

export function formatCheckpointDetail(
	row: SessionHistoryRecord,
): string | undefined {
	const checkpoint = row.metadata?.checkpoint;
	const count = checkpoint?.history?.length ?? 0;
	const latest = checkpoint?.latest;
	if (count <= 0 || !latest?.ref) {
		return undefined;
	}
	const shortRef = truncateStr(latest.ref, 12);
	const created =
		typeof latest.createdAt === "number" && Number.isFinite(latest.createdAt)
			? formatUtcDate(new Date(latest.createdAt))
			: "unknown";
	const latestRun =
		typeof latest.runCount === "number" && Number.isFinite(latest.runCount)
			? ` run ${latest.runCount}`
			: "";
	return `Checkpoint ${shortRef}${latestRun} created ${created}. ${count} total. Restore with: cline checkpoint restore latest --session-id ${row.sessionId}`;
}

function formatUtcDate(date: Date): string {
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const year = date.getUTCFullYear();
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	return `${month}/${day}/${year} ${hour}:${minute}`;
}

export function formatHistoryListLine(row: SessionHistoryRecord): string {
	const title = formatHistoryTitle(row.metadata?.title, row.prompt);
	if (!title) return "";
	const cost = shouldShowCliUsageCost(row.provider)
		? formatUsd(row.metadata?.totalCost ?? 0, 2)
		: undefined;
	const provider = truncateStr(row.provider?.trim() || "unknown", 20);
	const model = truncateStr(row.model?.trim() || "", 28);

	const checkpointCreatedAt = row.metadata?.checkpoint?.latest?.createdAt;
	const timestamp =
		typeof checkpointCreatedAt === "number" &&
		Number.isFinite(checkpointCreatedAt)
			? checkpointCreatedAt
			: new Date(row.startedAt).getTime();
	const date = formatUtcDate(new Date(timestamp));
	const costSegment = cost ? ` | ${cost}` : "";
	return `${date} ${provider}:${model} [${formatSessionStatusLabel(row.status)}]${costSegment} | ${title}`;
}
