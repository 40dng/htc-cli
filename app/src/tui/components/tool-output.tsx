import { useMemo, useState } from "react";
import { useTheme } from "../hooks/use-theme";
import type { ResolvedTheme } from "../themes";
import { makeUnifiedDiff } from "../utils/diff";
import { getSyntaxStyle } from "../utils/syntax-style";
import { getToolErrorPresentation } from "../utils/tool-errors";
import {
	type CappedText,
	capDisplayText,
	detectLanguage,
	extractFullOutputText,
	parseApplyPatchInput,
	parseEditorInput,
	parseReadFilesInput,
	shortenPath,
} from "../utils/tool-parsing";

const MAX_COLLAPSED_LINES = 5;
const RESULT = "\u23bf";

function humanBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ToolOutputProps {
	toolName: string;
	outputSummary: string;
	rawOutput?: unknown;
	rawInput?: unknown;
	/** Texto ja limitado no content_end; evita reparsear rawOutput a cada render. */
	display?: CappedText;
	error?: string;
}

function isAskTool(toolName: string): boolean {
	return toolName === "ask_question" || toolName === "ask_followup_question";
}

function isBashTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "bash";
}

function isReadTool(toolName: string): boolean {
	return toolName === "read_files";
}

function isEditTool(toolName: string): boolean {
	return (
		toolName === "editor" ||
		toolName === "edit" ||
		toolName === "write" ||
		toolName === "apply_patch"
	);
}

function BashOutput(props: { capped: CappedText; theme: ResolvedTheme }) {
	const [expanded, setExpanded] = useState(false);
	const { capped } = props;
	const lines = capped.text.trimEnd().split("\n");
	const firstLine = lines[0] ?? "";
	const hasMore = capped.totalLines > 1;

	if (!expanded) {
		return (
			<box
				flexDirection="column"
				paddingLeft={2}
				onMouseDown={() => hasMore && setExpanded(true)}
			>
				<text selectable>
					<span fg={props.theme.ui.muted}>
						{RESULT} {firstLine}
					</span>
				</text>
				{hasMore && (
					<text fg={props.theme.ui.muted}>
						{"   "}... {capped.totalLines - 1} more lines
					</text>
				)}
			</box>
		);
	}

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(false)}
		>
			<text fg={props.theme.ui.muted}>{RESULT} output:</text>
			<box marginLeft={2} marginTop={1} marginBottom={1}>
				<code
					content={capped.text}
					filetype="bash"
					syntaxStyle={getSyntaxStyle(props.theme)}
					selectable
				/>
			</box>
			{capped.truncated && (
				<text fg={props.theme.ui.muted}>
					{"   "}(showing {lines.length} of {capped.totalLines} lines Â·{" "}
					{humanBytes(capped.totalBytes)} total)
				</text>
			)}
		</box>
	);
}

function ReadOutput(props: { capped: CappedText; rawInput?: unknown }) {
	const { capped, rawInput } = props;

	const readInfo = parseReadFilesInput(rawInput);
	const filePath = readInfo?.files[0]?.path;
	const language = filePath ? detectLanguage(filePath) : undefined;

	return (
		<box paddingLeft={2}>
			<text fg="gray">
				{RESULT} {capped.totalLines} lines
				{language ? ` | ${language}` : ""}
			</text>
		</box>
	);
}

function DiffStats(props: {
	added: number;
	removed: number;
	language?: string;
	theme: ResolvedTheme;
}) {
	const { added, removed, language, theme } = props;
	return (
		<text fg={props.theme.ui.muted}>
			{RESULT}{" "}
			{removed > 0 ? (
				<>
					<span fg={theme.accents.success}>+{added}</span>{" "}
					<span fg={theme.accents.error}>-{removed}</span> lines
				</>
			) : (
				<span fg={theme.accents.success}>+{added} lines (new)</span>
			)}
			{language ? ` | ${language}` : ""}
		</text>
	);
}

function EditOutput(props: {
	rawInput?: unknown;
	outputSummary: string;
	theme: ResolvedTheme;
}) {
	const [expanded, setExpanded] = useState(true);
	const editorInfo = parseEditorInput(props.rawInput);

	if (!editorInfo?.oldText && !editorInfo?.newText) {
		return (
			<box paddingLeft={2}>
				<text fg={props.theme.ui.muted}>
					{"  "} {props.outputSummary || "done"}
				</text>
			</box>
		);
	}

	const oldText = editorInfo.oldText ?? "";
	const newText = editorInfo.newText;
	const language = detectLanguage(editorInfo.path);
	const addedLines = newText.split("\n").length;
	const removedLines = oldText ? oldText.split("\n").length : 0;
	const diffPalette = props.theme.diff;

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(!expanded)}
		>
			<DiffStats
				added={addedLines}
				removed={removedLines}
				language={language}
				theme={props.theme}
			/>
			{expanded && (
				<box marginLeft={2} marginTop={1} marginBottom={1}>
					<diff
						diff={makeUnifiedDiff(oldText, newText, editorInfo.path)}
						view="unified"
						filetype={language ?? "text"}
						syntaxStyle={getSyntaxStyle(props.theme)}
						showLineNumbers
						addedBg={diffPalette.addedBg}
						removedBg={diffPalette.removedBg}
						addedLineNumberBg={diffPalette.addedLineNumberBg}
						removedLineNumberBg={diffPalette.removedLineNumberBg}
						addedSignColor={diffPalette.addedSignColor}
						removedSignColor={diffPalette.removedSignColor}
						lineNumberFg={diffPalette.lineNumberFg}
					/>
				</box>
			)}
		</box>
	);
}

function ApplyPatchOutput(props: {
	rawInput?: unknown;
	outputSummary: string;
	theme: ResolvedTheme;
}) {
	const [expanded, setExpanded] = useState(true);
	const info = parseApplyPatchInput(props.rawInput);

	if (!info) {
		return (
			<box paddingLeft={2}>
				<text fg={props.theme.ui.muted}>
					{"  "} {props.outputSummary || "done"}
				</text>
			</box>
		);
	}

	const fileLabel = info.files.map((f) => shortenPath(f, 40)).join(", ");
	const language = detectLanguage(info.files[0] ?? "");
	const diffPalette = props.theme.diff;

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(!expanded)}
		>
			<DiffStats
				added={info.additions}
				removed={info.deletions}
				language={fileLabel}
				theme={props.theme}
			/>
			{expanded && (
				<box marginLeft={2} marginTop={1} marginBottom={1}>
					<diff
						diff={info.diff}
						view="unified"
						filetype={language ?? "text"}
						syntaxStyle={getSyntaxStyle(props.theme)}
						showLineNumbers
						addedBg={diffPalette.addedBg}
						removedBg={diffPalette.removedBg}
						addedLineNumberBg={diffPalette.addedLineNumberBg}
						removedLineNumberBg={diffPalette.removedLineNumberBg}
						addedSignColor={diffPalette.addedSignColor}
						removedSignColor={diffPalette.removedSignColor}
						lineNumberFg={diffPalette.lineNumberFg}
					/>
				</box>
			)}
		</box>
	);
}

function GenericOutput(props: { outputSummary: string; capped: CappedText }) {
	const [expanded, setExpanded] = useState(false);
	const displayText = props.capped.text || props.outputSummary;
	const lines = displayText.split("\n");
	const isLong = props.capped.totalLines > MAX_COLLAPSED_LINES;

	if (!displayText.trim()) return null;

	if (!expanded) {
		const collapsedText = isLong
			? `${lines.slice(0, MAX_COLLAPSED_LINES).join("\n")}\n... ${props.capped.totalLines - MAX_COLLAPSED_LINES} more lines`
			: displayText;

		return (
			<box
				flexDirection="column"
				paddingLeft={2}
				onMouseDown={() => isLong && setExpanded(true)}
			>
				<text selectable>
					<span fg="gray">
						{isLong ? RESULT : " "} {collapsedText}
					</span>
				</text>
			</box>
		);
	}

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(false)}
		>
			<text fg="gray">{RESULT}</text>
			<box marginLeft={2} marginBottom={1}>
				<text fg="gray" selectable>
					{displayText}
				</text>
			</box>
			{props.capped.truncated && (
				<text fg="gray">
					{"   "}(showing {lines.length} of {props.capped.totalLines} lines Â·{" "}
					{humanBytes(props.capped.totalBytes)} total)
				</text>
			)}
		</box>
	);
}

export function ToolOutput(props: ToolOutputProps) {
	const { toolName, outputSummary, rawOutput, rawInput, error, display } = props;
	const terminalTheme = useTheme();
	const [errorExpanded, setErrorExpanded] = useState(false);

	// Memoizado por referencia de rawOutput: sessoes ao vivo ja recebem `display`
	// pronto do content_end; sessoes retomadas (hydrate/acp) capping aqui UMA vez
	// em vez de a cada render do transcript.
	const capped = useMemo<CappedText>(() => {
		if (display) return display;
		if (rawOutput !== undefined && rawOutput !== null) {
			return capDisplayText(extractFullOutputText(rawOutput) ?? "");
		}
		return capDisplayText(outputSummary ?? "");
	}, [display, rawOutput, outputSummary]);

	if (error) {
		const presentation = getToolErrorPresentation(error);
		const isWarning = presentation.severity === "warning";
		const showDetail =
			errorExpanded && presentation.detail !== presentation.summary.trim();
		return (
			<box
				flexDirection="column"
				paddingLeft={2}
				onMouseDown={() => setErrorExpanded(!errorExpanded)}
			>
				<text fg={isWarning ? terminalTheme.ui.warn : terminalTheme.ui.error} selectable>
					{"  "} {isWarning ? "!" : "Error:"} {presentation.summary}
				</text>
				{showDetail && (
					<box paddingLeft={3}>
						<text fg={terminalTheme.ui.muted} selectable>
							{presentation.detail}
						</text>
					</box>
				)}
			</box>
		);
	}

	if (toolName === "switch_to_act_mode") return null;
	if (!outputSummary.trim() && !rawOutput) return null;

	if (isAskTool(toolName)) {
		const answer = (capped.text || outputSummary).trim();
		if (!answer) return null;
		return (
			<box paddingLeft={2}>
				<text fg={terminalTheme.ui.muted} selectable>
					{RESULT} {answer}
				</text>
			</box>
		);
	}

	if (isBashTool(toolName)) {
		return <BashOutput capped={capped} theme={terminalTheme} />;
	}

	if (isReadTool(toolName)) {
		return <ReadOutput capped={capped} rawInput={rawInput} />;
	}

	if (toolName === "apply_patch") {
		return (
			<ApplyPatchOutput
				rawInput={rawInput}
				outputSummary={outputSummary}
				theme={terminalTheme}
			/>
		);
	}

	if (isEditTool(toolName)) {
		return (
			<EditOutput
				rawInput={rawInput}
				outputSummary={outputSummary}
				theme={terminalTheme}
			/>
		);
	}

	return <GenericOutput outputSummary={outputSummary} capped={capped} />;
}
