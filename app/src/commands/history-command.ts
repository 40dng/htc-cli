import type { Command } from "commander";
import type { TuiStartupTarget } from "../tui/types";
import { HISTORY_LIST_LIMIT } from "../utils/history-limit";
import type { CliOutputMode } from "../utils/types";
import {
	runHistoryDelete,
	runHistoryExport,
	runHistoryList,
	runHistoryUpdate,
} from "./history";

type HistoryCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type RegisterHistoryCommandOptions = {
	program: Command;
	io: HistoryCommandIo;
	setExitCode: (code: number) => void;
	setStartupTarget: (target: TuiStartupTarget) => void;
	isInteractiveTTY?: () => boolean;
};

function resolveHistoryOutputMode(
	program: Command,
	historyCmd: Command,
): CliOutputMode {
	return program.opts().json || historyCmd.opts().json ? "json" : "text";
}

export function registerHistoryCommand({
	program,
	io,
	setExitCode,
	setStartupTarget,
	isInteractiveTTY = () =>
		process.stdin.isTTY === true && process.stdout.isTTY === true,
}: RegisterHistoryCommandOptions): void {
	const historyCmd = program
		.command("history")
		.alias("h")
		.description("List session history or manage saved sessions")
		.option("--json", "Output as JSON")
		.option(
			"--limit <count>",
			"Maximum number of sessions to show",
			String(HISTORY_LIST_LIMIT),
		)
		.option("--page <number>", "Page number for paginated results")
		.option("--config <dir>", "configuration directory")
		.option(
			"--all-history",
			"Historico de TODAS as pastas (default: so a pasta atual)",
		)
		.action(async () => {
			const opts = historyCmd.opts();
			const limit = Number.parseInt(opts.limit, 10);
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			const workspaceRoot = opts.allHistory ? undefined : process.cwd();
			if (outputMode === "text" && isInteractiveTTY()) {
				setStartupTarget("history");
				return;
			}
			setExitCode(
				await runHistoryList({
					limit,
					outputMode,
					workspaceRoot,
					io,
				}),
			);
		});

	const historyDeleteCmd = historyCmd
		.command("delete")
		.description("Delete a session from history")
		.option("--session-id <id>", "Session ID to delete")
		.action(async () => {
			const opts = historyDeleteCmd.opts();
			if (!opts.sessionId) {
				io.writeErr("history delete requires --session-id <id>");
				setExitCode(1);
				return;
			}
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			setExitCode(await runHistoryDelete(opts.sessionId, outputMode, io));
		});

	const historyUpdateCmd = historyCmd
		.command("update")
		.description("Update a session in history")
		.option("--metadata <json>", "Metadata as JSON string")
		.option("--prompt <text>", "New prompt text")
		.option("--session-id <id>", "Session ID to update")
		.option("--title <text>", "New title")
		.action(async () => {
			const opts = historyUpdateCmd.opts();
			if (!opts.sessionId) {
				io.writeErr("history update requires --session-id <id>");
				setExitCode(1);
				return;
			}
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			setExitCode(
				await runHistoryUpdate(
					opts.sessionId,
					opts.prompt,
					opts.title,
					opts.metadata,
					outputMode,
					io,
				),
			);
		});

	const historyExportCmd = historyCmd
		.command("export <sessionId>")
		.description("Export a session as a standalone HTML file")
		.option("-o, --output <path>", "Output HTML file path")
		.action(async (sessionId: string) => {
			const opts = historyExportCmd.opts();
			const outputMode = resolveHistoryOutputMode(program, historyCmd);
			setExitCode(
				await runHistoryExport(sessionId, opts.output, outputMode, io),
			);
		});
}
