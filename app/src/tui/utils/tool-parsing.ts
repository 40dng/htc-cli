import { basename, extname } from "node:path";
import { hunkHeader } from "./diff";

const EXT_TO_LANGUAGE: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".py": "python",
	".rb": "ruby",
	".rs": "rust",
	".go": "go",
	".java": "java",
	".kt": "kotlin",
	".swift": "swift",
	".c": "c",
	".cpp": "cpp",
	".h": "c",
	".hpp": "cpp",
	".cs": "csharp",
	".css": "css",
	".scss": "scss",
	".html": "html",
	".vue": "vue",
	".svelte": "svelte",
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".md": "markdown",
	".sql": "sql",
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	".fish": "fish",
	".lua": "lua",
	".php": "php",
	".r": "r",
	".ex": "elixir",
	".exs": "elixir",
	".erl": "erlang",
	".zig": "zig",
	".dockerfile": "dockerfile",
	".xml": "xml",
	".graphql": "graphql",
	".proto": "protobuf",
};

export function detectLanguage(filePath: string): string | undefined {
	const ext = extname(filePath).toLowerCase();
	if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
	const base = basename(filePath).toLowerCase();
	if (base === "dockerfile") return "dockerfile";
	if (base === "makefile") return "makefile";
	if (base === "cmakelists.txt") return "cmake";
	return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

export interface ReadFilesInfo {
	files: { path: string; startLine?: number; endLine?: number }[];
}

export function parseReadFilesInput(input: unknown): ReadFilesInfo | undefined {
	if (!isRecord(input)) return undefined;

	if (Array.isArray(input.file_paths)) {
		return {
			files: input.file_paths
				.filter((p): p is string => typeof p === "string")
				.map((path) => ({ path })),
		};
	}

	if (Array.isArray(input.files)) {
		return {
			files: input.files
				.filter((f): f is Record<string, unknown> => isRecord(f))
				.map((f) => ({
					path: String(f.path ?? ""),
					startLine:
						typeof f.start_line === "number" ? f.start_line : undefined,
					endLine: typeof f.end_line === "number" ? f.end_line : undefined,
				})),
		};
	}

	return undefined;
}

// A read_files call can list the same path more than once, so the raw path is
// not a unique React key. Prefix the array index to keep keys unique per row.
export function buildReadFilesKeys(files: { path: string }[]): string[] {
	return files.map((f, i) => `${i}:${f.path}`);
}

export interface RunCommandsInfo {
	commands: string[];
}

export function parseRunCommandsInput(
	input: unknown,
): RunCommandsInfo | undefined {
	if (!isRecord(input)) {
		if (typeof input === "string") return { commands: [input] };
		return undefined;
	}

	if (Array.isArray(input.commands)) {
		return {
			commands: input.commands.map((cmd) => {
				if (typeof cmd === "string") return cmd;
				if (isRecord(cmd) && typeof cmd.command === "string") {
					const args = Array.isArray(cmd.args) ? cmd.args.join(" ") : "";
					return args ? `${cmd.command} ${args}` : cmd.command;
				}
				return String(cmd);
			}),
		};
	}

	return undefined;
}

export interface EditorInfo {
	path: string;
	oldText?: string;
	newText: string;
	insertLine?: number;
}

export function parseEditorInput(input: unknown): EditorInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.path !== "string") return undefined;
	if (typeof input.new_text !== "string") return undefined;

	return {
		path: input.path,
		oldText: typeof input.old_text === "string" ? input.old_text : undefined,
		newText: input.new_text,
		insertLine:
			typeof input.insert_line === "number" ? input.insert_line : undefined,
	};
}

export interface SearchInfo {
	queries: string[];
}

export function parseSearchInput(input: unknown): SearchInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (!Array.isArray(input.queries)) return undefined;
	return {
		queries: input.queries.filter((q): q is string => typeof q === "string"),
	};
}

export interface WebFetchInfo {
	urls: string[];
}

export function parseWebFetchInput(input: unknown): WebFetchInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (!Array.isArray(input.requests)) return undefined;
	return {
		urls: input.requests
			.filter((r): r is Record<string, unknown> => isRecord(r))
			.map((r) => String(r.url ?? ""))
			.filter(Boolean),
	};
}

export interface SpawnAgentInfo {
	task: string;
}

export function parseSpawnAgentInput(
	input: unknown,
): SpawnAgentInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.task !== "string") return undefined;
	return { task: input.task };
}

// Base64 payloads are one giant line; chunk to MIME width so GenericOutput's
// line-based collapse stays compact and expand shows the full data.
function chunkBase64(data: string): string {
	return data.match(/.{1,76}/g)?.join("\n") ?? data;
}

export function extractFullOutputText(raw: unknown): string | undefined {
	if (raw === null || raw === undefined) return undefined;
	if (typeof raw === "string") return raw;

	if (Array.isArray(raw)) {
		const parts: string[] = [];
		for (const item of raw) {
			if (isRecord(item) && "result" in item) {
				const result = item.result;
				if (typeof result === "string") {
					parts.push(result);
				} else if (Array.isArray(result)) {
					for (const part of result) {
						if (
							isRecord(part) &&
							(part as { type?: string }).type === "text" &&
							"text" in part
						) {
							parts.push(String(part.text));
						}
					}
				}
			}
		}
		if (parts.length > 0) return parts.join("\n");
	}

	if (typeof raw === "object") {
		// MCP tools return {content: [{type: "text", text}, ...]}. Extract the
		// text so multi-line results keep real newlines instead of being
		// JSON-escaped into one giant line that floods the terminal (#13038).
		// Non-text blocks keep their identifying metadata plus their base64
		// payloads so mixed results are not silently truncated.
		const content = (raw as { content?: unknown }).content;
		if (Array.isArray(content)) {
			const parts = content
				.map((part) => {
					if (!isRecord(part)) return "";
					if (part.type === "text" && typeof part.text === "string") {
						return part.text;
					}
					if (part.type === "resource" && isRecord(part.resource)) {
						if (typeof part.resource.text === "string") {
							return part.resource.text;
						}
						if (typeof part.resource.blob === "string" && part.resource.blob) {
							const label =
								typeof part.resource.uri === "string"
									? `[resource: ${part.resource.uri}]`
									: "[resource]";
							return `${label}\n${chunkBase64(part.resource.blob)}`;
						}
						if (typeof part.resource.uri === "string") {
							return `[resource: ${part.resource.uri}]`;
						}
					}
					if (part.type === "resource_link" && typeof part.uri === "string") {
						return `[resource_link: ${part.uri}]`;
					}
					if (
						(part.type === "image" || part.type === "audio") &&
						typeof part.mimeType === "string"
					) {
						if (typeof part.data === "string" && part.data) {
							return `[${part.type}: ${part.mimeType}]\n${chunkBase64(part.data)}`;
						}
						return `[${part.type}: ${part.mimeType}]`;
					}
					return typeof part.type === "string" ? `[${part.type}]` : "";
				})
				.filter(Boolean);
			if (parts.length > 0) return parts.join("\n");
		}
		try {
			return JSON.stringify(raw, null, 2);
		} catch {
			return String(raw);
		}
	}

	return String(raw);
}

// Teto duro do texto que a TUI parseia/highlighta por resultado de tool. Um
// `ls -R`/`cat` de arquivo grande chega a dezenas de MB e montar isso num unico
// <code>/<text> do opentui congela a thread do renderer. O corte e por LINHAS e
// por BYTES: so linhas deixaria passar base64/minified numa linha unica.
export const MAX_DISPLAY_LINES = 200;
export const MAX_DISPLAY_BYTES = 64 * 1024;

export interface CappedText {
	text: string;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function countLines(value: string): number {
	let lines = 1;
	for (let i = 0; i < value.length; i += 1) {
		if (value.charCodeAt(i) === 10) lines += 1;
	}
	return lines;
}

// Largura UTF-8 do code point que comeca em `off` (par surrogate conta 4).
function utf8WidthAt(value: string, off: number): number {
	const code = value.charCodeAt(off);
	if (code < 0x80) return 1;
	if (code < 0x800) return 2;
	if (code >= 0xd800 && code <= 0xdbff) return 4;
	return 3;
}

// Corta na fronteira de code point mais proxima que ainda cabe no orcamento de
// bytes, para nao partir um par surrogate no meio. O avanco do index e feito
// pelo tamanho real do code point (1, 2 ou par surrogate), o que mantem a
// contagem de bytes exata em qualquer ponto da string.
function sliceToByteBudget(value: string, maxBytes: number): string {
	let bytes = 0;
	let index = 0;
	while (index < value.length) {
		const width = utf8WidthAt(value, index);
		if (bytes + width > maxBytes) break;
		bytes += width;
		index += width === 4 ? 2 : 1;
	}
	return value.slice(0, index);
}

/**
 * Limita o texto de exibicao de um tool result. Devolve o texto cortado mais a
 * contagem real (linhas e bytes) para a UI reportar a truncagem com honestidade.
 */
export function capDisplayText(
	raw: string,
	maxLines: number = MAX_DISPLAY_LINES,
	maxBytes: number = MAX_DISPLAY_BYTES,
): CappedText {
	const totalBytes = utf8Bytes(raw);
	const totalLines = countLines(raw);
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return { text: raw, truncated: false, totalLines, totalBytes };
	}
	let end = raw.length;
	let seen = 1;
	for (let i = 0; i < raw.length; i += 1) {
		if (raw.charCodeAt(i) === 10) {
			seen += 1;
			if (seen > maxLines) {
				end = i;
				break;
			}
		}
	}
	const text = sliceToByteBudget(raw.slice(0, end), maxBytes);
	return { text, truncated: true, totalLines, totalBytes };
}

export interface AskQuestionInfo {
	question: string;
	options: string[];
}

export function parseAskQuestionInput(
	input: unknown,
): AskQuestionInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.question !== "string") return undefined;
	const options = Array.isArray(input.options)
		? input.options.filter((o): o is string => typeof o === "string")
		: [];
	return { question: input.question, options };
}

export interface ApplyPatchInfo {
	files: string[];
	additions: number;
	deletions: number;
	diff: string;
}

const FILE_ACTION_RE = /^\*\*\* (?:Add|Update|Delete) File: (.+)/;
const SKIP_LINES =
	/^(?:\*\*\* (?:Begin|End) Patch|%%bash|```|EOF|apply_patch\b|@@|\*\*\* (?:Move to:|End of File))/;

export function parseApplyPatchInput(
	input: unknown,
): ApplyPatchInfo | undefined {
	const raw =
		typeof input === "string"
			? input
			: isRecord(input) && typeof input.input === "string"
				? input.input
				: null;
	if (!raw) return undefined;

	const files: string[] = [];
	const out: string[] = [];
	let hunk: string[] = [];
	let additions = 0;
	let deletions = 0;

	const flush = () => {
		if (hunk.length === 0) return;
		out.push(hunkHeader(hunk), ...hunk);
		hunk = [];
	};

	for (const line of raw.split("\n")) {
		const fileMatch = FILE_ACTION_RE.exec(line);
		if (fileMatch) {
			flush();
			const path = fileMatch[1].trim();
			files.push(path);
			out.push(`--- a/${path}`, `+++ b/${path}`);
			continue;
		}
		if (SKIP_LINES.test(line.trim())) continue;

		if (line.startsWith("+")) additions++;
		else if (line.startsWith("-")) deletions++;

		if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
			hunk.push(line);
		} else {
			hunk.push(` ${line}`);
		}
	}
	flush();

	if (files.length === 0) return undefined;
	return { files, additions, deletions, diff: out.join("\n") };
}

export function shortenPath(filePath: string, maxLen = 50): string {
	if (filePath.length <= maxLen) return filePath;
	const parts = filePath.split("/");
	const fileName = parts.pop() ?? "";
	if (fileName.length >= maxLen - 4) return `.../${fileName}`;
	let result = fileName;
	for (let i = parts.length - 1; i >= 0; i--) {
		const candidate = `${parts[i]}/${result}`;
		if (candidate.length + 4 > maxLen) break;
		result = candidate;
	}
	return `.../${result}`;
}
