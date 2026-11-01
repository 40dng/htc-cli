import { describe, expect, it } from "vitest";
import {
	buildReadFilesKeys,
	capDisplayText,
	extractFullOutputText,
	parseReadFilesInput,
} from "./tool-parsing";

describe("buildReadFilesKeys", () => {
	it("produces unique keys when the same path is read twice", () => {
		const info = parseReadFilesInput({
			files: [{ path: "/a/SKILL.md" }, { path: "/a/SKILL.md" }],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);

		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("produces unique keys for duplicate paths from the file_paths shape", () => {
		const info = parseReadFilesInput({
			file_paths: ["/a/SKILL.md", "/a/SKILL.md", "/b/SKILL.md"],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);

		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("keeps distinct paths in unique keys", () => {
		const keys = buildReadFilesKeys([{ path: "/a.ts" }, { path: "/b.ts" }]);

		expect(new Set(keys).size).toBe(2);
	});

	it("returns no keys for an empty list", () => {
		expect(buildReadFilesKeys([])).toEqual([]);
	});
});

describe("extractFullOutputText", () => {
	it("extracts text with real newlines from the MCP CallToolResult shape", () => {
		const raw = {
			content: [
				{ type: "text", text: "# Memory\n\nline one" },
				{ type: "text", text: "line two" },
			],
		};
		expect(extractFullOutputText(raw)).toBe("# Memory\n\nline one\nline two");
	});

	it("keeps binary payloads behind placeholders in mixed MCP content", () => {
		const raw = {
			content: [
				{ type: "text", text: "before" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				{
					type: "resource",
					resource: { uri: "file:///a.md", blob: "d29ybGQ=" },
				},
				{ type: "resource_link", uri: "file:///b.md", name: "b.md" },
				{ type: "text", text: "after" },
			],
		};
		expect(extractFullOutputText(raw)).toBe(
			"before\n[image: image/png]\naGVsbG8=\n[resource: file:///a.md]\nd29ybGQ=\n[resource_link: file:///b.md]\nafter",
		);
	});

	it("chunks base64 payloads into 76-char lines so collapse stays compact", () => {
		const raw = {
			content: [
				{ type: "image", data: "A".repeat(160), mimeType: "image/png" },
			],
		};
		expect(extractFullOutputText(raw)?.split("\n")).toEqual([
			"[image: image/png]",
			"A".repeat(76),
			"A".repeat(76),
			"A".repeat(8),
		]);
	});

	it("extracts embedded resource text from MCP content", () => {
		const raw = {
			content: [
				{
					type: "resource",
					resource: { uri: "file:///memory.md", text: "resource body\nline 2" },
				},
			],
		};
		expect(extractFullOutputText(raw)).toBe("resource body\nline 2");
	});

	it("falls back to pretty JSON for objects without text content", () => {
		const raw = { structuredContent: { ok: true } };
		expect(extractFullOutputText(raw)).toBe(JSON.stringify(raw, null, 2));
	});
});

describe("capDisplayText", () => {
	it("passes small text through untouched", () => {
		const capped = capDisplayText("a\nb\nc");
		expect(capped.text).toBe("a\nb\nc");
		expect(capped.truncated).toBe(false);
		expect(capped.totalLines).toBe(3);
	});

	it("caps by line count and preserves the real total", () => {
		const input = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
		const capped = capDisplayText(input, 10, 1024 * 1024);
		expect(capped.truncated).toBe(true);
		expect(capped.totalLines).toBe(500);
		expect(capped.text.split("\n")).toHaveLength(10);
	});

	it("caps a single giant line by byte budget", () => {
		const input = "A".repeat(200_000);
		const capped = capDisplayText(input, 10, 4096);
		expect(capped.truncated).toBe(true);
		expect(capped.totalLines).toBe(1);
		expect(Buffer.byteLength(capped.text, "utf8")).toBeLessThanOrEqual(4096);
	});

	it("never splits a surrogate pair at the byte boundary", () => {
		const input = "\u{1F600}".repeat(5000);
		const capped = capDisplayText(input, 1, 100);
		expect(capped.truncated).toBe(true);
		expect(capped.text.includes("\uFFFD")).toBe(false);
		expect(Buffer.byteLength(capped.text, "utf8")).toBeLessThanOrEqual(100);
	});
});
